import type { ToolsetId } from './toolsets';

export type ChatDeferredCompatibilityCaseId =
  | 'plain_chat'
  | 'web_lookup'
  | 'image_url_answer'
  | 'attachment_summary'
  | 'saved_prompt_skill'
  | 'memory'
  | 'project_budget_metadata'
  | 'local_model_chat_only'
  | 'browser_dev_browser';

export type ChatDeferredCompatibilityCoverage = 'full' | 'partial' | 'none';
export type ChatDeferredCompatibilityPhase = 'initial' | 'deferred' | 'unavailable';

export interface ChatDeferredCompatibilityRequest {
  baselineToolsetIds?: ToolsetId[];
  minimalToolsetIds?: ToolsetId[];
  deferredToolsetIds?: ToolsetId[];
}

export interface ChatDeferredCompatibilityAvailability {
  toolsetIds: ToolsetId[];
  capabilityNames: string[];
  toolNames: string[];
  coverage: ChatDeferredCompatibilityCoverage;
  availableCapabilities: string[];
  missingCapabilities: string[];
  availableTools: string[];
  missingTools: string[];
}

export interface ChatDeferredCompatibilityDeferredAvailability extends ChatDeferredCompatibilityAvailability {
  phase: ChatDeferredCompatibilityPhase;
  initial: ChatDeferredCompatibilityAvailability;
  expanded: ChatDeferredCompatibilityAvailability;
}

export interface ChatDeferredCompatibilityTokenEstimate {
  baselinePromptTokensEst: number;
  deferredInitialPromptTokensEst: number;
  deferredExpandedPromptTokensEst: number;
  estimatedInitialSavingsTokens: number;
  estimatedInitialSavingsPct: number;
  method: 'heuristic_chars_per_token';
}

export interface ChatDeferredCompatibilityCaseResult {
  id: ChatDeferredCompatibilityCaseId;
  name: string;
  description: string;
  prompt: string;
  requiredCapabilities: string[];
  requiredToolNames: string[];
  baselineAvailability: ChatDeferredCompatibilityAvailability;
  deferredAvailability: ChatDeferredCompatibilityDeferredAvailability;
  passed: boolean;
  tokenEstimate: ChatDeferredCompatibilityTokenEstimate;
  recommendations: string[];
}

export interface ChatDeferredCompatibilitySummary {
  packVersion: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  baselineToolsetIds: ToolsetId[];
  minimalToolsetIds: ToolsetId[];
  deferredToolsetIds: ToolsetId[];
  requiredCapabilities: string[];
  requiredToolNames: string[];
  baselineCapabilityNames: string[];
  deferredCapabilityNames: string[];
  baselineToolNames: string[];
  deferredToolNames: string[];
  tokenEstimate: ChatDeferredCompatibilityTokenEstimate;
}

export interface ChatDeferredCompatibilityProofResult {
  packVersion: string;
  summary: ChatDeferredCompatibilitySummary;
  cases: ChatDeferredCompatibilityCaseResult[];
  passed: boolean;
  unknownToolsetIds: {
    baseline: string[];
    minimal: string[];
    deferred: string[];
  };
  recommendations: string[];
}
