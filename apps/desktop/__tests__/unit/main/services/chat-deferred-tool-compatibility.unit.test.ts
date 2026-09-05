import { describe, expect, it } from 'vitest';
import type { ToolsetId } from '@accomplish/shared';
import {
  listChatDeferredCompatibilityRegressionPack,
  proveChatDeferredToolCompatibility,
} from '@main/services/chat-deferred-tool-compatibility';

describe('chat deferred tool compatibility proof', () => {
  it('passes the default v1 regression pack with full tools deferred behind chat_safe', () => {
    const result = proveChatDeferredToolCompatibility();

    expect(result.passed).toBe(true);
    expect(result.packVersion).toBe('chat-deferred-tool-compatibility-v1');
    expect(result.summary.totalCases).toBe(9);
    expect(result.summary.failedCases).toBe(0);
    expect(result.summary.minimalToolsetIds).toEqual(['chat_safe']);
    expect(result.summary.deferredToolsetIds).toEqual(['desktop_full', 'custom']);
    expect(result.summary.requiredCapabilities).toEqual(expect.arrayContaining([
      'attachment_context',
      'browser_automation',
      'image_url_context',
      'memory_context',
      'saved_prompt_context',
      'usage_project_metadata',
      'user_skill_context',
      'web_research',
    ]));

    const plainChat = result.cases.find((entry) => entry.id === 'plain_chat');
    expect(plainChat?.deferredAvailability.phase).toBe('initial');

    const webLookup = result.cases.find((entry) => entry.id === 'web_lookup');
    expect(webLookup?.deferredAvailability.phase).toBe('deferred');
    expect(webLookup?.baselineAvailability.availableTools).toEqual(expect.arrayContaining(['websearch', 'webfetch']));

    const memory = result.cases.find((entry) => entry.id === 'memory');
    expect(memory?.baselineAvailability.availableCapabilities).toContain('memory_context');
    expect(memory?.baselineAvailability.availableTools).toContain('memory-tools_*');
  });

  it('fails deterministic cases when the proposed deferred toolsets are too small', () => {
    const result = proveChatDeferredToolCompatibility({
      minimalToolsetIds: ['chat_safe'],
      deferredToolsetIds: [],
    });

    expect(result.passed).toBe(false);
    expect(result.summary.failedCases).toBeGreaterThan(0);
    expect(result.cases.find((entry) => entry.id === 'plain_chat')?.passed).toBe(true);

    const webLookup = result.cases.find((entry) => entry.id === 'web_lookup');
    expect(webLookup?.passed).toBe(false);
    expect(webLookup?.deferredAvailability.phase).toBe('unavailable');
    expect(webLookup?.deferredAvailability.missingCapabilities).toContain('web_research');
    expect(webLookup?.deferredAvailability.missingTools).toEqual(expect.arrayContaining(['websearch', 'webfetch']));

    const browser = result.cases.find((entry) => entry.id === 'browser_dev_browser');
    expect(browser?.passed).toBe(false);
    expect(browser?.deferredAvailability.missingTools).toContain('dev-browser_*');
    expect(result.recommendations[0]).toContain('Do not enable on-demand Chat tools');
  });

  it('reports token estimates and unknown requested toolsets without running tasks', () => {
    const result = proveChatDeferredToolCompatibility({
      minimalToolsetIds: ['missing' as ToolsetId],
      deferredToolsetIds: ['desktop_full'],
    });

    expect(result.unknownToolsetIds.minimal).toEqual(['missing']);
    expect(result.summary.tokenEstimate.method).toBe('heuristic_chars_per_token');
    expect(result.summary.tokenEstimate.baselinePromptTokensEst).toBeGreaterThan(0);
    expect(result.summary.tokenEstimate.deferredInitialPromptTokensEst).toBeGreaterThan(0);
    expect(result.summary.tokenEstimate.estimatedInitialSavingsTokens).toBeGreaterThan(0);

    const pack = listChatDeferredCompatibilityRegressionPack();
    pack[0].requiredCapabilities.push('mutated');
    expect(listChatDeferredCompatibilityRegressionPack()[0].requiredCapabilities).not.toContain('mutated');
  });
});
