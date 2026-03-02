import type { SelectedModel } from './provider';

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
  createdAt: string;
  updatedAt: string;
}
