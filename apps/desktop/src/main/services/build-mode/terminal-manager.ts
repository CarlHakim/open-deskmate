import fs from 'fs';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import path from 'path';
import type * as pty from 'node-pty';
import type {
  BuildTerminalEntry,
  BuildTerminalOutputResponse,
  BuildTerminalSessionSummary,
  BuildTerminalSnapshot,
} from '@accomplish/shared';
import { resolveAgentWorkspaceRoot, resolvePathInWorkspace } from './file-service';

const MAX_TERMINAL_ENTRIES = 4_000;
const DEFAULT_TERMINAL_LOG_LIMIT = 500;

interface BuildTerminalSession {
  id: string;
  agentId: string;
  title: string;
  shellLabel: string;
  cwd: string;
  workspaceRelativePath: string;
  createdAt: string;
  updatedAt: string;
  running: boolean;
  nextSeq: number;
  entries: BuildTerminalEntry[];
  ptyProcess: pty.IPty | null;
  inputBuffer: string;
}

interface BuildTerminalAgentState {
  activeSessionId: string | null;
  sessions: Map<string, BuildTerminalSession>;
  createdCount: number;
}

class BuildTerminalManager {
  private readonly agents = new Map<string, BuildTerminalAgentState>();
  private ptyModule: typeof import('node-pty') | null = null;
  private readonly events = new EventEmitter();

  async getSnapshot(agentId: string): Promise<BuildTerminalSnapshot> {
    const state = this.getOrCreateAgentState(agentId);
    return this.toSnapshot(agentId, state);
  }

  async createSession(agentId: string, workspaceRelativePath = '.', splitFromSessionId?: string): Promise<BuildTerminalSnapshot> {
    const state = this.getOrCreateAgentState(agentId);
    const sourceSession = splitFromSessionId ? state.sessions.get(splitFromSessionId) || null : null;
    const targetWorkspaceRelativePath = sourceSession?.workspaceRelativePath || workspaceRelativePath || '.';
    const cwd = resolvePathInWorkspace(agentId, targetWorkspaceRelativePath);
    const shell = getTerminalShellConfig();
    const ptyModule = await this.getPtyModule();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const session: BuildTerminalSession = {
      id: sessionId,
      agentId,
      title: `Terminal ${state.createdCount + 1}`,
      shellLabel: shell.label,
      cwd,
      workspaceRelativePath: targetWorkspaceRelativePath,
      createdAt: now,
      updatedAt: now,
      running: true,
      nextSeq: 1,
      entries: [],
      ptyProcess: null,
      inputBuffer: '',
    };

    this.seedSessionExamples(session);

    const ptyProcess = ptyModule.spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    session.ptyProcess = ptyProcess;
    ptyProcess.onData((data: string) => {
      const cleaned = sanitizeTerminalText(data);
      if (!cleaned) return;
      this.appendEntry(session, 'output', cleaned);
    });
    ptyProcess.onExit(() => {
      session.running = false;
      session.updatedAt = new Date().toISOString();
      this.appendEntry(session, 'system', 'Terminal session exited.');
    });

    state.createdCount += 1;
    state.sessions.set(session.id, session);
    state.activeSessionId = session.id;
    return this.toSnapshot(agentId, state);
  }

  async setActiveSession(agentId: string, sessionId: string): Promise<BuildTerminalSnapshot> {
    const state = this.getOrCreateAgentState(agentId);
    if (state.sessions.has(sessionId)) {
      state.activeSessionId = sessionId;
    }
    return this.toSnapshot(agentId, state);
  }

  async getOutput(agentId: string, sessionId: string, cursor = 0, limit = DEFAULT_TERMINAL_LOG_LIMIT): Promise<BuildTerminalOutputResponse> {
    const state = this.getOrCreateAgentState(agentId);
    const session = state.sessions.get(sessionId);
    if (!session) {
      return { entries: [], nextCursor: cursor };
    }
    const normalizedCursor = Math.max(0, Math.floor(cursor));
    const normalizedLimit = Math.max(50, Math.min(2_000, Math.floor(limit)));
    const slice = session.entries.slice(normalizedCursor, normalizedCursor + normalizedLimit);
    return {
      entries: slice,
      nextCursor: normalizedCursor + slice.length,
    };
  }

  async runCommand(agentId: string, sessionId: string, command: string): Promise<{ ok: boolean }> {
    const session = this.getSession(agentId, sessionId);
    const trimmed = command.trim();
    if (!trimmed || !session.ptyProcess || !session.running) {
      return { ok: false };
    }
    this.maybeUpdateSessionCwdFromCommand(session, trimmed);
    session.updatedAt = new Date().toISOString();
    session.ptyProcess.write(`${command}\r`);
    return { ok: true };
  }

  async writeInput(agentId: string, sessionId: string, input: string): Promise<{ ok: boolean }> {
    const session = this.getSession(agentId, sessionId);
    if (!input || !session.ptyProcess || !session.running) {
      return { ok: false };
    }
    this.trackSessionInput(session, input);
    session.updatedAt = new Date().toISOString();
    session.ptyProcess.write(input);
    return { ok: true };
  }

  async interruptSession(agentId: string, sessionId: string): Promise<{ ok: boolean }> {
    const session = this.getSession(agentId, sessionId);
    if (!session.ptyProcess || !session.running) {
      return { ok: false };
    }
    session.updatedAt = new Date().toISOString();
    session.ptyProcess.write('\u0003');
    session.inputBuffer = '';
    return { ok: true };
  }

  async resizeSession(agentId: string, sessionId: string, cols: number, rows: number): Promise<{ ok: boolean }> {
    const session = this.getSession(agentId, sessionId);
    if (!session.ptyProcess || !session.running) {
      return { ok: false };
    }
    session.ptyProcess.resize(
      Math.max(20, Math.min(400, Math.floor(cols))),
      Math.max(5, Math.min(200, Math.floor(rows)))
    );
    session.updatedAt = new Date().toISOString();
    return { ok: true };
  }

  async clearSession(agentId: string, sessionId: string): Promise<{ ok: boolean }> {
    const session = this.getSession(agentId, sessionId);
    session.entries = [];
    session.nextSeq = 1;
    session.inputBuffer = '';
    session.updatedAt = new Date().toISOString();
    this.seedSessionExamples(session, true);
    return { ok: true };
  }

  async closeSession(agentId: string, sessionId: string): Promise<BuildTerminalSnapshot> {
    const state = this.getOrCreateAgentState(agentId);
    const session = state.sessions.get(sessionId);
    if (session?.ptyProcess) {
      try {
        session.ptyProcess.kill();
      } catch {
        // ignore
      }
    }
    state.sessions.delete(sessionId);
    if (state.activeSessionId === sessionId) {
      state.activeSessionId = state.sessions.values().next().value?.id || null;
    }
    return this.toSnapshot(agentId, state);
  }

  disposeAll(): void {
    for (const state of this.agents.values()) {
      for (const session of state.sessions.values()) {
        if (!session.ptyProcess) continue;
        try {
          session.ptyProcess.kill();
        } catch {
          // ignore
        }
      }
      state.sessions.clear();
      state.activeSessionId = null;
    }
  }

  onEntry(listener: (payload: { agentId: string; sessionId: string; entry: BuildTerminalEntry }) => void): () => void {
    this.events.on('entry', listener);
    return () => {
      this.events.off('entry', listener);
    };
  }

  private getOrCreateAgentState(agentId: string): BuildTerminalAgentState {
    let state = this.agents.get(agentId);
    if (!state) {
      state = {
        activeSessionId: null,
        sessions: new Map<string, BuildTerminalSession>(),
        createdCount: 0,
      };
      this.agents.set(agentId, state);
    }
    return state;
  }

  private getSession(agentId: string, sessionId: string): BuildTerminalSession {
    const state = this.getOrCreateAgentState(agentId);
    const session = state.sessions.get(sessionId);
    if (!session) {
      throw new Error('Terminal session not found.');
    }
    return session;
  }

  private appendEntry(session: BuildTerminalSession, kind: BuildTerminalEntry['kind'], text: string): void {
    const entry: BuildTerminalEntry = {
      seq: session.nextSeq++,
      at: new Date().toISOString(),
      kind,
      text,
    };
    session.entries.push(entry);
    if (session.entries.length > MAX_TERMINAL_ENTRIES) {
      session.entries.splice(0, session.entries.length - MAX_TERMINAL_ENTRIES);
    }
    session.updatedAt = entry.at;
    this.events.emit('entry', { agentId: session.agentId, sessionId: session.id, entry });
  }

  private updateSessionCwd(session: BuildTerminalSession, nextCwd: string): void {
    const normalizedCwd = path.normalize(nextCwd);
    session.cwd = normalizedCwd;

    const workspaceRoot = resolveAgentWorkspaceRoot(session.agentId);
    const relative = path.relative(workspaceRoot, normalizedCwd);
    if (relative && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      session.workspaceRelativePath = normalizeRelativePath(relative);
      return;
    }
    if (path.resolve(normalizedCwd) === path.resolve(workspaceRoot)) {
      session.workspaceRelativePath = '.';
    }
  }

  private maybeUpdateSessionCwdFromCommand(session: BuildTerminalSession, command: string): void {
    const parsedTarget = extractDirectoryChangeTarget(command, session.shellLabel);
    if (!parsedTarget) return;

    const workspaceRoot = resolveAgentWorkspaceRoot(session.agentId);
    const nextCwd = resolveTerminalTargetPath(session.cwd, parsedTarget);
    if (!nextCwd) return;

    const normalizedRoot = path.resolve(workspaceRoot);
    const normalizedNext = path.resolve(nextCwd);
    if (
      normalizedNext !== normalizedRoot
      && !normalizedNext.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      return;
    }
    if (!fs.existsSync(normalizedNext)) return;
    try {
      if (!fs.statSync(normalizedNext).isDirectory()) return;
    } catch {
      return;
    }

    this.updateSessionCwd(session, normalizedNext);
  }

  private trackSessionInput(session: BuildTerminalSession, input: string): void {
    if (input.includes('\u001b')) {
      return;
    }

    for (const char of input) {
      if (char === '\r' || char === '\n') {
        const command = session.inputBuffer.trim();
        if (command) {
          this.maybeUpdateSessionCwdFromCommand(session, command);
        }
        session.inputBuffer = '';
        continue;
      }

      if (char === '\u0003') {
        session.inputBuffer = '';
        continue;
      }

      if (char === '\u0008' || char === '\u007f') {
        session.inputBuffer = session.inputBuffer.slice(0, -1);
        continue;
      }

      if (char === '\u0015') {
        session.inputBuffer = '';
        continue;
      }

      if (char < ' ' && char !== '\t') {
        continue;
      }

      session.inputBuffer += char;
    }
  }

  private seedSessionExamples(session: BuildTerminalSession, _cleared = false): void {
    // Clean start — no boilerplate, just like VSCode's integrated terminal.
  }

  private toSnapshot(agentId: string, state: BuildTerminalAgentState): BuildTerminalSnapshot {
    const sessions = [...state.sessions.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((session): BuildTerminalSessionSummary => ({
        id: session.id,
        title: session.title,
        shellLabel: session.shellLabel,
        cwd: session.cwd,
        workspaceRelativePath: session.workspaceRelativePath,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        running: session.running,
        pid: session.ptyProcess?.pid ?? null,
      }));

    return {
      agentId,
      activeSessionId: state.activeSessionId,
      sessions,
    };
  }

  private async getPtyModule(): Promise<typeof import('node-pty')> {
    if (this.ptyModule) {
      return this.ptyModule;
    }
    this.ptyModule = await import('node-pty');
    return this.ptyModule;
  }
}

function sanitizeTerminalText(input: string): string {
  return input.replace(/\u0000/g, '');
}

function getTerminalShellConfig(): { command: string; args: string[]; label: string } {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo'],
      label: 'PowerShell',
    };
  }

  const shellPath = process.env.SHELL || '/bin/bash';
  return {
    command: shellPath,
    args: ['-l'],
    label: path.basename(shellPath),
  };
}

export const buildTerminalManager = new BuildTerminalManager();

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim();
  return normalized || '.';
}

function extractDirectoryChangeTarget(command: string, shellLabel: string): string | null {
  if (/[|&;]/.test(command)) {
    return null;
  }

  const trimmed = command.trim();
  if (!trimmed) return null;

  const pattern = shellLabel.toLowerCase().includes('power')
    ? /^(?:cd|chdir|sl|set-location)\s+(.+)$/i
    : /^(?:cd)\s+(.+)$/i;
  const match = trimmed.match(pattern);
  if (!match) return null;

  const rawTarget = String(match[1] || '').trim();
  if (!rawTarget) return null;
  if ((rawTarget.startsWith('"') && rawTarget.endsWith('"')) || (rawTarget.startsWith('\'') && rawTarget.endsWith('\''))) {
    return rawTarget.slice(1, -1).trim();
  }
  return rawTarget;
}

function resolveTerminalTargetPath(currentCwd: string, target: string): string | null {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) return null;
  if (normalizedTarget === '.') return currentCwd;
  if (path.isAbsolute(normalizedTarget)) {
    return path.normalize(normalizedTarget);
  }
  return path.resolve(currentCwd, normalizedTarget);
}
