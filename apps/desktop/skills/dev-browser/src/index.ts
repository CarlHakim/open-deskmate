import express, { type Express, type Request, type Response } from "express";
// Using rebrowser-playwright (via npm alias) for better anti-detection
// Rebrowser patches fix CDP-level detection leaks (Runtime.Enable) that stealth plugins can't fix
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";
import type { Socket } from "net";
import type {
  ServeOptions,
  GetPageRequest,
  GetPageResponse,
  ListPagesResponse,
  ServerInfoResponse,
} from "./types";

export type { ServeOptions, GetPageResponse, ListPagesResponse, ServerInfoResponse };

export interface DevBrowserServer {
  wsEndpoint: string;
  port: number;
  stop: () => Promise<void>;
}

// Helper to retry fetch with exponential backoff
async function fetchWithRetry(
  url: string,
  maxRetries = 5,
  delayMs = 500
): Promise<globalThis.Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw new Error(`Failed after ${maxRetries} retries: ${lastError?.message}`);
}

// Helper to add timeout to promises
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms)
    ),
  ]);
}

export async function serve(options: ServeOptions = {}): Promise<DevBrowserServer> {
  // Accomplish uses ports 9224/9225 to avoid conflicts with Claude Code's dev-browser (9222/9223)
  const port = options.port ?? 9224;
  const headless = options.headless ?? false;
  const cdpPort = options.cdpPort ?? 9225;
  const profileDir = options.profileDir;
  const useSystemChrome = options.useSystemChrome ?? true; // Default to trying system Chrome

  // Validate port numbers
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be between 1 and 65535`);
  }
  if (cdpPort < 1 || cdpPort > 65535) {
    throw new Error(`Invalid cdpPort: ${cdpPort}. Must be between 1 and 65535`);
  }
  if (port === cdpPort) {
    throw new Error("port and cdpPort must be different");
  }

  // Base profile directory
  const baseProfileDir = profileDir ?? join(process.cwd(), ".browser-data");

  let context: BrowserContext | null = null;
  let browser: Browser | null = null;
  let wsEndpoint = "";
  let contextClosed = false;
  let restartPromise: Promise<void> | null = null;
  const useChromiumSandbox = process.platform === "linux";
  const usePersistentContext = process.platform !== "win32";
  const shouldHarden = process.platform !== "win32";
  const launchArgs = [
    `--remote-debugging-port=${cdpPort}`,
    ...(shouldHarden ? ["--disable-blink-features=AutomationControlled"] : []),
  ];
  const launchOptionsBase = {
    headless,
    args: launchArgs,
    ...(shouldHarden ? { ignoreDefaultArgs: ["--enable-automation"] } : {}),
    ...(useChromiumSandbox ? { chromiumSandbox: true } : {}),
  };

  const markContextClosed = (reason: string) => {
    contextClosed = true;
    console.warn(`Browser context closed (${reason}).`);
  };

  const attachContextHandlers = () => {
    if (!context) return;
    contextClosed = false;
    context.on("close", () => markContextClosed("context close event"));
    if (browser) {
      browser.on("disconnected", () => markContextClosed("browser disconnected"));
    }
  };

  const closeContext = async () => {
    if (context) {
      try {
        await context.close();
      } catch {
        // Context might already be closed
      }
    }
    context = null;

    if (browser) {
      try {
        await browser.close();
      } catch {
        // Browser might already be closed
      }
    }
    browser = null;
  };

  const updateWsEndpoint = async () => {
    const cdpResponse = await fetchWithRetry(`http://127.0.0.1:${cdpPort}/json/version`);
    const cdpInfo = (await cdpResponse.json()) as { webSocketDebuggerUrl: string };
    wsEndpoint = cdpInfo.webSocketDebuggerUrl;
  };

  const launchContext = async () => {
    let usedSystemChrome = false;
    browser = null;

    // Try system Chrome first if enabled (much faster - no download needed)
    if (useSystemChrome) {
      try {
        console.log("Trying to use system Chrome...");
        // Use separate profile directory for system Chrome to avoid compatibility issues
        const chromeUserDataDir = join(baseProfileDir, "chrome-profile");
        mkdirSync(chromeUserDataDir, { recursive: true });

        if (usePersistentContext) {
          context = await chromium.launchPersistentContext(chromeUserDataDir, {
            ...launchOptionsBase,
            channel: "chrome", // Use system Chrome instead of Playwright's Chromium
          });
        } else {
          console.log("Windows detected: using non-persistent Chrome context.");
          browser = await chromium.launch({
            ...launchOptionsBase,
            channel: "chrome",
          });
          context = await browser.newContext();
        }
        usedSystemChrome = true;
        console.log("Using system Chrome (fast startup!)");
      } catch (chromeError) {
        console.log("System Chrome not available, falling back to Playwright Chromium...");
        // Fall through to Playwright Chromium below
      }
    }

    // Fall back to Playwright's bundled Chromium
    if (!usedSystemChrome) {
      // Use separate profile directory for Playwright Chromium to avoid compatibility issues
      const playwrightUserDataDir = join(baseProfileDir, "playwright-profile");
      mkdirSync(playwrightUserDataDir, { recursive: true });

      console.log("Launching browser with Playwright Chromium...");
      if (usePersistentContext) {
        context = await chromium.launchPersistentContext(playwrightUserDataDir, {
          ...launchOptionsBase,
        });
      } else {
        console.log("Windows detected: using non-persistent Playwright Chromium context.");
        browser = await chromium.launch({
          ...launchOptionsBase,
        });
        context = await browser.newContext();
      }
      console.log("Browser launched with Playwright Chromium");
    }

    if (!context) {
      throw new Error("Browser context failed to initialize");
    }

    // Close initial blank pages on non-Windows. On Windows, keep one page open
    // to avoid the persistent context closing unexpectedly.
    try {
      const pages = context.pages();
      if (process.platform === "win32") {
        for (const page of pages.slice(1)) {
          await page.close();
        }
        if (pages.length > 0) {
          console.log("Keeping initial page open on Windows.");
        }
      } else {
        for (const page of pages) {
          await page.close();
        }
      }
    } catch (err) {
      console.warn("Failed to close initial pages:", err);
    }

    attachContextHandlers();

    const contextLabel = usePersistentContext ? "persistent" : "non-persistent";
    console.log(`Browser context ready (${contextLabel}).`);

    await updateWsEndpoint();
    console.log(`CDP WebSocket endpoint: ${wsEndpoint}`);
  };

  await launchContext();

  // Registry entry type for page tracking
  interface PageEntry {
    page: Page;
    targetId: string;
  }

  // Registry: name -> PageEntry
  const registry = new Map<string, PageEntry>();

  // Helper to get CDP targetId for a page
  async function getTargetId(page: Page, activeContext: BrowserContext): Promise<string> {
    const cdpSession = await activeContext.newCDPSession(page);
    try {
      const { targetInfo } = await cdpSession.send("Target.getTargetInfo");
      return targetInfo.targetId;
    } finally {
      await cdpSession.detach();
    }
  }

  async function restartContext(reason: string): Promise<void> {
    if (restartPromise) {
      await restartPromise;
      return;
    }

    restartPromise = (async () => {
      console.warn(`Restarting browser context (${reason}).`);
      await closeContext();
      await launchContext();
      registry.clear();
    })();

    try {
      await restartPromise;
    } finally {
      restartPromise = null;
    }
  }

  async function ensureContextReady(): Promise<void> {
    if (!context || contextClosed || (browser && !browser.isConnected())) {
      await restartContext("context not ready");
    }
  }

  async function createPageEntry(
    name: string,
    viewport?: GetPageRequest["viewport"]
  ): Promise<PageEntry> {
    if (!context) {
      throw new Error("Browser context not ready");
    }

    const page = await withTimeout(context.newPage(), 30000, "Page creation timed out after 30s");
    if (viewport) {
      await page.setViewportSize(viewport);
    }

    const targetId = await getTargetId(page, context);
    const entry = { page, targetId };
    registry.set(name, entry);

    // Clean up registry when page is closed (e.g., user clicks X)
    page.on("close", () => {
      registry.delete(name);
    });

    return entry;
  }

  // Express server for page management
  const app: Express = express();
  app.use(express.json());

  // GET / - server info
  app.get("/", (_req: Request, res: Response) => {
    const response: ServerInfoResponse = { wsEndpoint };
    res.json(response);
  });

  // GET /pages - list all pages
  app.get("/pages", (_req: Request, res: Response) => {
    const response: ListPagesResponse = {
      pages: Array.from(registry.keys()),
    };
    res.json(response);
  });

  // POST /pages - get or create page
  app.post("/pages", async (req: Request, res: Response) => {
    try {
      const body = req.body as GetPageRequest;
      const { name, viewport } = body;

      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required and must be a string" });
        return;
      }

      if (name.length === 0) {
        res.status(400).json({ error: "name cannot be empty" });
        return;
      }

      if (name.length > 256) {
        res.status(400).json({ error: "name must be 256 characters or less" });
        return;
      }

      await ensureContextReady();

      // Check if page already exists
      let entry = registry.get(name);
      if (!entry) {
        try {
          entry = await createPageEntry(name, viewport);
        } catch (error) {
          console.warn("Page creation failed, restarting browser context.", error);
          await restartContext("page creation failed");
          entry = await createPageEntry(name, viewport);
        }
      }

      if (!entry) {
        throw new Error("Page creation failed");
      }

      const response: GetPageResponse = { wsEndpoint, name, targetId: entry.targetId };
      res.json(response);
    } catch (error) {
      if (res.headersSent) return;
      console.error("Failed to get page:", error);
      res.status(500).json({ error: "failed to create page" });
    }
  });

  // DELETE /pages/:name - close a page
  app.delete("/pages/:name", async (req: Request<{ name: string }>, res: Response) => {
    const name = decodeURIComponent(req.params.name);
    const entry = registry.get(name);

    if (entry) {
      await entry.page.close();
      registry.delete(name);
      res.json({ success: true });
      return;
    }

    res.status(404).json({ error: "page not found" });
  });

  // Start the server
  const server = app.listen(port, () => {
    console.log(`HTTP API server running on port ${port}`);
  });

  // Track active connections for clean shutdown
  const connections = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
  });

  // Track if cleanup has been called to avoid double cleanup
  let cleaningUp = false;

  // Cleanup function
  const cleanup = async () => {
    if (cleaningUp) return;
    cleaningUp = true;

    console.log("\nShutting down...");

    // Close all active HTTP connections
    for (const socket of connections) {
      socket.destroy();
    }
    connections.clear();

    // Close all pages
    for (const entry of registry.values()) {
      try {
        await entry.page.close();
      } catch {
        // Page might already be closed
      }
    }
    registry.clear();

    // Close context and browser
    await closeContext();

    server.close();
    console.log("Server stopped.");
  };

  // Synchronous cleanup for forced exits
  const syncCleanup = () => {
    try {
      context?.close();
    } catch {
      // Best effort
    }

    try {
      browser?.close();
    } catch {
      // Best effort
    }
  };

  // Signal handlers (consolidated to reduce duplication)
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

  const signalHandler = async () => {
    await cleanup();
    process.exit(0);
  };

  const errorHandler = async (err: unknown) => {
    console.error("Unhandled error:", err);
    await cleanup();
    process.exit(1);
  };

  // Register handlers
  signals.forEach((sig) => process.on(sig, signalHandler));
  process.on("uncaughtException", errorHandler);
  process.on("unhandledRejection", errorHandler);
  process.on("exit", syncCleanup);

  // Helper to remove all handlers
  const removeHandlers = () => {
    signals.forEach((sig) => process.off(sig, signalHandler));
    process.off("uncaughtException", errorHandler);
    process.off("unhandledRejection", errorHandler);
    process.off("exit", syncCleanup);
  };

  return {
    wsEndpoint,
    port,
    async stop() {
      removeHandlers();
      await cleanup();
    },
  };
}
