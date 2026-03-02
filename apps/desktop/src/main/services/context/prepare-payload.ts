import { resolveSelectedModelForAgent } from '../agent-context';
import { getApiKey } from '../../store/secureStorage';
import type { ContextTokenEstimate, ContextWindowPrepareResult, ProviderType, SelectedModel } from '@accomplish/shared';
import { buildMemoryPrompt } from '../memory';
import { buildOpenCodeSystemPrompt, getSkillsPath } from '../../opencode/config-generator';
import { getCustomMcpRegistryPath } from '../../opencode/custom-mcp-registry';
import { estimateTokens } from './token-estimator';
import { computeContextStats } from './context-math';
import { readSessionLines, formatSessionLines } from './session-history';
import { getModelEntry } from './model-registry';
import { buildUserSkillsPromptBundle, ensureUserSkillsWatcher } from '../user-skills';
import { computeCompactionThresholds } from './compaction-thresholds';
import { detectTaskNeedsBrowser } from '../task-intent';

export type PrepareResult = ContextWindowPrepareResult;

function buildSummaryFromDropped(dropped: Array<{ role: string; content: string }>, maxChars: number): string {
  const userLines = dropped.filter((d) => d.role === 'user').map((d) => d.content);
  const assistantLines = dropped.filter((d) => d.role === 'assistant').map((d) => d.content);

  const oneLine = (s: string) => (s || '').trim().split('\n')[0]?.trim() ?? '';
  const truncate = (s: string, max = 180) => (s.length > max ? `${s.slice(0, max - 1).trim()}…` : s);

  const goals = userLines
    .map(oneLine)
    .filter((s) => /(^please\b|\bi want\b|\bneed\b|\btrying to\b|\bgoal\b|\bmake\b|\bimplement\b)/i.test(s))
    .slice(0, 4)
    .map((s) => `- ${truncate(s)}`);

  const constraints = [...userLines, ...assistantLines]
    .map(oneLine)
    .filter((s) => /\b(must|should|don't|do not|never|only|avoid|required|constraint|limit)\b/i.test(s))
    .slice(0, 5)
    .map((s) => `- ${truncate(s)}`);

  const openItems = [...userLines, ...assistantLines]
    .map(oneLine)
    .filter((s) => /\b(todo|next step|next steps|follow[- ]?up|fix|bug|investigate|verify|test)\b/i.test(s))
    .slice(0, 5)
    .map((s) => `- ${truncate(s)}`);

  const pathRegex = /([A-Za-z]:\\[^\\s'"<>|]+|\/[\w\-.~]+(?:\/[\w\-.~]+)+)/g;
  const paths = new Set<string>();
  for (const s of [...userLines, ...assistantLines]) {
    for (const match of s.matchAll(pathRegex)) {
      const value = (match[0] ?? '').trim();
      if (value) paths.add(value);
      if (paths.size >= 8) break;
    }
    if (paths.size >= 8) break;
  }
  const keyPaths = [...paths].slice(0, 8).map((p) => `- ${p}`);

  const snippets = [
    ...userLines.map(oneLine).filter(Boolean).slice(0, 6).map((s) => `- User: ${truncate(s)}`),
    ...assistantLines.map(oneLine).filter(Boolean).slice(0, 4).map((s) => `- Assistant: ${truncate(s)}`),
  ].slice(0, 10);

  const sections: string[] = [];
  if (goals.length) sections.push('Goals:', ...goals);
  if (constraints.length) sections.push('Constraints / requirements:', ...constraints);
  if (openItems.length) sections.push('Open items:', ...openItems);
  if (keyPaths.length) sections.push('Key paths:', ...keyPaths);
  if (!sections.length && snippets.length) sections.push('Key snippets:', ...snippets);

  if (!sections.length) return '';
  const summary = ['Session compaction summary (auto):', ...sections].join('\n');
  if (maxChars <= 0) return '';
  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars - 1).trimEnd()}…`;
}

function providerFromSelectedModel(selectedModel: SelectedModel): ProviderType {
  return selectedModel.provider as ProviderType;
}

export async function preparePayloadForSend(params: {
  agentId?: string;
  taskId?: string;
  sessionFilePath?: string;
  userMessage: string;
  retrievedText?: string;
  baseSystemPromptAppend?: string;
  maxOutputTokensOverride?: number;
  headroomSafetyTokens?: number;
  requireApiKey?: boolean;
  // When 'unsafeOnly', we only compact when the payload is truly unsafe (safeRemainingForReply < 0).
  // This is useful for "memory flush" turns where we want to preserve full history if it still fits.
  compactionMode?: 'preemptive' | 'unsafeOnly';
}): Promise<PrepareResult> {
  const selectedModel = resolveSelectedModelForAgent(params.agentId);
  if (!selectedModel) {
    throw new Error('No model selected');
  }

  const modelEntry = getModelEntry(selectedModel);
  if (!modelEntry) {
    throw new Error('Unknown selected model');
  }

  const provider = providerFromSelectedModel(selectedModel);
  const maxOutputTokens = params.maxOutputTokensOverride ?? modelEntry.defaultMaxOutputTokens;

  const memoryPrompt = buildMemoryPrompt(params.agentId);
  ensureUserSkillsWatcher({ agentId: params.agentId });
  const skillsBundle = buildUserSkillsPromptBundle({
    agentId: params.agentId,
    userMessage: params.userMessage,
    maxSkills: 2,
  });
  const skillsPrompt = skillsBundle.prompt;
  const baseAppend = (params.baseSystemPromptAppend || '').trim();

  const historyLines = params.sessionFilePath ? readSessionLines(params.sessionFilePath) : [];
  let includedLines = [...historyLines];
  const dropped: Array<{ role: string; content: string; pinned?: boolean }> = [];
  let droppedMessages = 0;
  let summaryInserted = false;
  let summaryText = '';

  const toolsText = ''; // Tools are baked into the OpenCode agent prompt template.
  const retrievedText = params.retrievedText || '';

  const appendBlocksBeforeHistory = () => {
    const blocks: string[] = [];
    if (baseAppend) blocks.push(baseAppend);
    if (skillsPrompt) blocks.push(skillsPrompt);
    if (memoryPrompt) blocks.push(memoryPrompt);
    if (summaryText) blocks.push(summaryText);
    return blocks.filter(Boolean);
  };

  const buildHistoryBlock = () => {
    if (!includedLines.length) return '';
    return ['Recent conversation:', formatSessionLines(includedLines)].join('\n');
  };

  const buildSystemPromptAppend = () => {
    const blocks = appendBlocksBeforeHistory();
    const historyBlock = buildHistoryBlock();
    if (historyBlock) blocks.push(historyBlock);
    return blocks.join('\n\n');
  };

  const estimateFor = (systemPromptAppendNoHistory: string, historyBlock: string): ContextTokenEstimate => {
    const includeBrowserSkill = detectTaskNeedsBrowser({
      prompt: params.userMessage,
      systemPromptAppend: systemPromptAppendNoHistory,
    });
    const systemText = buildOpenCodeSystemPrompt({
      skillsPath: getSkillsPath(),
      customMcpRegistryPath: getCustomMcpRegistryPath(),
      systemPromptAppend: systemPromptAppendNoHistory,
      includeBrowserSkill,
    });

    const historyText = historyBlock
      ? (systemPromptAppendNoHistory.trim() ? `\n\n${historyBlock}` : historyBlock)
      : '';

    return estimateTokens({
      provider,
      systemText,
      toolsText,
      retrievedText,
      historyText,
      newMessageText: params.userMessage,
    });
  };

  const headroomSafetyTokens = params.headroomSafetyTokens ?? 1024;
  const thresholds =
    params.compactionMode === 'unsafeOnly'
      ? { triggerTokens: 0, targetTokens: 0 }
      : computeCompactionThresholds({ contextLimitTokens: modelEntry.contextLimitTokens });

  const dropOldest = (): void => {
    if (includedLines.length === 0) return;
    const idx = includedLines.findIndex((l) => !l.pinned);
    const removed = idx >= 0 ? includedLines.splice(idx, 1)[0] : includedLines.shift();
    if (!removed) return;
    dropped.push({ role: removed.role, content: removed.content, pinned: removed.pinned });
    droppedMessages += 1;
  };

  const recompute = () => {
    const beforeHistory = appendBlocksBeforeHistory().join('\n\n');
    const historyBlock = buildHistoryBlock();
    const systemPromptAppend = buildSystemPromptAppend();
    const estimate = estimateFor(beforeHistory, historyBlock);
    const context = computeContextStats({
      contextLimitTokens: modelEntry.contextLimitTokens,
      promptTokens: estimate.promptTokensEst,
      maxOutputTokens,
      headroomSafetyTokens,
    });
    return { systemPromptAppend, estimate, context, beforeHistory, historyBlock };
  };

  let { systemPromptAppend, estimate, context } = recompute();

  // Compact oldest messages until we have enough room for a safe reply.
  // Preemptive mode uses a cushion (trigger/target); unsafeOnly compacts only when < 0.
  // If we drop enough messages, we insert/update a summary at the start.
  const summaryAfterDropped = 6;
  while (includedLines.length > 0) {
    const threshold = droppedMessages === 0 ? thresholds.triggerTokens : thresholds.targetTokens;
    if (context.safeRemainingForReply >= threshold) break;
    dropOldest();
    if (droppedMessages > summaryAfterDropped) {
      // Only insert a summary if we can afford it while still hitting our cushion target.
      const prev = summaryText;
      summaryText = '';
      const base = recompute();
      summaryText = prev;

      const budgetForSummaryTokens =
        modelEntry.contextLimitTokens -
        maxOutputTokens -
        headroomSafetyTokens -
        thresholds.targetTokens -
        base.estimate.promptTokensEst;

      if (budgetForSummaryTokens >= 8) {
        const maxSummaryChars = Math.min(6400, Math.floor(budgetForSummaryTokens * 4));
        summaryText = buildSummaryFromDropped(dropped, maxSummaryChars);
      } else {
        summaryText = '';
      }
      summaryInserted = Boolean(summaryText);
    }
    ({ systemPromptAppend, estimate, context } = recompute());
  }

  if (context.safeRemainingForReply < 0 && includedLines.length === 0) {
    throw new Error(
      'Prompt is too large for the selected model context window. Reduce attachments or shorten your message.'
    );
  }

  const trimmed = droppedMessages > 0;
  const isMajorCompaction = droppedMessages > 30 || (summaryInserted && droppedMessages > 12);
  const shouldResetSession = isMajorCompaction;

  // Optional reconciliation hint: if provider usage/counters exist later, we'll log them.
  // Also "warm" API key fetch so we can fail early if provider isn't configured.
  if ((params.requireApiKey ?? true) && provider !== 'ollama') {
    void (await getApiKey(provider));
  }

  return {
    provider,
    model: modelEntry.fullId,
    systemPromptAppend,
    selectedSkillIds: skillsBundle.selectedSkillIds,
    estimate,
    context,
    droppedMessages,
    trimmed,
    shouldResetSession,
    summaryInserted,
  };
}
