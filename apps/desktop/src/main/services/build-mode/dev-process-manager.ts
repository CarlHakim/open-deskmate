import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { app } from 'electron';
import type {
  BuildBuildRequest,
  BuildLogEntry,
  BuildLogsResponse,
  BuildRuntimeCommandResult,
  BuildRuntimeState,
  BuildSessionSnapshot,
  BuildStartEntry,
  BuildStartRequest,
} from '@accomplish/shared';
import { detectProjectRuntime, parseRuntimeDiagnosticLine, type RuntimeStructuredDiagnostic } from './runtime-adapters';
import { resolvePathInWorkspace } from './file-service';
import { buildRuntimeRepairPrompt } from './repair-prompt';

const MAX_LOG_LINES = 2_500;
const MAX_STRUCTURED_DIAGNOSTICS = 120;
const DEFAULT_LOG_LIMIT = 300;
const MAX_AUTO_RESTARTS = 3;
const RUNTIME_PID_REGISTRY_FILE = 'build-runtime-pids.json';
const RUNTIME_PID_TTL_MS = 12 * 60 * 60 * 1000;

interface PersistedRuntimePidRecord {
  pid: number;
  recordedAtMs: number;
}

interface PersistedRuntimePidRegistry {
  version: 1;
  entries: PersistedRuntimePidRecord[];
}

interface BuildSession {
  agentId: string;
  workspaceRoot: string;
  workspaceRelativePath: string;
  detection: BuildSessionSnapshot['detection'];
  runtime: BuildRuntimeState;
  process: ChildProcess | null;
  processes: Array<{
    child: ChildProcess;
    command: string;
    workspaceRoot: string;
    workspaceRelativePath: string;
    role: 'preview' | 'worker';
    label: string;
    isPrimary: boolean;
  }>;
  killRequested: boolean;
  runToken: number;
  stdoutBuffer: string;
  stderrBuffer: string;
  logs: BuildLogEntry[];
  nextSeq: number;
  healthTimer: NodeJS.Timeout | null;
  restartTimer: NodeJS.Timeout | null;
  structuredDiagnostics: RuntimeStructuredDiagnostic[];
  structuredDiagnosticKeys: Set<string>;
}

class DevProcessManager {
  private sessions = new Map<string, BuildSession>();
  private runtimePidRegistry = new Map<number, number>();
  private runtimePidRegistryLoaded = false;

  async getSnapshot(agentId: string, workspaceRelativePath = '.'): Promise<BuildSessionSnapshot> {
    const session = await this.ensureSession(agentId, workspaceRelativePath);
    return this.toSnapshot(session);
  }

  async getActiveSnapshot(agentId: string): Promise<BuildSessionSnapshot> {
    const session = await this.getOrCreateSession(agentId);
    return this.toSnapshot(session);
  }

  private resolveStartEntries(
    session: BuildSession,
    mode: 'dev' | 'run',
    commandOverride?: string,
    startEntries?: BuildStartEntry[]
  ): BuildStartEntry[] {
    const normalizedEntries = Array.isArray(startEntries)
      ? startEntries
        .map((entry) => ({
          command: typeof entry?.command === 'string' ? entry.command.trim() : '',
          workspaceRelativePath: typeof entry?.workspaceRelativePath === 'string' ? entry.workspaceRelativePath.trim() : '',
          role: entry?.role === 'worker'
            ? ('worker' as const)
            : entry?.role === 'preview'
              ? ('preview' as const)
              : undefined,
        }))
        .filter((entry) => entry.command.length > 0)
      : [];

    if (normalizedEntries.length > 0) {
      let previewAssigned = false;
      return normalizedEntries.map((entry, index) => {
        if (entry.role === 'preview') {
          previewAssigned = true;
          return entry;
        }
        if (!previewAssigned && index === 0) {
          previewAssigned = true;
          return { ...entry, role: 'preview' as const };
        }
        return { ...entry, role: 'worker' as const };
      });
    }

    const command = this.resolveStartCommand(session, mode, commandOverride);
    if (!command) return [];
    return [{
      command,
      role: 'preview',
    }];
  }

  private resolveStartEntryWorkspaceRelativePath(session: BuildSession, entry: BuildStartEntry): string {
    const base = session.workspaceRelativePath || '.';
    const extra = typeof entry.workspaceRelativePath === 'string' ? entry.workspaceRelativePath.trim() : '';
    if (!extra || extra === '.') return base;
    const combined = path.posix.normalize(path.posix.join(base.replace(/\\/g, '/'), extra.replace(/\\/g, '/')));
    return combined === '' ? '.' : combined;
  }

  private hasRunningProcesses(session: BuildSession): boolean {
    return session.processes.some((entry) => this.isAlive(entry.child));
  }

  private activeProcessEntries(session: BuildSession) {
    return session.processes.filter((entry) => this.isAlive(entry.child));
  }

  async startDevelopmentProcess(request: BuildStartRequest): Promise<BuildSessionSnapshot> {
    const session = await this.ensureSession(request.agentId, request.workspaceRelativePath);
    const mode = request.mode === 'run' ? 'run' : 'dev';

    if (this.hasRunningProcesses(session) && !request.forceRestart) {
      this.appendLog(session, 'system', 'Process already running; duplicate launch prevented.');
      return this.toSnapshot(session);
    }

    if (this.hasRunningProcesses(session) && request.forceRestart) {
      await this.stopProcess(request.agentId);
    }

    const startEntries = this.resolveStartEntries(session, mode, request.commandOverride, request.startEntries);
    if (startEntries.length === 0) {
      throw new Error('No runnable start command found. Add dev/start scripts in package.json or provide command override.');
    }
    const primaryEntry = startEntries.find((entry) => entry.role === 'preview') || startEntries[0];

    const shouldAllocatePort = session.detection.requiresPort;
    const portHint = Number.isFinite(request.portHint) ? Math.max(1_024, Math.min(65_535, Math.floor(request.portHint as number))) : undefined;
    const port = shouldAllocatePort
      ? (portHint || await findAvailablePort(session.detection.defaultPort ?? 3000))
      : undefined;

    this.clearRestartTimer(session);
    this.clearHealthTimer(session);
    session.structuredDiagnostics = [];
    session.structuredDiagnosticKeys.clear();

    session.killRequested = false;
    session.runToken += 1;
    const runToken = session.runToken;
    session.runtime = {
      ...session.runtime,
      status: 'starting',
      mode,
      activeCommand: startEntries.map((entry) => entry.command).join(' | '),
      activeStartEntries: startEntries.map((entry) => ({ ...entry })),
      port,
      previewUrl: port ? `http://127.0.0.1:${port}` : undefined,
      startedAt: new Date().toISOString(),
      stoppedAt: undefined,
      lastExitCode: undefined,
      lastExitSignal: undefined,
      lastError: undefined,
      healthy: undefined,
      healthMessage: undefined,
      autoRestart: request.autoRestart ?? session.runtime.autoRestart,
    };

    this.appendLog(session, 'system', `Starting ${mode} process${startEntries.length > 1 ? ' group' : ''}: ${startEntries.map((entry) => entry.command).join(' | ')}`);
    if (port) {
      this.appendLog(session, 'system', `Allocated port ${port} for runtime.`);
    }
    const managedProcesses = startEntries.map((entry, index) => {
      const workspaceRelativePath = this.resolveStartEntryWorkspaceRelativePath(session, entry);
      const workspaceRoot = resolvePathInWorkspace(session.agentId, workspaceRelativePath);
      const isPrimary = entry === primaryEntry;
      const child = spawn(entry.command, {
        cwd: workspaceRoot,
        env: buildRuntimeEnv({
          mode,
          envOverrides: request.envOverrides,
          port: isPrimary ? port : undefined,
        }),
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const label = entry.role === 'preview'
        ? 'preview'
        : (startEntries.length > 1 ? `worker ${index}` : 'runtime');

      this.registerRuntimePid(child.pid);

      child.stdout?.on('data', (chunk: Buffer | string) => {
        if (runToken !== session.runToken) return;
        this.handleProcessOutput(session, 'stdout', chunk.toString(), startEntries.length > 1 ? label : undefined);
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        if (runToken !== session.runToken) return;
        this.handleProcessOutput(session, 'stderr', chunk.toString(), startEntries.length > 1 ? label : undefined);
      });

      child.on('error', (error) => {
        if (runToken !== session.runToken) return;
        session.runtime.status = 'error';
        session.runtime.lastError = error.message;
        session.runtime.suggestedRepairPrompt = this.buildRepairPrompt(session);
        session.runtime.autoRepairRequestedAt = new Date().toISOString();
        this.appendLog(session, 'system', `${label} spawn error: ${error.message}`);
      });

      child.on('exit', (exitCode, signal) => {
        this.unregisterRuntimePid(child.pid);
        if (runToken !== session.runToken) return;
        session.processes = session.processes.filter((item) => item.child.pid !== child.pid);
        if (isPrimary) {
          session.process = null;
        }
        const aliveProcesses = this.activeProcessEntries(session);
        session.runtime.lastExitCode = exitCode;
        session.runtime.lastExitSignal = signal;
        session.runtime.stoppedAt = new Date().toISOString();

        if (session.killRequested) {
          if (aliveProcesses.length === 0) {
            this.clearHealthTimer(session);
            session.runtime.status = 'stopped';
            session.runtime.healthy = undefined;
            this.appendLog(session, 'system', 'Process stopped.');
          }
          return;
        }

        if (exitCode === 0) {
          if (aliveProcesses.length === 0) {
            this.clearHealthTimer(session);
            session.runtime.status = 'stopped';
            session.runtime.healthy = undefined;
            this.appendLog(session, 'system', 'Process exited normally.');
          } else {
            this.appendLog(session, 'system', `${label} exited normally.`);
          }
          return;
        }

        const failingMessage = `${label} exited with code ${exitCode ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;
        session.runtime.status = 'error';
        session.runtime.crashCount += 1;
        session.runtime.healthy = false;
        session.runtime.lastError = failingMessage;
        session.runtime.suggestedRepairPrompt = this.buildRepairPrompt(session);
        session.runtime.autoRepairRequestedAt = new Date().toISOString();
        this.appendLog(session, 'system', failingMessage);

        const processesToStop = [...aliveProcesses];
        session.runToken += 1;
        session.killRequested = true;
        session.process = null;
        session.processes = [];
        this.clearHealthTimer(session);
        for (const processEntry of processesToStop) {
          const pid = processEntry.child.pid;
          if (typeof pid === 'number') {
            void killProcessTree(pid).catch(() => {});
            this.unregisterRuntimePid(pid);
          }
        }

        if (session.runtime.autoRestart && session.runtime.restartCount < MAX_AUTO_RESTARTS) {
          session.runtime.restartCount += 1;
          this.appendLog(session, 'system', `Auto-restart scheduled (${session.runtime.restartCount}/${MAX_AUTO_RESTARTS})...`);
          session.restartTimer = setTimeout(() => {
            void this.startDevelopmentProcess({
              agentId: session.agentId,
              workspaceRelativePath: session.workspaceRelativePath,
              mode: session.runtime.mode,
              autoRestart: session.runtime.autoRestart,
              startEntries: session.runtime.activeStartEntries,
              envOverrides: request.envOverrides,
            }).catch((error) => {
              this.appendLog(session, 'system', `Auto-restart failed: ${error instanceof Error ? error.message : String(error)}`);
            });
          }, 1500);
        }
      });

      return {
        child,
        command: entry.command,
        workspaceRoot,
        workspaceRelativePath,
        role: entry.role === 'worker' ? ('worker' as const) : ('preview' as const),
        label,
        isPrimary,
      };
    });

    session.processes = managedProcesses;
    session.process = managedProcesses.find((entry) => entry.isPrimary)?.child || managedProcesses[0]?.child || null;

    if (session.runtime.port && session.detection.requiresPort) {
      this.startHealthPolling(session);
    }

    return this.toSnapshot(session);
  }

  async stopProcess(agentId: string): Promise<BuildSessionSnapshot> {
    const session = await this.getOrCreateSession(agentId);

    if (!this.hasRunningProcesses(session)) {
      this.clearRestartTimer(session);
      this.clearHealthTimer(session);
      session.process = null;
      session.processes = [];
      session.runtime.status = 'stopped';
      session.runtime.stoppedAt = new Date().toISOString();
      session.runtime.healthy = undefined;
      return this.toSnapshot(session);
    }

    session.killRequested = true;
    session.runToken += 1;
    this.clearRestartTimer(session);
    this.clearHealthTimer(session);

    const processes = [...session.processes];
    for (const processEntry of processes) {
      const pid = processEntry.child.pid;
      if (typeof pid === 'number') {
        await killProcessTree(pid);
        this.unregisterRuntimePid(pid);
      }
    }

    session.process = null;
    session.processes = [];
    session.runtime.status = 'stopped';
    session.runtime.stoppedAt = new Date().toISOString();
    session.runtime.healthy = undefined;
    this.appendLog(session, 'system', 'Stop requested by user.');

    return this.toSnapshot(session);
  }

  async restartProcess(agentId: string): Promise<BuildSessionSnapshot> {
    const session = await this.getOrCreateSession(agentId);
    await this.stopProcess(agentId);
    return this.startDevelopmentProcess({
      agentId,
      workspaceRelativePath: session.workspaceRelativePath,
      mode: session.runtime.mode,
      autoRestart: session.runtime.autoRestart,
      startEntries: session.runtime.activeStartEntries,
      envOverrides: undefined,
      forceRestart: true,
    });
  }

  async runBuildCommand(request: BuildBuildRequest): Promise<{ snapshot: BuildSessionSnapshot; result: BuildRuntimeCommandResult }> {
    const session = await this.ensureSession(request.agentId, request.workspaceRelativePath);
    const command = request.commandOverride || session.detection.commands.buildCommand;
    if (!command) {
      throw new Error('No build command found for this project.');
    }

    const startedAt = new Date();
    this.appendLog(session, 'system', `Running build command: ${command}`);

    const result = await this.runOneShotCommand(session, command, request.envOverrides, 'build');
    session.runtime.buildStatus = result.ok ? 'success' : 'failed';

    if (!result.ok) {
      session.runtime.status = 'error';
      session.runtime.lastError = result.summary;
      session.runtime.suggestedRepairPrompt = this.buildRepairPrompt(session);
      session.runtime.autoRepairRequestedAt = new Date().toISOString();
    }

    return {
      snapshot: this.toSnapshot(session),
      result: {
        ...result,
        startedAt: startedAt.toISOString(),
      },
    };
  }

  async runStartCommandOnce(
    agentId: string,
    workspaceRelativePath = '.',
    envOverrides?: Record<string, string>,
    commandOverride?: string
  ): Promise<{ snapshot: BuildSessionSnapshot; result: BuildRuntimeCommandResult }> {
    const session = await this.ensureSession(agentId, workspaceRelativePath);
    let command = commandOverride?.trim() || session.detection.commands.runCommand || session.detection.commands.startCommand;
    if (!command) {
      throw new Error('No run command found for this project.');
    }

    if (shouldFallbackToDevCommandForRunOnce(session)) {
      const devCommand = session.detection.commands.startCommand;
      if (devCommand && devCommand.trim() && devCommand.trim() !== command) {
        this.appendLog(
          session,
          'system',
          'No Next.js production build detected (.next/BUILD_ID missing). Falling back to dev command for one-shot preview.'
        );
        command = devCommand.trim();
      }
    }

    const oneShotPort = session.detection.requiresPort
      ? await findAvailablePort(session.detection.defaultPort ?? 3000)
      : undefined;
    if (oneShotPort) {
      session.runtime.port = oneShotPort;
      session.runtime.previewUrl = `http://127.0.0.1:${oneShotPort}`;
      this.appendLog(session, 'system', `Allocated port ${oneShotPort} for one-shot run.`);
    }

    this.appendLog(session, 'system', `Running one-shot command: ${command}`);
    const result = await this.runOneShotCommand(session, command, envOverrides, 'run', oneShotPort);
    return {
      snapshot: this.toSnapshot(session),
      result,
    };
  }

  async getLogs(agentId: string, cursor = 0, limit = DEFAULT_LOG_LIMIT): Promise<BuildLogsResponse> {
    const session = await this.getOrCreateSession(agentId);
    const safeCursor = Math.max(0, Math.floor(cursor));
    const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
    const logs = session.logs.filter((entry) => entry.seq > safeCursor).slice(0, safeLimit);
    const nextCursor = logs.length > 0 ? logs[logs.length - 1].seq : safeCursor;
    return { logs, nextCursor };
  }

  async clearLogs(agentId: string): Promise<void> {
    const session = await this.getOrCreateSession(agentId);
    session.logs = [];
    session.nextSeq = 1;
    session.stdoutBuffer = '';
    session.stderrBuffer = '';
    session.structuredDiagnostics = [];
    session.structuredDiagnosticKeys.clear();
  }

  async disposeAll(): Promise<void> {
    const entries = Array.from(this.sessions.entries());
    for (const [agentId, session] of entries) {
      try {
        await this.stopProcess(agentId);
      } catch {
        // Best-effort cleanup during app shutdown.
      } finally {
        this.clearRestartTimer(session);
        this.clearHealthTimer(session);
      }
    }
    this.sessions.clear();
    this.runtimePidRegistry.clear();
    this.persistRuntimePidRegistry();
  }

  async cleanupPersistedRuntimeProcessesOnStartup(): Promise<number> {
    this.ensureRuntimePidRegistryLoaded();
    const now = Date.now();
    const candidates = Array.from(this.runtimePidRegistry.entries())
      .filter(([pid, recordedAtMs]) => Number.isInteger(pid)
        && pid > 0
        && pid !== process.pid
        && Number.isFinite(recordedAtMs)
        && recordedAtMs > 0
        && (now - recordedAtMs) <= RUNTIME_PID_TTL_MS)
      .map(([pid]) => pid);

    let killedCount = 0;
    for (const pid of candidates) {
      try {
        await killProcessTree(pid);
        killedCount += 1;
      } catch {
        // Best-effort cleanup; ignore stale PID failures.
      } finally {
        this.runtimePidRegistry.delete(pid);
      }
    }

    for (const [pid, recordedAtMs] of Array.from(this.runtimePidRegistry.entries())) {
      if (!Number.isFinite(recordedAtMs) || (now - recordedAtMs) > RUNTIME_PID_TTL_MS) {
        this.runtimePidRegistry.delete(pid);
      }
    }

    this.persistRuntimePidRegistry();
    return killedCount;
  }

  private async ensureSession(agentId: string, workspaceRelativePath = '.'): Promise<BuildSession> {
    const key = normalizeAgentKey(agentId);
    let session = this.sessions.get(key);
    const normalizedRelativePath = workspaceRelativePath || '.';

    if (!session) {
      const workspaceRoot = resolvePathInWorkspace(key, normalizedRelativePath);
      const detection = detectProjectRuntime(workspaceRoot);
      session = {
        agentId: key,
        workspaceRoot,
        workspaceRelativePath: normalizedRelativePath,
        detection,
        runtime: {
          status: 'stopped',
          mode: 'dev',
          buildStatus: 'unknown',
          restartCount: 0,
          crashCount: 0,
          autoRestart: true,
        },
        process: null,
        processes: [],
        killRequested: false,
        runToken: 0,
        stdoutBuffer: '',
        stderrBuffer: '',
        logs: [],
        nextSeq: 1,
        healthTimer: null,
        restartTimer: null,
        structuredDiagnostics: [],
        structuredDiagnosticKeys: new Set<string>(),
      };
      this.sessions.set(key, session);
      return session;
    }

    const desiredRoot = resolvePathInWorkspace(key, normalizedRelativePath);
    if (session.workspaceRoot !== desiredRoot) {
      if (this.hasRunningProcesses(session)) {
        throw new Error('Cannot switch workspace path while process is running. Stop runtime first.');
      }

      session.workspaceRoot = desiredRoot;
      session.workspaceRelativePath = normalizedRelativePath;
      session.detection = detectProjectRuntime(desiredRoot);
      session.runtime.buildStatus = 'unknown';
      session.runtime.suggestedRepairPrompt = undefined;
      session.structuredDiagnostics = [];
      session.structuredDiagnosticKeys.clear();
      this.appendLog(session, 'system', `Workspace switched to ${normalizedRelativePath}.`);
    }

    if (!session.detection) {
      session.detection = detectProjectRuntime(session.workspaceRoot);
    }

    return session;
  }

  private async getOrCreateSession(agentId: string): Promise<BuildSession> {
    const key = normalizeAgentKey(agentId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    return this.ensureSession(agentId, '.');
  }

  private resolveStartCommand(
    session: BuildSession,
    mode: 'dev' | 'run',
    override?: string
  ): string | null {
    if (override && override.trim()) return override.trim();
    if (mode === 'run') {
      return session.detection.commands.runCommand ?? session.detection.commands.startCommand;
    }
    return session.detection.commands.startCommand ?? session.detection.commands.runCommand;
  }

  private startHealthPolling(session: BuildSession): void {
    this.clearHealthTimer(session);

    const runProbe = async () => {
      const port = session.runtime.port;
      if (!port || session.runtime.status !== 'running') return;
      const url = `http://127.0.0.1:${port}${session.detection.healthCheckPath || '/'}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);

      try {
        const response = await fetch(url, { signal: controller.signal });
        session.runtime.healthy = response.ok;
        session.runtime.healthMessage = response.ok ? `Healthy (${response.status})` : `Unhealthy (${response.status})`;
        session.runtime.lastHealthCheckAt = new Date().toISOString();
      } catch (error) {
        session.runtime.healthy = false;
        session.runtime.healthMessage = error instanceof Error ? error.message : String(error);
        session.runtime.lastHealthCheckAt = new Date().toISOString();
      } finally {
        clearTimeout(timer);
      }
    };

    void runProbe();

    session.healthTimer = setInterval(() => {
      void runProbe();
    }, 5000);
  }

  private clearHealthTimer(session: BuildSession): void {
    if (session.healthTimer) {
      clearInterval(session.healthTimer);
      session.healthTimer = null;
    }
  }

  private clearRestartTimer(session: BuildSession): void {
    if (session.restartTimer) {
      clearTimeout(session.restartTimer);
      session.restartTimer = null;
    }
  }

  private handleProcessOutput(session: BuildSession, stream: 'stdout' | 'stderr', text: string, label?: string): void {
    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    const combined = `${session[key]}${text}`;
    const parts = combined.split(/\r?\n/);
    session[key] = parts.pop() || '';

    for (const rawLine of parts) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const loggedLine = label ? `[${label}] ${line}` : line;
      this.appendLog(session, stream, loggedLine);
      this.inspectLogForRuntimeSignals(session, line);
      this.captureStructuredDiagnostic(session, line);
    }

    if (session.runtime.status === 'starting') {
      session.runtime.status = 'running';
    }
  }

  private inspectLogForRuntimeSignals(session: BuildSession, line: string): void {
    const urlMatch = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[a-z0-9.-]+):(\d{2,5})(?:\/[\w\-./?%&=]*)?/i);
    if (urlMatch) {
      const parsedPort = Number.parseInt(urlMatch[1] || '', 10);
      if (Number.isFinite(parsedPort) && parsedPort > 0) {
        session.runtime.port = parsedPort;
        session.runtime.previewUrl = `http://127.0.0.1:${parsedPort}`;
      }
    }

    const fallbackPortMatch = line.match(/\b(?:port|localhost)\D{0,10}(\d{2,5})\b/i);
    if (!session.runtime.port && fallbackPortMatch) {
      const parsedPort = Number.parseInt(fallbackPortMatch[1] || '', 10);
      if (Number.isFinite(parsedPort) && parsedPort > 0) {
        session.runtime.port = parsedPort;
        session.runtime.previewUrl = `http://127.0.0.1:${parsedPort}`;
      }
    }
  }

  private captureStructuredDiagnostic(session: BuildSession, rawLine: string): void {
    const parsed = parseRuntimeDiagnosticLine(
      session.detection.runtimeAdapterId,
      rawLine,
      session.workspaceRoot,
    );
    if (!parsed) return;
    const dedupeKey = buildStructuredDiagnosticKey(parsed);
    if (session.structuredDiagnosticKeys.has(dedupeKey)) return;
    session.structuredDiagnosticKeys.add(dedupeKey);
    session.structuredDiagnostics.push(parsed);
    if (session.structuredDiagnostics.length > MAX_STRUCTURED_DIAGNOSTICS) {
      const overflow = session.structuredDiagnostics.length - MAX_STRUCTURED_DIAGNOSTICS;
      session.structuredDiagnostics.splice(0, overflow);
      const keySet = new Set<string>();
      for (const diagnostic of session.structuredDiagnostics) {
        keySet.add(buildStructuredDiagnosticKey(diagnostic));
      }
      session.structuredDiagnosticKeys = keySet;
    }
  }

  private appendLog(session: BuildSession, stream: BuildLogEntry['stream'], line: string): void {
    const entry: BuildLogEntry = {
      seq: session.nextSeq++,
      at: new Date().toISOString(),
      stream,
      line,
    };
    session.logs.push(entry);
    if (session.logs.length > MAX_LOG_LINES) {
      session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
    }
  }

  private buildRepairPrompt(session: BuildSession): string {
    return buildRuntimeRepairPrompt(session);
  }

  private toSnapshot(session: BuildSession): BuildSessionSnapshot {
    return {
      agentId: session.agentId,
      workspaceRoot: session.workspaceRoot,
      workspaceRelativePath: session.workspaceRelativePath,
      detection: session.detection,
      runtime: { ...session.runtime },
    };
  }

  private isAlive(child: ChildProcess): boolean {
    return child.exitCode === null && !child.killed;
  }

  private registerRuntimePid(pid: number | undefined): void {
    if (!Number.isInteger(pid) || (pid as number) <= 0) return;
    this.ensureRuntimePidRegistryLoaded();
    this.runtimePidRegistry.set(pid as number, Date.now());
    this.persistRuntimePidRegistry();
  }

  private unregisterRuntimePid(pid: number | undefined): void {
    if (!Number.isInteger(pid) || (pid as number) <= 0) return;
    this.ensureRuntimePidRegistryLoaded();
    if (this.runtimePidRegistry.delete(pid as number)) {
      this.persistRuntimePidRegistry();
    }
  }

  private ensureRuntimePidRegistryLoaded(): void {
    if (this.runtimePidRegistryLoaded) return;
    this.runtimePidRegistryLoaded = true;
    const filePath = getRuntimePidRegistryPath();
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedRuntimePidRegistry;
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const entry of entries) {
        const pid = Number(entry?.pid);
        const recordedAtMs = Number(entry?.recordedAtMs);
        if (Number.isInteger(pid) && pid > 0 && Number.isFinite(recordedAtMs) && recordedAtMs > 0) {
          this.runtimePidRegistry.set(pid, recordedAtMs);
        }
      }
    } catch {
      // Ignore malformed registry and start clean.
      this.runtimePidRegistry.clear();
    }
  }

  private persistRuntimePidRegistry(): void {
    const filePath = getRuntimePidRegistryPath();
    if (!filePath) return;
    try {
      const payload: PersistedRuntimePidRegistry = {
        version: 1,
        entries: Array.from(this.runtimePidRegistry.entries()).map(([pid, recordedAtMs]) => ({ pid, recordedAtMs })),
      };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Best-effort persistence only.
    }
  }

  private async runOneShotCommand(
    session: BuildSession,
    command: string,
    envOverrides?: Record<string, string>,
    mode: 'build' | 'run' = 'run',
    portOverride?: number
  ): Promise<BuildRuntimeCommandResult> {
    const startedAt = new Date();

    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: session.workspaceRoot,
        env: buildRuntimeEnv({
          mode: mode === 'build' ? 'run' : 'run',
          envOverrides,
          port: portOverride ?? session.runtime.port,
        }),
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (chunk: Buffer | string) => {
        this.handleProcessOutput(session, 'stdout', chunk.toString());
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        this.handleProcessOutput(session, 'stderr', chunk.toString());
      });

      child.on('error', (error) => reject(error));
      child.on('close', (exitCode, signal) => {
        const completedAt = new Date();
        const ok = exitCode === 0;
        const summary = ok
          ? `Command completed successfully.`
          : `Command failed with exit code ${exitCode ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;

        resolve({
          ok,
          exitCode,
          signal,
          command,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          summary,
        });
      });
    });
  }
}

export const buildDevProcessManager = new DevProcessManager();

function buildStructuredDiagnosticKey(entry: RuntimeStructuredDiagnostic): string {
  return [
    entry.type,
    entry.source,
    entry.severity,
    entry.code || '',
    entry.file || '',
    entry.line || '',
    entry.column || '',
    entry.message.trim().toLowerCase(),
  ].join('|');
}


async function findAvailablePort(preferredPort: number): Promise<number> {
  const startPort = Math.max(1024, Math.min(65535, preferredPort));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = startPort + attempt;
    const isFree = await canBindPort(candidate);
    if (isFree) return candidate;
  }

  const hosts = ['127.0.0.1', '0.0.0.0', '::'];
  for (const host of hosts) {
    const ephemeral = await tryAllocateEphemeralPort(host);
    if (ephemeral) return ephemeral;
  }
  throw new Error('Unable to allocate port.');
}

function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), 350);
    timeout.unref?.();
    server.unref();
    server.once('error', () => finish(false));
    server.listen(port, () => finish(true));
  });
}

function tryBindOnHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), 350);
    timeout.unref?.();
    server.unref();
    server.once('error', () => finish(false));
    server.listen(port, host, () => {
      finish(true);
    });
  });
}

function tryAllocateEphemeralPort(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(null));
    server.listen(0, host, () => {
      const address = server.address();
      if (typeof address === 'object' && typeof address?.port === 'number') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => resolve(null));
      }
    });
  });
}

function getRuntimePidRegistryPath(): string | null {
  try {
    const userDataPath = app.getPath('userData');
    if (!userDataPath) return null;
    return path.join(userDataPath, RUNTIME_PID_REGISTRY_FILE);
  } catch {
    return null;
  }
}

function normalizeAgentKey(agentId: string): string {
  const normalized = String(agentId || 'main')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'main';
}

async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const child = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        shell: false,
      });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        finish();
      }, 5000);
      timer.unref?.();
      child.on('error', () => finish());
      child.on('close', () => finish());
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // noop
    }
  }
}

function buildRuntimeEnv(params: {
  mode: 'dev' | 'run';
  envOverrides?: Record<string, string>;
  port?: number;
}): NodeJS.ProcessEnv {
  const overrides = params.envOverrides || {};
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...overrides,
    ...(params.port ? {
      PORT: String(params.port),
      VITE_PORT: String(params.port),
      NEXT_PORT: String(params.port),
    } : {}),
    BROWSER: 'none',
    FORCE_COLOR: '1',
  };

  // Keep framework behavior stable even when parent Electron env has custom NODE_ENV.
  if (!Object.prototype.hasOwnProperty.call(overrides, 'NODE_ENV')) {
    env.NODE_ENV = params.mode === 'dev' ? 'development' : 'production';
  }

  return env;
}

function shouldFallbackToDevCommandForRunOnce(session: BuildSession): boolean {
  if (session.detection.projectType !== 'nextjs') return false;
  const buildIdPath = path.join(session.workspaceRoot, '.next', 'BUILD_ID');
  return !fs.existsSync(buildIdPath);
}
