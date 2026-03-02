import type { TaskConfig } from '@accomplish/shared';
import { getAgentSpeedMode } from '../store/appSettings';

export type RuntimeSpeedMode = 'fast' | 'balanced' | 'deep';
export type TaskComplexity = 'simple' | 'standard' | 'complex';

const BROWSER_KEYWORDS = /\b(browser|website|web\s?site|webpage|url|navigate|open\s+site|search|google|bing|news|scrape|crawl|click|form|login|screenshot|dev-browser|playwright)\b/i;
const CODING_COMPLEXITY_KEYWORDS = /\b(code|coding|build|implement|architecture|refactor|debug|fix|bug|typescript|javascript|python|react|node|api|database|schema|migration|test|unit test|integration test)\b/i;

export function detectTaskNeedsBrowser(config: Pick<TaskConfig, 'prompt' | 'systemPromptAppend' | 'requiresBrowser'>): boolean {
  if (typeof config.requiresBrowser === 'boolean') {
    return config.requiresBrowser;
  }
  const override = process.env.OPENDESKMATE_PREWARM_BROWSER;
  if (override === '1') return true;
  if (override === '0') return false;

  // Only inspect the user prompt. systemPromptAppend contains static agent
  // docs (including browser keywords) and would otherwise force browser=true
  // for every task.
  const text = `${config.prompt ?? ''}`.trim();
  if (!text) return false;
  return BROWSER_KEYWORDS.test(text);
}

export function detectTaskComplexity(prompt: string): TaskComplexity {
  const text = (prompt || '').trim();
  if (!text) return 'simple';

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasCodeSignals = CODING_COMPLEXITY_KEYWORDS.test(text);
  const hasMultipleSteps = /\b(then|after that|next|finally|step\s+\d+)\b/i.test(text);

  if ((hasCodeSignals && wordCount >= 24) || wordCount >= 60 || hasMultipleSteps) {
    return 'complex';
  }

  if (hasCodeSignals || wordCount >= 14) {
    return 'standard';
  }

  return 'simple';
}

export function getRuntimeSpeedMode(config?: Pick<TaskConfig, 'speedMode'>): RuntimeSpeedMode {
  if (config?.speedMode) return config.speedMode;
  const configured = getAgentSpeedMode();
  if (configured === 'fast' || configured === 'balanced' || configured === 'deep') {
    return configured;
  }
  const envValue = String(process.env.OPENDESKMATE_SPEED_MODE || '').trim().toLowerCase();
  if (envValue === 'fast' || envValue === 'balanced' || envValue === 'deep') {
    return envValue;
  }
  return 'fast';
}
