import { describe, expect, it } from 'vitest';
import { MAX_TEXT_LENGTH, sanitizeString } from '../../../../src/main/ipc/sanitizers';
import { buildRuntimeRepairPrompt } from '../../../../src/main/services/build-mode/repair-prompt';
import type { RuntimeStructuredDiagnostic } from '../../../../src/main/services/build-mode/runtime-adapters';

function context() {
  return {
    workspaceRoot: 'C:\\projects\\calculator',
    detection: { projectType: 'nextjs', runtimeAdapterId: 'nextjs-runtime' },
    runtime: { activeCommand: 'npm run dev' },
    logs: [] as Array<{ stream: 'stderr'; line: string }>,
    structuredDiagnostics: [] as RuntimeStructuredDiagnostic[],
  };
}

function diagnostic(message: string): RuntimeStructuredDiagnostic {
  return { type: 'typescript_error', source: 'tsc', severity: 'error', file: 'app/page.tsx',
    line: 42, column: 7, code: 'TS2322', message, raw: message, at: '2026-09-06T17:00:00Z' };
}

function readDiagnostics(prompt: string) {
  return JSON.parse(prompt.split('Structured diagnostics (JSON, newest errors first):\n')[1]
    .split('\n\nRecent runtime logs (oldest to newest):\n')[0]);
}

function expectAccepted(prompt: string) {
  expect(prompt.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
  expect(sanitizeString(prompt, 'prompt')).toBe(prompt);
  expect(prompt).toContain('Re-run relevant checks');
}

describe('automatic Build repair prompts', () => {
  it('keeps short diagnostics, file locations, and logs intact', () => {
    const input = context();
    input.structuredDiagnostics.push(diagnostic('Type mismatch'));
    input.logs.push({ stream: 'stderr', line: 'Build failed: Type mismatch' });
    const prompt = buildRuntimeRepairPrompt(input);
    expectAccepted(prompt);
    expect(readDiagnostics(prompt)).toEqual([{
      type: 'typescript_error', source: 'tsc', severity: 'error', file: 'app/page.tsx',
      line: 42, column: 7, code: 'TS2322', message: 'Type mismatch',
    }]);
    expect(prompt).toContain('[stderr] Build failed: Type mismatch');
  });

  it('fits large error logs and retains the newest failure', () => {
    const input = context();
    input.logs = Array.from({ length: 120 }, (_, i) => ({ stream: 'stderr', line: `${i}: ${'x'.repeat(1000)}` }));
    input.logs.push({ stream: 'stderr', line: 'LATEST FAILURE: missing module' });
    const prompt = buildRuntimeRepairPrompt(input);
    expectAccepted(prompt);
    expect(prompt).toContain('[Older log text omitted]');
    expect(prompt.endsWith('[stderr] LATEST FAILURE: missing module')).toBe(true);
  });

  it('keeps valid JSON and newest errors when diagnostics and metadata are oversized', () => {
    const input = context();
    input.workspaceRoot = 'w'.repeat(20000);
    input.runtime.activeCommand = 'c'.repeat(20000);
    input.detection.projectType = 'p'.repeat(20000);
    input.detection.runtimeAdapterId = 'a'.repeat(20000);
    input.structuredDiagnostics = Array.from({ length: 30 }, (_, i) => ({
      ...diagnostic(`Error ${i}: ${'\u0000"\\\n'.repeat(5000)}`),
      file: 'f'.repeat(20000), code: 'c'.repeat(20000),
    }));
    input.logs.push({ stream: 'stderr', line: 'x'.repeat(20000) + 'LATEST' });
    const prompt = buildRuntimeRepairPrompt(input);
    expectAccepted(prompt);
    const entries = readDiagnostics(prompt);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].message).toContain('Error 29:');
    expect(entries[0].line).toBe(42);
    expect(entries[0].message).toContain('[truncated]');
    expect(prompt.endsWith('LATEST')).toBe(true);
  });

  it('prioritizes errors over newer warnings without mutating source diagnostics', () => {
    const input = context();
    input.structuredDiagnostics = [diagnostic('Important failure'),
      ...Array.from({ length: 29 }, () => ({ ...diagnostic('Warning '.repeat(300)), severity: 'warning' as const }))];
    const before = JSON.stringify(input);
    const prompt = buildRuntimeRepairPrompt(input);
    expectAccepted(prompt);
    expect(readDiagnostics(prompt)[0].message).toBe('Important failure');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('handles runtime failures before any diagnostics or logs arrive', () => {
    const prompt = buildRuntimeRepairPrompt(context());
    expectAccepted(prompt);
    expect(readDiagnostics(prompt)).toEqual([]);
    expect(prompt).toContain('(no logs captured)');
  });
});
