import type { SelectedModel } from './provider';

export interface ChatToolCompatibilityCheckRequest {
  agentId: string;
  model?: SelectedModel | null;
  deferredToolDiscoveryEnabled?: boolean;
}

export interface ChatToolCompatibilityCaseResult {
  id: string;
  label: string;
  passed: boolean;
  missingCapabilities: string[];
  missingTools: string[];
  detail?: string;
  recommendation?: string;
}

export interface ChatToolCompatibilityCheckResult {
  agentId: string;
  model?: SelectedModel | null;
  checkedAt: string;
  backendAvailable: boolean;
  safeToEnable: boolean;
  missingCapabilities: string[];
  missingTools: string[];
  recommendation: string;
  cases: ChatToolCompatibilityCaseResult[];
}
