import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app, BrowserWindow } from 'electron';
import type {
  BuildQualityCheckKind,
  BuildQualityCheckResult,
  BuildQualityCheckRun,
  BuildQualityCheckRunRequest,
} from '@accomplish/shared';
import { buildDevProcessManager } from './dev-process-manager';
import { resolvePathInWorkspace } from './file-service';
import { listBuildModePresets } from '../../store/buildModePresets';
import { getBundledNodePaths } from '../../utils/bundled-node';

const DEFAULT_CHECK_ORDER: BuildQualityCheckKind[] = ['typecheck', 'lint', 'test', 'build', 'runtime-health', 'preview'];
const OUTPUT_LIMIT = 16_000;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

const latestRuns = new Map<string, BuildQualityCheckRun>();

function runKey(agentId: string, workspaceRelativePath: string): string {
  return `${agentId}:${workspaceRelativePath || '.'}`;
}

function createRunId(): string {
  return `checks_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function trimOutput(output: string): string {
  if (output.length <= OUTPUT_LIMIT) return output;
  return `${output.slice(output.length - OUTPUT_LIMIT)}\n[output truncated]`;
}

function labelFor(kind: BuildQualityCheckKind): string {
  switch (kind) {
    case 'typecheck':
      return 'Typecheck';
    case 'lint':
      return 'Lint';
    case 'test':
      return 'Tests';
    case 'build':
      return 'Build';
    case 'runtime-health':
      return 'Runtime health';
    case 'preview':
      return 'Preview';
    default:
      return kind;
  }
}

function buildCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: process.env.CI || '1' };
  const bundledPaths = getBundledNodePaths();
  if (bundledPaths) {
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    const delimiter = process.platform === 'win32' ? ';' : ':';
    env[pathKey] = `${bundledPaths.binDir}${delimiter}${env[pathKey] || ''}`;
  }
  return env;
}

async function runCommandCheck(kind: BuildQualityCheckKind, command: string | null | undefined, cwd: string): Promise<BuildQualityCheckResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  if (!command?.trim()) {
    return {
      kind,
      label: labelFor(kind),
      status: 'skipped',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      summary: 'No command configured.',
    };
  }

  return await new Promise<BuildQualityCheckResult>((resolve) => {
    let output = '';
    let settled = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: buildCommandEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (status: 'success' | 'failed', exitCode: number | null, summary: string) => {
      if (settled) return;
      settled = true;
      resolve({
        kind,
        label: labelFor(kind),
        command,
        status,
        exitCode,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        summary,
        output: trimOutput(output.trim()),
      });
    };

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish('failed', null, `Timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)}s.`);
    }, COMMAND_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      output = trimOutput(output + chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      output = trimOutput(output + chunk.toString());
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      output = trimOutput(`${output}\n${error.message}`);
      finish('failed', null, error.message);
    });
    child.on('exit', (exitCode) => {
      clearTimeout(timeout);
      finish(exitCode === 0 ? 'success' : 'failed', exitCode, exitCode === 0 ? 'Passed.' : `Exited with code ${exitCode ?? 'unknown'}.`);
    });
  });
}

async function capturePreviewScreenshot(previewUrl: string, runId: string): Promise<string | null> {
  let window: BrowserWindow | null = null;
  try {
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    await Promise.race([
      window.loadURL(previewUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Preview screenshot timed out.')), 12_000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const image = await window.webContents.capturePage();
    const dir = path.join(app.getPath('userData'), 'build-review-screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const screenshotPath = path.join(dir, `${runId}.png`);
    fs.writeFileSync(screenshotPath, image.toPNG());
    return screenshotPath;
  } catch {
    return null;
  } finally {
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

async function runPreviewCheck(previewUrl: string | undefined, runId: string): Promise<BuildQualityCheckResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  if (!previewUrl) {
    return {
      kind: 'preview',
      label: labelFor('preview'),
      status: 'skipped',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      summary: 'No preview URL available.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(previewUrl, { signal: controller.signal });
    const artifactPath = response.ok ? await capturePreviewScreenshot(previewUrl, runId) : null;
    return {
      kind: 'preview',
      label: labelFor('preview'),
      status: response.ok ? 'success' : 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      summary: response.ok && artifactPath
        ? `Preview responded with HTTP ${response.status}; screenshot captured.`
        : response.ok
          ? `Preview responded with HTTP ${response.status}; screenshot was unavailable.`
        : `Preview returned HTTP ${response.status}.`,
      output: previewUrl,
      artifactPath: artifactPath || undefined,
      artifactLabel: artifactPath ? 'Preview screenshot' : undefined,
    };
  } catch (error) {
    return {
      kind: 'preview',
      label: labelFor('preview'),
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      summary: error instanceof Error ? error.message : String(error),
      output: previewUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runBuildQualityChecks(request: BuildQualityCheckRunRequest): Promise<BuildQualityCheckRun> {
  const agentId = String(request.agentId || '').trim();
  if (!agentId) throw new Error('agentId is required');
  const workspaceRelativePath = String(request.workspaceRelativePath || '.').trim() || '.';
  const workspaceRoot = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const snapshot = await buildDevProcessManager.getSnapshot(agentId, workspaceRelativePath);
  const activePresetList = listBuildModePresets(agentId);
  const activePreset = activePresetList.activePresetId
    ? activePresetList.presets.find((preset) => preset.id === activePresetList.activePresetId)
    : undefined;
  const commands = {
    typecheck: request.commandOverrides?.typecheck
      || activePreset?.commands.typecheckCommand
      || snapshot.detection.commands.typecheckCommand,
    lint: request.commandOverrides?.lint
      || activePreset?.commands.lintCommand
      || snapshot.detection.commands.lintCommand,
    test: request.commandOverrides?.test
      || activePreset?.commands.testCommand
      || snapshot.detection.commands.testCommand,
    build: request.commandOverrides?.build
      || activePreset?.commands.buildCommand
      || snapshot.detection.commands.buildCommand,
  };
  const kinds = (request.kinds?.length ? request.kinds : DEFAULT_CHECK_ORDER)
    .filter((kind, index, array) => array.indexOf(kind) === index);

  const run: BuildQualityCheckRun = {
    id: createRunId(),
    agentId,
    workspaceRoot,
    workspaceRelativePath,
    status: 'running',
    checks: [],
    startedAt: new Date().toISOString(),
    diffSignature: request.diffSignature,
    changedFileCount: request.changedFileCount,
    trigger: request.trigger,
  };
  latestRuns.set(runKey(agentId, workspaceRelativePath), run);

  for (const kind of kinds) {
    if (kind === 'runtime-health') {
      const status = snapshot.runtime.status === 'running' && snapshot.runtime.healthy !== false ? 'success' : 'skipped';
      run.checks.push({
        kind,
        label: labelFor(kind),
        status,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        summary: snapshot.runtime.status === 'running'
          ? (snapshot.runtime.healthMessage || (snapshot.runtime.healthy === false ? 'Runtime is unhealthy.' : 'Runtime is running.'))
          : 'Runtime is not running.',
      });
      continue;
    }
    if (kind === 'preview') {
      run.checks.push(await runPreviewCheck(snapshot.runtime.previewUrl, run.id));
      continue;
    }
    run.checks.push(await runCommandCheck(kind, commands[kind], workspaceRoot));
    latestRuns.set(runKey(agentId, workspaceRelativePath), { ...run, checks: [...run.checks] });
  }

  const executed = run.checks.filter((check) => check.status !== 'skipped');
  run.status = executed.length === 0
    ? 'skipped'
    : executed.some((check) => check.status === 'failed')
      ? 'failed'
      : 'success';
  run.completedAt = new Date().toISOString();
  latestRuns.set(runKey(agentId, workspaceRelativePath), run);
  return run;
}

export function getLatestBuildQualityCheckRun(agentId: string, workspaceRelativePath = '.'): BuildQualityCheckRun | null {
  return latestRuns.get(runKey(agentId, workspaceRelativePath || '.')) || null;
}
