import { EventEmitter } from 'events';
import { app } from 'electron';
import fs from 'fs';
import type * as pty from 'node-pty';
import { StreamParser } from './stream-parser';
import {
  getOpenCodeCliPath,
  isOpenCodeBundled,
  getBundledOpenCodeVersion,
} from './cli-path';
import { getAllApiKeys, getApiKey } from '../store/secureStorage';
import { getDebugMode } from '../store/appSettings';
import { generateOpenCodeConfig, ACCOMPLISH_AGENT_NAME } from './config-generator';
import { getExtendedNodePath } from '../utils/system-path';
import { getBundledNodePaths, logBundledNodeInfo } from '../utils/bundled-node';
import path from 'path';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { detectTaskComplexity, detectTaskNeedsBrowser, getRuntimeSpeedMode } from '../services/task-intent';
import { resolveSelectedModelForAgent } from '../services/agent-context';
import type {
  TaskConfig,
  Task,
  TaskMessage,
  TaskResult,
  OpenCodeMessage,
  PermissionRequest,
} from '@accomplish/shared';

/**
 * Error thrown when OpenCode CLI is not available
 */
export class OpenCodeCliNotFoundError extends Error {
  constructor() {
    super(
      'OpenCode CLI is not available. The bundled CLI may be missing or corrupted. Please reinstall the application.'
    );
    this.name = 'OpenCodeCliNotFoundError';
  }
}

function killProcessTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      // Best-effort: kill the full tree to avoid orphaned child processes.
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    // On POSIX, try to kill the process group first.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // ignore
  }
}

/**
 * Error thrown when node-pty is unavailable or fails to load
 */
export class NodePtyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodePtyUnavailableError';
  }
}

/**
 * Check if OpenCode CLI is available (bundled or installed)
 */
export async function isOpenCodeCliInstalled(): Promise<boolean> {
  return isOpenCodeBundled();
}

/**
 * Get OpenCode CLI version
 */
export async function getOpenCodeCliVersion(): Promise<string | null> {
  return getBundledOpenCodeVersion();
}

export interface OpenCodeAdapterEvents {
  message: [OpenCodeMessage];
  'tool-use': [string, unknown];
  'tool-result': [string];
  'permission-request': [PermissionRequest];
  progress: [{ stage: string; message?: string }];
  complete: [TaskResult];
  error: [Error];
  debug: [{ type: string; message: string; data?: unknown }];
}

export class OpenCodeAdapter extends EventEmitter<OpenCodeAdapterEvents> {
  private static readonly INTERRUPT_FORCE_KILL_MS = 350;

  private ptyProcess: pty.IPty | null = null;
  private ptyModule: typeof import('node-pty') | null = null;
  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private hasPtyOutput: boolean = false;
  private streamParser: StreamParser;
  private currentSessionId: string | null = null;
  private currentTaskId: string | null = null;
  private currentConfigPath: string | null = null;
  private messages: TaskMessage[] = [];
  private rawOutputBuffer = '';
  private hasParsedMessages = false;
  private hasCompleted: boolean = false;
  private pendingComplete: TaskResult | null = null;
  private completeTimer: NodeJS.Timeout | null = null;
  private interruptForceKillTimer: NodeJS.Timeout | null = null;
  private isDisposed: boolean = false;
  private wasInterrupted: boolean = false;
  /** Temp file holding the prompt (to avoid shell escaping issues on Windows) */
  private promptFilePath: string | null = null;
  private readonly verboseStreamLogs =
    process.env.OPENDESKMATE_VERBOSE_STREAM === '1' || getDebugMode();

  /**
   * Create a new OpenCodeAdapter instance
   * @param taskId - Optional task ID for this adapter instance (used for logging)
   */
  constructor(taskId?: string) {
    super();
    this.currentTaskId = taskId || null;
    this.streamParser = new StreamParser();
    this.setupStreamParsing();
  }

  /**
   * Start a new task with OpenCode CLI
   */
  async startTask(config: TaskConfig): Promise<Task> {
    // Check if adapter has been disposed
    if (this.isDisposed) {
      throw new Error('Adapter has been disposed and cannot start new tasks');
    }

    // Check if OpenCode CLI is installed before attempting to start
    const cliInstalled = await isOpenCodeCliInstalled();
    if (!cliInstalled) {
      throw new OpenCodeCliNotFoundError();
    }

    const taskId = config.taskId || this.generateTaskId();
    this.currentTaskId = taskId;
    this.currentSessionId = null;
    this.messages = [];
    this.rawOutputBuffer = '';
    this.hasParsedMessages = false;
    this.streamParser.reset();
    this.hasCompleted = false;
    this.wasInterrupted = false;
    // Clean up previous child process if adapter is reused
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch {
        // ignore
      }
      this.childProcess = null;
    }
    this.clearInterruptForceKillTimer();
    // Clean up previous prompt file if adapter is reused
    if (this.promptFilePath) {
      try { fs.unlinkSync(this.promptFilePath); } catch { /* ignore */ }
      this.promptFilePath = null;
    }

    // Generate OpenCode config file with MCP settings and agent
    console.log('[OpenCode CLI] Generating OpenCode config with MCP settings and agent...');
    const configPath = await generateOpenCodeConfig({
      agentId: config.agentId,
      systemPromptAppend: config.systemPromptAppend,
      includeBrowserSkill: config.requiresBrowser !== false,
    });
    this.currentConfigPath = configPath;
    console.log('[OpenCode CLI] Config generated at:', configPath);

    const cliArgs = await this.buildCliArgs(config);

    // Get the bundled CLI path
    const { command, args: baseArgs } = getOpenCodeCliPath();
    const startMsg = `Starting: ${command} ${[...baseArgs, ...cliArgs].join(' ')}`;
    console.log('[OpenCode CLI]', startMsg);
    this.emit('debug', { type: 'info', message: startMsg });

    // Build environment with API keys
    const env = await this.buildEnvironment(config);

    const allArgs = [...baseArgs, ...cliArgs];
    const cmdMsg = `Command: ${command}`;
    const argsMsg = `Args: ${allArgs.join(' ')}`;
    // Use temp directory as default cwd to avoid TCC permission prompts.
    // Home directory (~/) triggers TCC when the CLI scans for projects/configs
    // because it lists Desktop, Documents, etc.
    const safeCwd = config.workingDirectory || app.getPath('temp');
    const cwdMsg = `Working directory: ${safeCwd}`;

    console.log('[OpenCode CLI]', cmdMsg);
    console.log('[OpenCode CLI]', argsMsg);
    console.log('[OpenCode CLI]', cwdMsg);

    this.emit('debug', { type: 'info', message: cmdMsg });
    this.emit('debug', { type: 'info', message: argsMsg, data: { args: allArgs } });
    this.emit('debug', { type: 'info', message: cwdMsg });

    // Windows: always prefer PTY because some OpenCode exe builds can hang when
    // spawned without a console/PTY. We only allow explicit no-PTY via
    // OPENDESKMATE_WINDOWS_FORCE_NO_PTY=1 for emergency troubleshooting.
    const usePtyOnWindows = process.env.OPENDESKMATE_WINDOWS_FORCE_NO_PTY !== '1';

    if (process.platform === 'win32') {
      const stringEnv = Object.fromEntries(
        Object.entries(env).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>;

      if (usePtyOnWindows) {
        try {
          const ptyModule = await this.getPtyModule();
          await this.spawnPtyWindows({
            ptyModule,
            command,
            allArgs,
            cwd: safeCwd,
            env: stringEnv,
          });
        } catch (err) {
          console.warn('[OpenCode CLI] node-pty unavailable; falling back to hidden spawn.', err);
          await this.spawnWithoutPtyWindows({
            command,
            allArgs,
            cwd: safeCwd,
            env: stringEnv,
          });
        }
      } else {
        await this.spawnWithoutPtyWindows({
          command,
          allArgs,
          cwd: safeCwd,
          env: stringEnv,
        });
      }
    } else {
      // Always use PTY for proper terminal emulation on non-Windows.
      // We spawn via shell because posix_spawnp doesn't interpret shebangs.
      // Quote each CLI arg for shell safety (prompt is handled separately via temp file)
      const quotedArgs = [command, ...allArgs].map(arg => {
        // Unix: use single quotes
        if (arg.includes("'") || arg.includes(' ') || arg.includes('"')) {
          return `'${arg.replace(/'/g, "'\\''")}'`;
        }
        return arg;
      });

      // Insert the prompt argument after 'run' but before flags.
      // On Unix, quote the prompt with single quotes (literal strings).
      const shellCmd = this.getPlatformShell();
      const runIdx = quotedArgs.indexOf('run');
      if (this.promptFilePath && runIdx >= 0) {
        // Unix: single-quoted strings are literal (no expansion)
        const prompt = fs.readFileSync(this.promptFilePath, 'utf-8');
        const escaped = prompt.replace(/'/g, "'\\''");
        quotedArgs.splice(runIdx + 1, 0, `'${escaped}'`);
      }

      let fullCommand = quotedArgs.join(' ');
      // Truncate log output to avoid flooding console with file content
      const shellCmdMsg = `Full shell command: ${fullCommand.substring(0, 500)}${fullCommand.length > 500 ? '...' : ''}`;
      console.log('[OpenCode CLI]', shellCmdMsg);
      this.emit('debug', { type: 'info', message: shellCmdMsg });

      // Use platform-appropriate shell
      const shellArgs = this.getShellArgs(fullCommand, shellCmd);
      const shellMsg = `Using shell: ${shellCmd}`;
      console.log('[OpenCode CLI]', shellMsg);
      this.emit('debug', { type: 'info', message: shellMsg });

      const ptyModule = await this.getPtyModule();
      this.ptyProcess = ptyModule.spawn(shellCmd, shellArgs, {
        name: 'xterm-256color',
        cols: 200,
        rows: 30,
        cwd: safeCwd,
        env: env as { [key: string]: string },
      });
      const pidMsg = `PTY Process PID: ${this.ptyProcess.pid}`;
      console.log('[OpenCode CLI]', pidMsg);
      this.emit('debug', { type: 'info', message: pidMsg });

      // Handle PTY data (combines stdout/stderr)
      this.ptyProcess.onData((data: string) => {
        // Filter out ANSI escape codes and terminal control sequences for cleaner parsing
        const cleanData = data
          .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\x1B\][^\x07]*\x07/g, '')
          .replace(/\x1B\][^\x1B]*(?:\x1B\\)/g, '')
          .replace(/\r/g, '')
          // Strip control chars that break JSON parsing (keep \n for line splitting).
          .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
        if (cleanData.trim()) {
          this.hasPtyOutput = true;
          if (this.verboseStreamLogs) {
            const truncated = cleanData.substring(0, 500) + (cleanData.length > 500 ? '...' : '');
            console.log('[OpenCode CLI stdout]:', truncated);
          }
          // Send full data to debug panel
          this.emit('debug', { type: 'stdout', message: cleanData });

          // Keep a raw buffer in case JSON parsing fails (non-JSON CLI output).
          this.appendRawOutput(cleanData);
          if (this.rawOutputBuffer.length > 200_000) {
            this.rawOutputBuffer = this.rawOutputBuffer.slice(-200_000);
          }

          this.streamParser.feed(cleanData);
        }
      });

      // Handle PTY exit
      this.ptyProcess.onExit(({ exitCode, signal }) => {
        const exitMsg = `PTY Process exited with code: ${exitCode}, signal: ${signal}`;
        console.log('[OpenCode CLI]', exitMsg);
        this.emit('debug', { type: 'exit', message: exitMsg, data: { exitCode, signal } });
        if (exitCode && !this.hasPtyOutput) {
          this.emit('debug', {
            type: 'warn',
            message: 'PTY exited without output; check shell invocation or model selection.',
          });
        }
        // Flush any trailing JSON without a newline before completing.
        this.streamParser.flush();
        this.handleProcessExit(exitCode);
      });
    }

    return {
      id: taskId,
      prompt: config.prompt,
      status: 'running',
      messages: [],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string, prompt: string): Promise<Task> {
    return this.startTask({
      prompt,
      sessionId,
    });
  }

  /**
   * Send user response for permission/question
   * Note: This requires the PTY to be active
   */
  async sendResponse(response: string): Promise<void> {
    if (this.childProcess) {
      this.childProcess.stdin.write(response + '\n');
      console.log('[OpenCode CLI] Response sent via stdin');
      return;
    }

    if (!this.ptyProcess) {
      throw new Error('No active process');
    }

    this.ptyProcess.write(response + '\n');
    console.log('[OpenCode CLI] Response sent via PTY');
  }

  /**
   * Cancel the current task (hard kill)
   */
  async cancelTask(): Promise<void> {
    this.clearInterruptForceKillTimer();

    if (this.childProcess) {
      try {
        killProcessTree(this.childProcess.pid ?? 0);
        // Fallback if taskkill/process-group kill isn't available.
        this.childProcess.kill();
      } catch {
        // ignore
      }
      this.childProcess = null;
      return;
    }

    if (this.ptyProcess) {
      // Kill the PTY process (best-effort). On some Windows setups, node-pty kill()
      // can throw (e.g., AttachConsole failures). Fall back to taskkill by pid.
      try {
        this.ptyProcess.kill();
      } catch {
        try {
          killProcessTree(this.ptyProcess.pid ?? 0);
        } catch {
          // ignore
        }
      }
      this.ptyProcess = null;
    }
  }

  /**
   * Interrupt the current task (graceful Ctrl+C)
   * Sends SIGINT to allow the CLI to stop gracefully and wait for next input.
   * Unlike cancelTask(), this doesn't kill the process - it just interrupts the current operation.
   */
  async interruptTask(): Promise<void> {
    if (this.childProcess) {
      this.wasInterrupted = true;
      this.clearInterruptForceKillTimer();
      try {
        // Best-effort: some CLIs may treat ETX on stdin as cancel.
        this.childProcess.stdin.write('\x03');
      } catch {
        // ignore
      }
      try {
        // On Windows, SIGINT is unreliable for non-console child processes (and we run with windowsHide).
        // Use taskkill to ensure the Stop button actually stops the running prompt.
        if (process.platform === 'win32') {
          killProcessTree(this.childProcess.pid ?? 0);
          this.childProcess.kill();
        } else {
          this.childProcess.kill('SIGINT');
        }
      } catch {
        // ignore
      }
      console.log('[OpenCode CLI] Sent interrupt signal (non-PTY)');
      return;
    }

    if (!this.ptyProcess) {
      console.log('[OpenCode CLI] No active process to interrupt');
      return;
    }

    // Mark as interrupted so we can handle the exit appropriately
    this.wasInterrupted = true;

    // Send Ctrl+C (ASCII 0x03) to the PTY to interrupt current operation
    this.ptyProcess.write('\x03');
    console.log('[OpenCode CLI] Sent Ctrl+C interrupt signal');
    this.scheduleInterruptForceKill();
  }

  private async spawnWithoutPtyWindows(params: {
    command: string;
    allArgs: string[];
    cwd: string;
    env: { [key: string]: string };
  }): Promise<void> {
    const args = this.buildArgsWithPrompt(params.allArgs);

    const spawnMsg = `Spawning (no PTY): ${params.command} ${args.slice(0, 20).join(' ')}${args.length > 20 ? ' ...' : ''}`;
    console.log('[OpenCode CLI]', spawnMsg);
    this.emit('debug', { type: 'info', message: spawnMsg });

    this.childProcess = spawn(params.command, args, {
      cwd: params.cwd,
      env: params.env,
      // NOTE: Some Windows CLIs (including the bundled OpenCode exe) may hang if spawned
      // without a console. We still hide the window here because this is a fallback path
      // when PTY is unavailable; callers should strongly prefer PTY on win32.
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // OpenCode on Windows can block waiting for stdin EOF when not attached to a PTY.
    // We don't use stdin for normal task execution, so close it immediately.
    try {
      this.childProcess.stdin.end();
    } catch {
      // ignore
    }

    const pidMsg = `Process PID: ${this.childProcess.pid ?? 'unknown'}`;
    console.log('[OpenCode CLI]', pidMsg);
    this.emit('debug', { type: 'info', message: pidMsg });

    const onData = (data: Buffer, stream: 'stdout' | 'stderr') => {
      const raw = data.toString('utf-8');
      // Match PTY cleaning behavior.
      const cleanData = raw
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1B\][^\x07]*\x07/g, '')
        .replace(/\x1B\][^\x1B]*(?:\x1B\\)/g, '')
        .replace(/\r/g, '')
        .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');

      if (!cleanData.trim()) return;
      this.hasPtyOutput = true;
      this.emit('debug', { type: stream, message: cleanData });

      this.appendRawOutput(cleanData);
      if (this.rawOutputBuffer.length > 200_000) {
        this.rawOutputBuffer = this.rawOutputBuffer.slice(-200_000);
      }

      // OpenCode's JSON event stream is on stdout. In dev we may enable --print-logs,
      // which emits plain-text logs to stderr. Avoid feeding stderr into the JSON parser
      // to reduce parse noise and prevent edge-case buffering issues.
      if (stream === 'stdout') {
        this.streamParser.feed(cleanData);
      }
    };

    this.childProcess.stdout.on('data', (d) => onData(d, 'stdout'));
    this.childProcess.stderr.on('data', (d) => onData(d, 'stderr'));

    this.childProcess.on('error', (error) => {
      console.error('[OpenCode CLI] Process spawn error:', error);
      this.emit('error', error);
      this.scheduleComplete({
        status: 'error',
        sessionId: this.currentSessionId || undefined,
        error: error.message,
      });
    });

    this.childProcess.on('close', (code, signal) => {
      const exitMsg = `Process exited with code: ${code ?? 'null'}, signal: ${signal ?? 'null'}`;
      console.log('[OpenCode CLI]', exitMsg);
      this.emit('debug', { type: 'exit', message: exitMsg, data: { exitCode: code, signal } });
      // Flush any trailing JSON without a newline before completing.
      this.streamParser.flush();
      this.childProcess = null;
      this.handleProcessExit(code ?? 0);
    });
  }

  private async spawnPtyWindows(params: {
    ptyModule: typeof import('node-pty');
    command: string;
    allArgs: string[];
    cwd: string;
    env: { [key: string]: string };
  }): Promise<void> {
    const args = this.buildArgsWithPrompt(params.allArgs);

    const spawnMsg = `Spawning (PTY): ${params.command} ${args.slice(0, 20).join(' ')}${args.length > 20 ? ' ...' : ''}`;
    console.log('[OpenCode CLI]', spawnMsg);
    this.emit('debug', { type: 'info', message: spawnMsg });

    this.ptyProcess = params.ptyModule.spawn(params.command, args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 30,
      cwd: params.cwd,
      env: params.env,
    });

    const pidMsg = `PTY Process PID: ${this.ptyProcess.pid}`;
    console.log('[OpenCode CLI]', pidMsg);
    this.emit('debug', { type: 'info', message: pidMsg });

    this.ptyProcess.onData((data: string) => {
      const cleanData = data
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1B\][^\x07]*\x07/g, '')
        .replace(/\x1B\][^\x1B]*(?:\x1B\\)/g, '')
        .replace(/\r/g, '')
        .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');

      if (!cleanData.trim()) return;
      this.hasPtyOutput = true;
      if (this.verboseStreamLogs) {
        const truncated = cleanData.substring(0, 500) + (cleanData.length > 500 ? '...' : '');
        console.log('[OpenCode CLI stdout]:', truncated);
      }
      this.emit('debug', { type: 'stdout', message: cleanData });

      this.appendRawOutput(cleanData);
      if (this.rawOutputBuffer.length > 200_000) {
        this.rawOutputBuffer = this.rawOutputBuffer.slice(-200_000);
      }

      this.streamParser.feed(cleanData);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      const exitMsg = `PTY Process exited with code: ${exitCode}, signal: ${signal}`;
      console.log('[OpenCode CLI]', exitMsg);
      this.emit('debug', { type: 'exit', message: exitMsg, data: { exitCode, signal } });
      this.streamParser.flush();
      this.handleProcessExit(exitCode);
    });
  }

  private buildArgsWithPrompt(allArgs: string[]): string[] {
    // Insert the prompt argument after 'run' but before flags.
    const args = [...allArgs];
    const runIdx = args.indexOf('run');
    if (this.promptFilePath && runIdx >= 0) {
      const prompt = fs.readFileSync(this.promptFilePath, 'utf-8');
      args.splice(runIdx + 1, 0, prompt);
    }
    return args;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get the current task ID
   */
  getTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * Check if the adapter has been disposed
   */
  isAdapterDisposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Dispose the adapter and clean up all resources
   * Called when task completes, is cancelled, or on app quit
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    console.log(`[OpenCode Adapter] Disposing adapter for task ${this.currentTaskId}`);
    this.isDisposed = true;
    this.clearInterruptForceKillTimer();

    // Kill PTY process if running
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch (error) {
        console.error('[OpenCode Adapter] Error killing PTY process:', error);
      }
      this.ptyProcess = null;
    }

    // Kill non-PTY child process if running (Windows path)
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch (error) {
        console.error('[OpenCode Adapter] Error killing child process:', error);
      }
      this.childProcess = null;
    }

    // Clean up temp prompt file
    if (this.promptFilePath) {
      try {
        fs.unlinkSync(this.promptFilePath);
      } catch {
        // Ignore — file may already be gone
      }
      this.promptFilePath = null;
    }

    // Clear state
    this.currentSessionId = null;
    this.currentTaskId = null;
    this.messages = [];
    this.hasCompleted = true;

    // Reset stream parser
    this.streamParser.reset();

    // Remove all listeners
    this.removeAllListeners();

    console.log('[OpenCode Adapter] Adapter disposed');
  }

  /**
   * Build environment variables with all API keys
   */
  private async buildEnvironment(config?: TaskConfig): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
    };

    if (app.isPackaged) {
      // Run the bundled CLI with Electron acting as Node (no system Node required).
      env.ELECTRON_RUN_AS_NODE = '1';

      // Log bundled Node.js configuration
      logBundledNodeInfo();

      // Add bundled Node.js to PATH (highest priority)
      const bundledNode = getBundledNodePaths();
      if (bundledNode) {
        // Prepend bundled Node.js bin directory to PATH
        const delimiter = process.platform === 'win32' ? ';' : ':';
        env.PATH = `${bundledNode.binDir}${delimiter}${env.PATH || ''}`;
        // Also expose as NODE_BIN_PATH so agent can use it in bash commands
        env.NODE_BIN_PATH = bundledNode.binDir;
        console.log('[OpenCode CLI] Added bundled Node.js to PATH:', bundledNode.binDir);
      }

      if (process.platform === 'win32') {
        const delimiter = ';';
        const system32 = 'C:\\Windows\\System32';
        const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0';
        const currentPath = env.PATH || '';
        const pathParts = currentPath.split(delimiter).filter(Boolean);
        if (!pathParts.includes(system32)) {
          pathParts.push(system32);
        }
        if (!pathParts.includes(powershell)) {
          pathParts.push(powershell);
        }
        env.PATH = pathParts.join(delimiter);
      }

      // For packaged apps on macOS, also extend PATH to include common Node.js locations as fallback.
      // This avoids using login shell which triggers folder access permissions.
      if (process.platform === 'darwin') {
        env.PATH = getExtendedNodePath(env.PATH);
        console.log('[OpenCode CLI] Extended PATH for packaged app');
      }
    }

    // Load all API keys
    const apiKeys = await getAllApiKeys();

    if (apiKeys.anthropic) {
      env.ANTHROPIC_API_KEY = apiKeys.anthropic;
      console.log('[OpenCode CLI] Using Anthropic API key from settings');
    }
    if (apiKeys.openai) {
      env.OPENAI_API_KEY = apiKeys.openai;
      console.log('[OpenCode CLI] Using OpenAI API key from settings');
    }
    if (apiKeys.google) {
      env.GOOGLE_GENERATIVE_AI_API_KEY = apiKeys.google;
      console.log('[OpenCode CLI] Using Google API key from settings');
    }
    if (apiKeys.xai) {
      env.XAI_API_KEY = apiKeys.xai;
      console.log('[OpenCode CLI] Using xAI API key from settings');
    }

    // Set Ollama host if configured
    const selectedModel = resolveSelectedModelForAgent(config?.agentId);
    if (
      selectedModel?.provider &&
      selectedModel.provider !== 'anthropic' &&
      selectedModel.provider !== 'openai' &&
      selectedModel.provider !== 'google' &&
      selectedModel.provider !== 'xai' &&
      selectedModel.provider !== 'ollama'
    ) {
      const customProviderKey = await getApiKey(selectedModel.provider);
      if (customProviderKey) {
        // OpenAI-compatible custom providers commonly read OPENAI_API_KEY.
        env.OPENAI_API_KEY = customProviderKey;
      }
    }
    if (selectedModel?.provider === 'ollama' && selectedModel.baseUrl) {
      env.OLLAMA_HOST = selectedModel.baseUrl;
      console.log('[OpenCode CLI] Using Ollama host:', selectedModel.baseUrl);
    }

    // Log config environment variable
    const configPath = this.currentConfigPath || process.env.OPENCODE_CONFIG;
    console.log('[OpenCode CLI] OPENCODE_CONFIG in env:', configPath ?? 'unset');
    if (configPath) {
      env.OPENCODE_CONFIG = configPath;
      console.log('[OpenCode CLI] Passing OPENCODE_CONFIG to subprocess:', env.OPENCODE_CONFIG);
    }

    // Pass task ID to environment for task-scoped page naming in parallel execution
    if (this.currentTaskId) {
      env.ACCOMPLISH_TASK_ID = this.currentTaskId;
      console.log('[OpenCode CLI] Task ID in environment:', this.currentTaskId);
    }

    this.emit('debug', { type: 'info', message: 'Environment configured with API keys' });

    return env;
  }

  private async buildCliArgs(config: TaskConfig): Promise<string[]> {
    // Get selected model from settings
    const selectedModel = resolveSelectedModelForAgent(config.agentId);

    // Write the prompt to a temp file to avoid shell escaping issues.
    // On Windows, PowerShell interprets special characters ($, :, (), etc.)
    // inside double-quoted strings, which corrupts prompts that contain
    // special characters. A temp file bypasses shell interpretation entirely.
    const promptFile = path.join(app.getPath('temp'), `opencode-prompt-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, config.prompt, 'utf-8');
    this.promptFilePath = promptFile;

    // OpenCode CLI uses: opencode run "message" --format json
    // The prompt is inserted into the shell command separately (see startTask)
    // using shell-safe file reading instead of direct string embedding.
    const args = [
      'run',
      '--format', 'json',
    ];

    // IMPORTANT: Always pass an explicit model to avoid interactive prompts/hangs.
    // Prefer the user-selected model directly (google/*, openai/*, anthropic/*, xai/*, opencode/*).
    // Only fall back when no model is configured.
    const selectedId = selectedModel?.model?.trim();
    const speedMode = getRuntimeSpeedMode(config);
    const complexity = detectTaskComplexity(config.prompt);
    const needsBrowser = detectTaskNeedsBrowser(config);
    const likelySkillOrToolTask =
      needsBrowser ||
      complexity !== 'simple' ||
      /\b(file|folder|rename|move|delete|write|edit|create|install|configure|skill|playbook|news|research|scrape|search|build|code|debug|refactor|test)\b/i.test(
        config.prompt
      );
    const fallbackModelByMode: Record<'fast' | 'balanced' | 'deep', string> = {
      // Keep fast responses for very small direct Q&A, but prefer stronger model
      // whenever we expect tool/skill execution.
      fast: likelySkillOrToolTask ? 'opencode/big-pickle' : 'opencode/gpt-5-nano',
      balanced: likelySkillOrToolTask ? 'opencode/big-pickle' : 'opencode/gpt-5-nano',
      deep: 'opencode/big-pickle',
    };
    const modelForCli = selectedId && selectedId.length > 0
      ? selectedId
      : fallbackModelByMode[speedMode];
    args.push('--model', modelForCli);
    console.log(
      '[OpenCode CLI] Using OpenCode model for CLI:',
      modelForCli,
      `(speed=${speedMode}, complexity=${complexity}, needsBrowser=${needsBrowser}, skillOrTool=${likelySkillOrToolTask})`
    );
    if (!selectedId) {
      console.warn('[OpenCode CLI] No model selected; using fallback:', modelForCli);
    }

    // Optional: enable OpenCode internal logs (emits to stderr). Disabled by default because
    // on Windows we run under a PTY (stdout+stderr merged), and OpenCode log lines include
    // embedded JSON snippets that can confuse naive NDJSON parsers.
    if (process.env.OPENDESKMATE_OPENCODE_PRINT_LOGS === '1') {
      args.push('--print-logs', '--log-level', 'INFO');
    }

    // Resume session if specified
    if (config.sessionId) {
      args.push('--session', config.sessionId);
    }

    // Use the Accomplish agent for browser automation guidance
    args.push('--agent', ACCOMPLISH_AGENT_NAME);

    // Attach files via CLI --file flag instead of inlining content into the
    // prompt. This avoids the Windows command-line length limit (~32K chars)
    // which silently truncates large inlined file content.
    if (config.attachedFiles && config.attachedFiles.length > 0) {
      for (const filePath of config.attachedFiles) {
        args.push('--file', filePath);
      }
    }

    return args;
  }

  private async getPtyModule(): Promise<typeof import('node-pty')> {
    if (this.ptyModule) {
      return this.ptyModule;
    }

    try {
      const module = await import('node-pty');
      this.ptyModule = module;
      return module;
    } catch (error) {
      const details =
        process.platform === 'win32'
          ? 'On Windows, install the "C++ Spectre-mitigated libs (v142)" component in Visual Studio Build Tools, then re-run electron-rebuild.'
          : 'Rebuild native modules for Electron and try again.';
      throw new NodePtyUnavailableError(
        `node-pty failed to load. ${details}`
      );
    }
  }

  private setupStreamParsing(): void {
    this.streamParser.on('message', (message: OpenCodeMessage) => {
      this.hasParsedMessages = true;
      this.handleMessage(message);
    });

    // Handle parse errors gracefully to prevent crashes from non-JSON output
    // PTY combines stdout/stderr, so shell banners, warnings, etc. may appear
    this.streamParser.on('error', (error: Error) => {
      // Log but don't crash - non-JSON lines are expected from PTY (shell banners, warnings, etc.)
      console.warn('[OpenCode Adapter] Stream parse warning:', error.message);
      this.emit('debug', { type: 'parse-warning', message: error.message });
    });
  }

  private handleMessage(message: OpenCodeMessage): void {
    if (this.verboseStreamLogs) {
      console.log('[OpenCode Adapter] Handling message type:', message.type);
    }

    switch (message.type) {
      // Step start event
      case 'step_start':
        if (typeof message.part.sessionID === 'string' && message.part.sessionID.trim()) {
          this.currentSessionId = message.part.sessionID;
        }
        this.emit('progress', { stage: 'init', message: 'Task started' });
        break;

      // Text content event
      case 'text':
        if (!this.currentSessionId && typeof message.part.sessionID === 'string' && message.part.sessionID.trim()) {
          this.currentSessionId = message.part.sessionID;
        }
        this.emit('message', message);

        if (message.part.text) {
          const taskMessage: TaskMessage = {
            id: this.generateMessageId(),
            type: 'assistant',
            content: message.part.text,
            timestamp: new Date().toISOString(),
          };
          this.messages.push(taskMessage);
        }
        break;

      // Tool call event
      case 'tool_call':
        const toolName = message.part.tool || 'unknown';
        const toolInput = message.part.input;

        if (this.verboseStreamLogs) {
          console.log('[OpenCode Adapter] Tool call:', toolName);
        }

        // Forward tool call to message pipeline for UI display.
        this.emit('message', message);
        this.emit('tool-use', toolName, toolInput);
        this.emit('progress', {
          stage: 'tool-use',
          message: `Using ${toolName}`,
        });

        // Check if this is AskUserQuestion (requires user input)
        if (toolName === 'AskUserQuestion') {
          this.handleAskUserQuestion(toolInput as AskUserQuestionInput);
        }
        break;

      // Tool use event - combined tool call and result from OpenCode CLI
      case 'tool_use':
        const toolUseMessage = message as import('@accomplish/shared').OpenCodeToolUseMessage;
        const toolUseName = toolUseMessage.part.tool || 'unknown';
        const toolUseInput = toolUseMessage.part.state?.input;
        const toolUseOutput = toolUseMessage.part.state?.output || '';

        // For models that don't emit text messages (like Gemini), emit the tool description
        // as a thinking message so users can see what the AI is doing
        const toolDescription = (toolUseInput as { description?: string })?.description;
        if (toolDescription) {
          // Create a synthetic text message for the description
          const syntheticTextMessage: OpenCodeMessage = {
            type: 'text',
            timestamp: message.timestamp,
            sessionID: message.sessionID,
            part: {
              id: this.generateMessageId(),
              sessionID: toolUseMessage.part.sessionID,
              messageID: toolUseMessage.part.messageID,
              type: 'text',
              text: toolDescription,
            },
          } as import('@accomplish/shared').OpenCodeTextMessage;
          this.emit('message', syntheticTextMessage);
        }

        // Forward to handlers.ts for message processing (screenshots, etc.)
        this.emit('message', message);
        const toolUseStatus = toolUseMessage.part.state?.status;

        if (this.verboseStreamLogs) {
          console.log('[OpenCode Adapter] Tool use:', toolUseName, 'status:', toolUseStatus);
        }

        // Emit tool-use event for the call
        this.emit('tool-use', toolUseName, toolUseInput);
        this.emit('progress', {
          stage: 'tool-use',
          message: `Using ${toolUseName}`,
        });

        // If status is completed or error, also emit tool-result
        if (toolUseStatus === 'completed' || toolUseStatus === 'error') {
          this.emit('tool-result', toolUseOutput);
        }

        // Check if this is AskUserQuestion (requires user input)
        if (toolUseName === 'AskUserQuestion') {
          this.handleAskUserQuestion(toolUseInput as AskUserQuestionInput);
        }
        break;

      // Tool result event
      case 'tool_result':
        const toolOutput = message.part.output || '';
        if (this.verboseStreamLogs) {
          console.log('[OpenCode Adapter] Tool result received, length:', toolOutput.length);
        }
        // Forward tool result to message pipeline for UI display.
        this.emit('message', message);
        this.emit('tool-result', toolOutput);
        break;

      // Step finish event
      case 'step_finish':
        // Forward step_finish so the app can reconcile provider-reported usage (tokens) even
        // though it isn't shown as a chat message.
        this.emit('message', message);
        // Only complete if reason is 'stop' or 'end_turn' (final completion)
        // 'tool_use' means there are more steps coming
        if (message.part.reason === 'stop' || message.part.reason === 'end_turn') {
          this.scheduleComplete({
            status: 'success',
            sessionId: this.currentSessionId || undefined,
          });
        } else if (message.part.reason === 'error') {
          this.scheduleComplete({
            status: 'error',
            sessionId: this.currentSessionId || undefined,
            error: 'Task failed',
          });
        }
        // 'tool_use' reason means agent is continuing, don't emit complete
        break;

      // Error event
      case 'error':
        this.hasCompleted = true;
        this.emit('complete', {
          status: 'error',
          sessionId: this.currentSessionId || undefined,
          error: message.error,
        });
        break;

      default:
        // Cast to unknown to safely access type property for logging
        const unknownMessage = message as unknown as { type: string };
        if (this.verboseStreamLogs) {
          console.log('[OpenCode Adapter] Unknown message type:', unknownMessage.type);
        }
    }
  }

  private handleAskUserQuestion(input: AskUserQuestionInput): void {
    const question = input.questions?.[0];
    if (!question) return;

    const permissionRequest: PermissionRequest = {
      id: this.generateRequestId(),
      taskId: this.currentTaskId || '',
      type: 'question',
      question: question.question,
      options: question.options?.map((o) => ({
        label: o.label,
        description: o.description,
      })),
      multiSelect: question.multiSelect,
      createdAt: new Date().toISOString(),
    };

    this.emit('permission-request', permissionRequest);
  }

  private handleProcessExit(code: number | null): void {
    this.clearInterruptForceKillTimer();

    if (!this.hasParsedMessages && this.rawOutputBuffer.trim()) {
      const cleaned = this.buildFallbackAssistantText(this.rawOutputBuffer);
      if (cleaned) {
        const msgId = this.generateMessageId();
        const synthetic: OpenCodeMessage = {
          type: 'text',
          timestamp: Date.now(),
          sessionID: this.currentSessionId || undefined,
          part: {
            id: msgId,
            sessionID: this.currentSessionId || 'unknown',
            messageID: msgId,
            type: 'text',
            text: cleaned,
          },
        };
        this.handleMessage(synthetic);
      }
    }

    // Only emit complete/error if we haven't already received a result message
    if (!this.hasCompleted && !this.pendingComplete) {
      if (this.wasInterrupted) {
        // User interrupted the task - emit interrupted status so they can continue
        console.log('[OpenCode CLI] Task was interrupted by user');
        this.emit('complete', {
          status: 'interrupted',
          sessionId: this.currentSessionId || undefined,
        });
      } else if (code === 0) {
        // Normal exit without result message
        this.emit('complete', {
          status: 'success',
          sessionId: this.currentSessionId || undefined,
        });
      } else if (code !== null) {
        // Error exit
        this.emit('error', new Error(`OpenCode CLI exited with code ${code}`));
      }
    }

    this.ptyProcess = null;
    this.currentTaskId = null;
  }

  private scheduleComplete(result: TaskResult): void {
    if (this.hasCompleted) {
      return;
    }

    this.pendingComplete = result;
    if (this.completeTimer) {
      clearTimeout(this.completeTimer);
    }

    // Defer completion so any trailing messages in the same chunk are processed first.
    this.completeTimer = setTimeout(() => {
      this.completeTimer = null;
      if (this.hasCompleted) {
        return;
      }
      // Flush any trailing JSON without a newline before marking complete.
      this.streamParser.flush();
      this.hasCompleted = true;
      this.emit('complete', result);
      this.pendingComplete = null;
    }, 0);
  }

  private scheduleInterruptForceKill(): void {
    this.clearInterruptForceKillTimer();

    this.interruptForceKillTimer = setTimeout(() => {
      this.interruptForceKillTimer = null;

      if (!this.childProcess && !this.ptyProcess) {
        return;
      }

      console.warn(
        `[OpenCode CLI] Interrupt did not stop task within ${OpenCodeAdapter.INTERRUPT_FORCE_KILL_MS}ms; forcing termination`
      );

      if (this.childProcess) {
        try {
          killProcessTree(this.childProcess.pid ?? 0);
          this.childProcess.kill();
        } catch {
          // ignore
        }
        return;
      }

      if (this.ptyProcess) {
        const pid = this.ptyProcess.pid ?? 0;
        try {
          this.ptyProcess.kill();
        } catch {
          // ignore, we always try taskkill/process tree next
        }
        try {
          killProcessTree(pid);
        } catch {
          // ignore
        }
      }

      // Last-resort: if the process did not emit an exit event quickly, force
      // local completion so the task queue/UI cannot stay blocked indefinitely.
      setTimeout(() => {
        if (!this.childProcess && !this.ptyProcess) return;
        if (this.hasCompleted || this.pendingComplete) return;
        console.warn('[OpenCode CLI] Forcing local interrupted completion after failed interrupt shutdown');
        this.handleProcessExit(130);
      }, 150).unref?.();
    }, OpenCodeAdapter.INTERRUPT_FORCE_KILL_MS);

    // Avoid keeping app alive on shutdown just because the timer exists.
    this.interruptForceKillTimer.unref?.();
  }

  private clearInterruptForceKillTimer(): void {
    if (!this.interruptForceKillTimer) return;
    clearTimeout(this.interruptForceKillTimer);
    this.interruptForceKillTimer = null;
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private appendRawOutput(chunk: string): void {
    if (!chunk) return;
    const needsNewline =
      this.rawOutputBuffer.length > 0
      && !this.rawOutputBuffer.endsWith('\n')
      && !chunk.startsWith('\n');
    this.rawOutputBuffer += needsNewline ? `\n${chunk}` : chunk;
  }

  private buildFallbackAssistantText(raw: string): string {
    const cleaned = raw
      .replace(/\[\?25[hl]/g, '')
      .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\r/g, '');
    const lines = cleaned.split('\n').map((line) => line.trimEnd());
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    if (nonEmpty.length === 0) return '';

    let startIndex = 0;
    const lastToolHeader = (() => {
      for (let i = nonEmpty.length - 1; i >= 0; i -= 1) {
        if (/^\|\s+\w+/.test(nonEmpty[i])) {
          return i;
        }
      }
      return -1;
    })();

    if (lastToolHeader >= 0) {
      for (let i = lastToolHeader + 1; i < nonEmpty.length; i += 1) {
        const line = nonEmpty[i].trim();
        if (this.isLikelyAssistantLine(line)) {
          startIndex = i;
          break;
        }
      }
      if (startIndex === 0) {
        startIndex = Math.min(lastToolHeader + 1, nonEmpty.length - 1);
      }
    }

    const trimmedLines = nonEmpty.slice(startIndex);
    const text = trimmedLines.join('\n').trim();
    return text;
  }

  private isLikelyAssistantLine(line: string): boolean {
    if (!line) return false;
    if (/^\|\s+\w+/.test(line)) return false;
    if (line.length < 4) return false;
    if (/^[^a-zA-Z]*$/.test(line)) return false;
    if (/^[\w.-]+(\s+[\w.-]+)*$/.test(line) && !line.includes(' ')) {
      return false;
    }
    if (/[.?!:]/.test(line)) return true;
    if (/[`]/.test(line)) return true;
    if (/^(i|i'm|i am|here|how|the|you|we|it|there)\b/i.test(line)) return true;
    return line.length > 60 && line.split(' ').length > 3;
  }

  /**
   * Get platform-appropriate shell command
   *
   * In packaged apps on macOS, we use /bin/sh instead of the user's shell
   * to avoid loading ANY user config files. Even non-login zsh loads ~/.zshenv
   * which may reference protected folders and trigger TCC permission dialogs.
   *
   * /bin/sh with -c flag doesn't load any user configuration.
   */
  private getPlatformShell(): string {
    if (process.platform === 'win32') {
      // Use PowerShell on Windows for better compatibility; fallback to cmd.exe
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const powershellPath = path.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      );
      if (fs.existsSync(powershellPath)) {
        return powershellPath;
      }
      return 'cmd.exe';
    } else if (app.isPackaged && process.platform === 'darwin') {
      // In packaged macOS apps, use /bin/sh to avoid loading user shell configs
      // (zsh always loads ~/.zshenv, which may trigger TCC permissions)
      return '/bin/sh';
    } else {
      // In dev mode, use the user's shell for better compatibility
      const userShell = process.env.SHELL;
      if (userShell) {
        return userShell;
      }
      // Fallback chain: bash -> zsh -> sh
      if (fs.existsSync('/bin/bash')) return '/bin/bash';
      if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
      return '/bin/sh';
    }
  }

  /**
   * Get shell arguments for running a command
   *
   * Note: We intentionally do NOT use login shell (-l) on macOS to avoid
   * triggering folder access permissions (TCC). Login shells load ~/.zprofile
   * and ~/.zshrc which may reference protected folders like Desktop/Documents.
   *
   * Instead, we extend PATH in buildEnvironment() using path_helper and common
   * Node.js installation paths. This is the proper macOS approach for GUI apps.
   */
  private getShellArgs(command: string, shellCmd: string): string[] {
    if (process.platform === 'win32') {
      if (/powershell\.exe$/i.test(shellCmd)) {
        const utf8Preamble = '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();';
        return ['-NoProfile', '-Command', `${utf8Preamble} ${command}`];
      }
      // cmd.exe: force UTF-8 codepage for consistent output
      return ['/d', '/s', '/c', `chcp 65001 >NUL & ${command}`];
    } else {
      // Unix shells: -c to run command (no -l to avoid profile loading)
      return ['-c', command];
    }
  }
}

interface AskUserQuestionInput {
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

/**
 * Factory function to create a new adapter instance
 * Use this for the new per-task architecture via TaskManager
 */
export function createAdapter(taskId?: string): OpenCodeAdapter {
  return new OpenCodeAdapter(taskId);
}

/**
 * @deprecated Use TaskManager and createAdapter() instead.
 * Singleton instance kept for backward compatibility during migration.
 */
let adapterInstance: OpenCodeAdapter | null = null;

/**
 * @deprecated Use TaskManager and createAdapter() instead.
 * Get the legacy singleton adapter instance.
 */
export function getOpenCodeAdapter(): OpenCodeAdapter {
  if (!adapterInstance) {
    adapterInstance = new OpenCodeAdapter();
  }
  return adapterInstance;
}
