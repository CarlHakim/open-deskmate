export type RuntimeHookEvent =
  | 'before_task_dispatch'
  | 'before_task_resume'
  | 'before_node_tool'
  | 'after_task_complete'
  | 'after_node_tool';

export type RuntimeHookAction =
  | 'allow'
  | 'block'
  | 'prepend_prompt'
  | 'append_system_prompt'
  | 'patch_input'
  | 'record_note';

export interface RuntimeHookMatch {
  agentIds?: string[];
  toolNames?: string[];
  sources?: string[];
}

export interface RuntimeHookDefinition {
  id: string;
  event: RuntimeHookEvent;
  enabled?: boolean;
  description?: string;
  match?: RuntimeHookMatch;
  action: RuntimeHookAction;
  message?: string;
  promptText?: string;
  systemPromptText?: string;
  inputPatch?: Record<string, unknown>;
  noteText?: string;
}

export interface RuntimeHookRegistry {
  hooks: RuntimeHookDefinition[];
}

export interface RuntimeHookContext {
  event: RuntimeHookEvent;
  agentId?: string;
  taskId?: string;
  toolName?: string;
  source?: string;
  prompt?: string;
  systemPromptAppend?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface RuntimeHookRunResult {
  ok: boolean;
  blockReason?: string;
  matchedHookIds: string[];
  promptPrefix?: string;
  systemPromptAppend?: string;
  inputPatch?: Record<string, unknown>;
  notes?: string[];
}

export interface RuntimeHookDiagnosticEntry {
  id: string;
  timestamp: string;
  event: RuntimeHookEvent;
  agentId?: string;
  taskId?: string;
  toolName?: string;
  source?: string;
  matchedHookIds: string[];
  ok: boolean;
  blockReason?: string;
  notes?: string[];
  inputPreview?: string;
  outputPreview?: string;
}

export interface RuntimeHooksSettingsState {
  path: string;
  raw: string;
  hookCount: number;
}

export interface RuntimeHooksDiagnosticsState {
  entries: RuntimeHookDiagnosticEntry[];
}
