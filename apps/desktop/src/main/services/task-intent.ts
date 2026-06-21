import type { TaskConfig } from '@accomplish/shared';
import { getAgentSpeedMode } from '../store/appSettings';

export type RuntimeSpeedMode = 'fast' | 'balanced' | 'deep';
export type TaskComplexity = 'simple' | 'standard' | 'complex';

const BROWSER_KEYWORDS = /\b(browser|website|web\s?site|webpage|url|navigate|open\s+site|search|google|bing|news|scrape|crawl|click|form|login|screenshot|dev-browser|playwright|internet|online|wikimedia|wikipedia|commons)\b/i;
const IMAGE_SEARCH_KEYWORDS = /\b(?:find|search|show|get|look\s+up|lookup|source|collect|gather)\b[\s\S]{0,120}\b(?:images?|pictures?|photos?|gallery|galleries)\b|\b(?:images?|pictures?|photos?|gallery|galleries)\s+(?:of|for|from|about)\b/i;
const BROWSER_SKILL_HINT = /\b(?:dev-browser|browser automation|navigate (?:a|the)?\s*(?:web)?\s*page|open (?:a|the)?\s*(?:web)?\s*page|getAISnapshot|playwright|wikimedia|wikipedia|web lookup|web search)\b/i;
const CODING_COMPLEXITY_KEYWORDS = /\b(code|coding|build|implement|architecture|refactor|debug|fix|bug|typescript|javascript|python|react|node|api|database|schema|migration|test|unit test|integration test)\b/i;

export function detectTaskNeedsBrowser(config: Pick<TaskConfig, 'prompt' | 'systemPromptAppend' | 'requiresBrowser'>): boolean {
  if (typeof config.requiresBrowser === 'boolean') {
    return config.requiresBrowser;
  }
  const override = process.env.OPENDESKMATE_PREWARM_BROWSER;
  if (override === '1') return true;
  if (override === '0') return false;

  // Always inspect the user prompt. The system prompt is inspected only for
  // explicit selected-skill hints, not generic browser words, so the built-in
  // browser manual does not force every task to start dev-browser.
  const text = `${config.prompt ?? ''}`.trim();
  const append = `${config.systemPromptAppend ?? ''}`.trim();
  if (!text && !append) return false;
  return BROWSER_KEYWORDS.test(text) || IMAGE_SEARCH_KEYWORDS.test(text) || BROWSER_SKILL_HINT.test(append);
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
