import type { ProviderType } from './provider';

export type ContextTokenBreakdown = {
  system: number;
  tools: number;
  retrieved: number;
  history: number;
  newMessage: number;
};

export type ContextTokenEstimate = {
  promptTokensEst: number;
  estimated: boolean;
  breakdown: ContextTokenBreakdown;
};

export type ContextWindowStats = {
  contextLimitTokens: number;
  maxOutputTokens: number;
  headroomSafetyTokens: number;
  promptTokens: number;
  usedPct: number;
  remainingInput: number;
  safeRemainingForReply: number;
};

export type ContextWindowEstimateResponse = {
  provider: ProviderType;
  model: string;
  estimate: ContextTokenEstimate;
  context: ContextWindowStats;
  droppedMessages: number;
  trimmed: boolean;
  summaryInserted: boolean;
  shouldResetSession: boolean;
};

// Used internally by the main process to actually configure OpenCode.
export type ContextWindowPrepareResult = ContextWindowEstimateResponse & {
  systemPromptAppend: string;
  selectedSkillIds?: string[];
};
