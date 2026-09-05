import type { SelectedModel } from './provider';
import type { SubagentSpawnMode } from './subagents';
import type { PermissionPolicyAction } from './permissions';
import type { ToolsetId } from './toolsets';

export type AgentMemoryWriteMode = 'automatic' | 'approval' | 'off';
export type AgentSkillAutomationMode = 'automatic' | 'approval' | 'off';
export type AgentReactionMode = 'off' | 'minimal' | 'standard' | 'playful';

export interface AgentAppearance {
  avatarFrame?: string;
  accentColor?: string;
  answerStyle?: string;
  chatBackgroundId?: string;
  showAvatarOnAnswers?: boolean;
  presenceAnimation?: string;
  reactionMode?: AgentReactionMode;
}

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
  avatarImageDataUrl?: string;
  appearance?: AgentAppearance | null;
  workspaceRoot?: string;
  systemPromptAppend?: string;
  selectedModel?: SelectedModel | null;
  toolsetIds?: ToolsetId[];
  deferredToolDiscoveryEnabled?: boolean;
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
  alwaysOnEnabled?: boolean;
  alwaysOnWorkboardDispatchEnabled?: boolean;
  alwaysOnWorkboardProjectIds?: string[];
  autoSkillEnabled?: boolean;
  autoSkillAutoPromoteLowRisk?: boolean;
  skillAutomationMode?: AgentSkillAutomationMode;
  memoryWriteMode?: AgentMemoryWriteMode;
  memoryNotificationsEnabled?: boolean;
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
  avatarImageDataUrl?: string;
  appearance?: AgentAppearance;
  workspaceRoot?: string;
  systemPromptAppend?: string;
  selectedModel?: SelectedModel;
  toolsetIds?: ToolsetId[];
  deferredToolDiscoveryEnabled?: boolean;
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
  alwaysOnEnabled?: boolean;
  alwaysOnWorkboardDispatchEnabled?: boolean;
  alwaysOnWorkboardProjectIds?: string[];
  autoSkillEnabled?: boolean;
  autoSkillAutoPromoteLowRisk?: boolean;
  skillAutomationMode?: AgentSkillAutomationMode;
  memoryWriteMode?: AgentMemoryWriteMode;
  memoryNotificationsEnabled?: boolean;
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
