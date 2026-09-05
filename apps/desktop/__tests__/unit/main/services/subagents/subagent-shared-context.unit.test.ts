import { describe, expect, it } from 'vitest';
import {
  extractSubagentFailureSignals,
  formatInheritedToolContextForPrompt,
  formatSubagentSharedContextForPrompt,
} from '@main/services/subagents/subagent-shared-context';

describe('subagent shared context helpers', () => {
  it('extracts blocked-source signals from failed research text', () => {
    const signals = extractSubagentFailureSignals({
      text: 'G2 pricing page returned 403 behind Cloudflare after a webfetch retry loop.',
      toolName: 'webfetch',
    });

    expect(signals).toMatchObject({
      domain: 'g2.com',
      httpStatus: 403,
      failureKind: 'cloudflare',
    });
    expect(signals.fallbackSuggested).toContain('Avoid retrying');
  });

  it('extracts tool-unavailable loops for later child warnings', () => {
    const signals = extractSubagentFailureSignals({
      text: 'The file permission tool is not wired into this turn and appears unavailable.',
      toolName: 'file-permission',
    });

    expect(signals).toMatchObject({
      failureKind: 'tool_unavailable',
    });
    expect(signals.fallbackSuggested).toContain('Enable the smallest matching toolset');
  });

  it('formats inherited tools and shared blocked sources for child prompts', () => {
    const inherited = formatInheritedToolContextForPrompt({
      toolsetIds: ['chat_safe', 'research'],
      enabledToolsetIds: ['chat_safe', 'research'],
      availableToolsetIds: ['chat_safe', 'research', 'coding'],
      deferredToolDiscoveryEnabled: true,
    });
    const shared = formatSubagentSharedContextForPrompt({
      parentTaskId: 'task_1',
      generatedAt: '2026-06-26T10:00:00.000Z',
      blockedSources: [{
        domain: 'capterra.com',
        httpStatus: 403,
        failureKind: 'login_wall',
        count: 2,
        firstSeenAt: '2026-06-26T09:59:00.000Z',
        lastSeenAt: '2026-06-26T10:00:00.000Z',
        example: 'Capterra blocked access behind login wall.',
      }],
      blockedTools: ['file-permission'],
      successfulFallbacks: ['Used dev-browser to inspect the vendor pricing page.'],
      confirmedFindings: ['Vendor page confirmed the starter plan price.'],
      openGaps: ['Could not verify G2 reviews.'],
    });

    expect(inherited).toContain('Deferred tool discovery: on');
    expect(inherited).toContain('chat_safe, research');
    expect(shared).toContain('capterra.com HTTP 403 login_wall');
    expect(shared).toContain('Used dev-browser');
    expect(shared).toContain('file-permission');
  });
});
