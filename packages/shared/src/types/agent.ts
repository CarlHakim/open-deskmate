import type { SelectedModel } from './provider';
import type { SubagentSpawnMode } from './subagents';
import type { PermissionPolicyAction } from './permissions';

export interface AgentPermissionProfile {
  enabled?: boolean;
  file?: {
    allowWorkspaceWritesWithoutPrompt?: boolean;
    allowTaskScopedAllowAll?: boolean;
    defaultDecision?: PermissionPolicyAction;
  };
  runtime?: {
    defaultToolDecision?: PermissionPolicyAction;
    defaultQuestionDecision?: PermissionPolicyAction;
    allowedToolNames?: string[];
    blockedToolNames?: string[];
  };
}

export interface AgentConfig {
  id?: string;
  name: string;
  roleName?: string;
  description?: string;
  avatar?: string;
  avatarColor?: string;
  workspaceRoot?: string;
  systemPromptAppend?: string;
  selectedModel?: SelectedModel | null;
  agenticLoopEnabled?: boolean;
  agenticLoopMaxIterations?: number;
  agenticLoopTimeoutMs?: number;
  heartbeatEnabled?: boolean;
  heartbeatIntervalSeconds?: number;
  heartbeatScheduleMode?: 'interval' | 'daily';
  heartbeatIntervalMinutes?: number;
  heartbeatDailyTime?: string;
  heartbeatTimeZone?: string;
  heartbeatWindowEnabled?: boolean;
  heartbeatWindowStartTime?: string;
  heartbeatWindowEndTime?: string;
  heartbeatPrompt?: string;
  autoSkillEnabled?: boolean;
  autoSkillAutoPromoteLowRisk?: boolean;
  subagentsEnabled?: boolean;
  subagentMaxChildren?: number;
  subagentMaxDepth?: number;
  subagentAllowedAgentIds?: string[];
  subagentAutoRelayCompletions?: boolean;
  subagentDefaultModel?: SelectedModel | null;
  subagentRunTimeoutMs?: number;
  subagentDefaultMode?: SubagentSpawnMode;
  subagentInheritWorkingDirectory?: boolean;
  subagentInheritAttachedFiles?: boolean;
  subagentInheritPrivacyMode?: boolean;
  permissionProfile?: AgentPermissionProfile | null;
}

export interface AgentProfile {
  id: string;
  name: string;
  roleName?: string;
  description?: string;
  avatar?: string;
  avatarColor?: string;
  workspaceRoot?: string;
  systemPromptAppend?: string;
  selectedModel?: SelectedModel;
  agenticLoopEnabled?: boolean;
  agenticLoopMaxIterations?: number;
  agenticLoopTimeoutMs?: number;
  heartbeatEnabled?: boolean;
  heartbeatIntervalSeconds?: number;
  heartbeatScheduleMode?: 'interval' | 'daily';
  heartbeatIntervalMinutes?: number;
  heartbeatDailyTime?: string;
  heartbeatTimeZone?: string;
  heartbeatWindowEnabled?: boolean;
  heartbeatWindowStartTime?: string;
  heartbeatWindowEndTime?: string;
  heartbeatPrompt?: string;
  autoSkillEnabled?: boolean;
  autoSkillAutoPromoteLowRisk?: boolean;
  subagentsEnabled?: boolean;
  subagentMaxChildren?: number;
  subagentMaxDepth?: number;
  subagentAllowedAgentIds?: string[];
  subagentAutoRelayCompletions?: boolean;
  subagentDefaultModel?: SelectedModel;
  subagentRunTimeoutMs?: number;
  subagentDefaultMode?: SubagentSpawnMode;
  subagentInheritWorkingDirectory?: boolean;
  subagentInheritAttachedFiles?: boolean;
  subagentInheritPrivacyMode?: boolean;
  permissionProfile?: AgentPermissionProfile;
  createdAt: string;
  updatedAt: string;
}
