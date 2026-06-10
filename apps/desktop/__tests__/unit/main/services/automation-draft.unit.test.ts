import { describe, expect, it } from 'vitest';
import {
  automationDraftInternalsForTest,
  draftAutomationFromText,
} from '../../../../src/main/services/automation-draft';

describe('draftAutomationFromText', () => {
  it('drafts daily schedules with explicit time', async () => {
    const draft = await draftAutomationFromText({
      text: 'Every day at 8:30am check project status',
      agentId: 'agent-main',
      timezone: 'Europe/Amsterdam',
    });

    expect(draft.schedule.cron).toBe('30 8 * * *');
    expect(draft.schedule.agentId).toBe('agent-main');
    expect(draft.schedule.timezone).toBe('Europe/Amsterdam');
    expect(draft.confidence).toBeGreaterThanOrEqual(0.8);
    expect(draft.source).toBe('local');
  });

  it('drafts weekly schedules on named days', async () => {
    const draft = await draftAutomationFromText({
      text: 'Weekly on Friday at 4pm summarize blockers',
    });

    expect(draft.schedule.cron).toBe('0 16 * * 5');
    expect(draft.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('drafts interval schedules', async () => {
    const draft = await draftAutomationFromText({
      text: 'Every 2 hours check the deployment',
    });

    expect(draft.schedule.cron).toBe('0 */2 * * *');
    expect(draft.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('falls back safely when cadence and time are unclear', async () => {
    const draft = await draftAutomationFromText({
      text: 'Check whether anything changed',
    });

    expect(draft.schedule.cron).toBe('0 9 * * *');
    expect(draft.warnings.length).toBeGreaterThanOrEqual(2);
    expect(draft.source).toBe('fallback');
  });

  it('validates AI cron output before accepting it', () => {
    const local = automationDraftInternalsForTest.createLocalDraft({
      text: 'first monday of every month check billing',
    });
    const valid = automationDraftInternalsForTest.validateAiDraft({
      name: 'Check billing',
      prompt: 'check billing',
      cron: '0 9 1-7 * 1',
      timezone: 'Europe/Amsterdam',
    }, { text: 'first monday of every month check billing', timezone: 'Europe/Amsterdam' }, local);
    const invalid = automationDraftInternalsForTest.validateAiDraft({
      name: 'Bad cron',
      prompt: 'check billing',
      cron: 'soon',
    }, { text: 'first monday of every month check billing' }, local);

    expect(valid?.schedule.cron).toBe('0 9 1-7 * 1');
    expect(invalid).toBeNull();
  });
});
