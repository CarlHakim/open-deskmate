import { execSync, spawnSync } from "child_process";
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

// Use a user-writable location for tmp and profiles (app bundle is read-only when installed)
// On macOS: ~/Library/Application Support/Accomplish/dev-browser/
// Fallback: system temp directory
function getDataDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "darwin") {
    return join(homeDir, "Library", "Application Support", "Accomplish", "dev-browser");
  } else if (process.platform === "win32") {
    return join(process.env.APPDATA || homeDir, "Accomplish", "dev-browser");
  } else {
    // Linux or fallback
    return join(homeDir, ".accomplish", "dev-browser");
  }
}

const dataDir = getDataDir();
const tmpDir = join(dataDir, "tmp");
const profileDir = join(dataDir, "profiles");
const playwrightBrowsersDir = join(dataDir, "playwright-browsers");

// Rebrowser runtime patches are unstable on Windows; disable to avoid context crashes.
process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = "0";

// Create data directories if they don't exist
console.log(`Creating data directory: ${dataDir}`);
mkdirSync(tmpDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });
mkdirSync(playwrightBrowsersDir, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersDir;

// Accomplish uses ports 9224/9225 to avoid conflicts with Claude Code's dev-browser (9222/9223)
const ACCOMPLISH_HTTP_PORT = 9224;
const ACCOMPLISH_CDP_PORT = 9225;

// Check if server is already running
console.log("Checking for existing servers...");
try {
  const res = await fetch(`http://localhost:${ACCOMPLISH_HTTP_PORT}`, {
    signal: AbortSignal.timeout(1000),
  });
  if (res.ok) {
    console.log(`Server already running on port ${ACCOMPLISH_HTTP_PORT}`);
    process.exit(0);
  }
} catch {
  // Server not running, continue to start
}

// Clean up stale CDP port if HTTP server isn't running (crash recovery)
// This handles the case where Node crashed but Chrome is still running
try {
  if (!isWindows) {
    const pid = execSync(`lsof -ti:${ACCOMPLISH_CDP_PORT}`, { encoding: "utf-8" }).trim();
    if (pid) {
      console.log(`Cleaning up stale Chrome process on CDP port ${ACCOMPLISH_CDP_PORT} (PID: ${pid})`);
      execSync(`kill -9 ${pid}`);
    }
  }
} catch {
  // No process on CDP port, which is expected
}

// Clean up stale Chrome profile lock files (crash recovery)
// When Chrome crashes or is force-killed, it leaves behind SingletonLock files
// that prevent new instances from starting. Clean them up before launching.
// We have separate profile directories for system Chrome and Playwright Chromium.
const profileDirs = [
  join(profileDir, "chrome-profile"),
  join(profileDir, "playwright-profile"),
];
const staleLockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
for (const dir of profileDirs) {
  for (const lockFile of staleLockFiles) {
    const lockPath = join(dir, lockFile);
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
        console.log(`Cleaned up stale lock file: ${lockFile} in ${dir}`);
      } catch (err) {
        console.warn(`Failed to remove ${lockFile}:`, err);
      }
    }
  }
}

function resolveCommand(command: string): string | null {
  const pathEntries = (process.env.PATH || "").split(isWindows ? ";" : ":").filter(Boolean);
  const extraEntries = process.env.NODE_BIN_PATH ? [process.env.NODE_BIN_PATH] : [];
  const extensions = isWindows ? [".cmd", ".exe", ""] : [""];

  for (const dir of [...extraEntries, ...pathEntries]) {
    for (const ext of extensions) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveNodePath(): string | null {
  if (process.env.NODE_BIN_PATH) {
    const candidate = join(process.env.NODE_BIN_PATH, isWindows ? "node.exe" : "node");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return resolveCommand("node");
}

function resolveNpxCli(): string | null {
  if (process.env.NODE_BIN_PATH) {
    const candidate = join(process.env.NODE_BIN_PATH, "node_modules", "npm", "bin", "npx-cli.js");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// Helper to install Playwright Chromium
function installPlaywrightChromium(): void {
  console.log("\n========================================");
  console.log("Downloading browser (one-time setup)...");
  console.log("This may take 1-2 minutes.");
  console.log("========================================\n");

  const nodePath = resolveNodePath();
  const npxCli = resolveNpxCli();
  if (!nodePath || !npxCli) {
    throw new Error("Bundled Node.js/npm not found. Ensure NODE_BIN_PATH is set.");
  }

  console.log(`Using node from: ${nodePath}`);
  const pathParts = (process.env.PATH || "").split(isWindows ? ";" : ":").filter(Boolean);
  const pathPrefix = process.env.NODE_BIN_PATH ? [process.env.NODE_BIN_PATH] : [];
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersDir,
    PATH: [...pathPrefix, ...pathParts].join(isWindows ? ";" : ":"),
  };
  const result = spawnSync(nodePath, [npxCli, "playwright", "install", "chromium"], {
    stdio: "inherit",
    env,
    shell: false,
  });
  if (result.status !== 0) {
    if (result.error) {
      console.error("Playwright install error:", result.error);
    }
    console.error("Playwright install exit:", {
      status: result.status,
      signal: result.signal,
    });
    throw new Error(`Playwright install failed with code ${result.status ?? "unknown"}`);
  }
  console.log("\nBrowser installed successfully!\n");
}

// Start the server - tries system Chrome first, falls back to Playwright Chromium
console.log("Starting dev browser server...");
const headless = process.env.HEADLESS === "true";
const useSystemChromeEnv = process.env.DEV_BROWSER_USE_SYSTEM_CHROME;
const useSystemChrome =
  !isWindows && (useSystemChromeEnv === undefined || useSystemChromeEnv === "true");

const { serve } = await import("@/index.js");

async function startServer(retry = false): Promise<void> {
  try {
    const server = await serve({
      port: ACCOMPLISH_HTTP_PORT,
      cdpPort: ACCOMPLISH_CDP_PORT,
      headless,
      profileDir,
      useSystemChrome,
    });

    console.log(`Dev browser server started`);
    console.log(`  WebSocket: ${server.wsEndpoint}`);
    console.log(`  Tmp directory: ${tmpDir}`);
    console.log(`  Profile directory: ${profileDir}`);
    console.log(`\nReady`);
    console.log(`\nPress Ctrl+C to stop`);

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if error is about missing Playwright browsers
    const isBrowserMissing =
      errorMessage.includes("Executable doesn't exist") ||
      errorMessage.includes("browserType.launchPersistentContext") ||
      errorMessage.includes("npx playwright install") ||
      errorMessage.includes("run the install command");

    if (isBrowserMissing && !retry) {
      console.log("\nPlaywright Chromium not installed, downloading...");
      try {
        installPlaywrightChromium();
        // Retry with Playwright Chromium (useSystemChrome will fail again, but fallback will work)
        await startServer(true);
        return;
      } catch (installError) {
        console.error("Failed to install Playwright browsers:", installError);
        console.log("You may need to run manually: npx playwright install chromium");
        process.exit(1);
      }
    }

    // If we've already retried or it's a different error, give up
    console.error("Failed to start dev browser server:", error);
    process.exit(1);
  }
}

await startServer();
