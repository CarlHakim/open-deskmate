export type ScheduleSource = 'cron' | 'interval';

export interface ScheduleConfig {
  name: string;
  prompt: string;
  /** Cron expression (5-part standard) */
  cron: string;
  /** Agent identifier */
  agentId?: string;
  /** Optional timezone (IANA TZ) */
  timezone?: string;
  /** Optional working directory for the task */
  workingDirectory?: string;
  /** Optional session ID to resume */
  sessionId?: string;
  /** Reuse the last session for this schedule */
  reuseSession?: boolean;
  /** Optional system prompt append */
  systemPromptAppend?: string;
  enabled: boolean;
}

export interface ScheduledTask extends ScheduleConfig {
  id: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface AutomationDraftRequest {
  text: string;
  agentId?: string;
  timezone?: string;
}

export interface AutomationDraftResult {
  schedule: ScheduleConfig;
  confidence: number;
  warnings: string[];
  source?: 'local' | 'ai' | 'fallback';
}
