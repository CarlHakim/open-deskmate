export type LocalSearchSource =
  | 'chat_task'
  | 'build_task'
  | 'build_runtime'
  | 'tool_call'
  | 'project'
  | 'workboard_item'
  | 'workboard_note'
  | 'linked_document'
  | 'memory_file'
  | 'memory_change'
  | 'skill'
  | 'git_summary'
  | 'connector_message'
  | 'audit_event';

export type SearchJumpTargetKind =
  | 'chat'
  | 'build'
  | 'project_management'
  | 'memory'
  | 'skill'
  | 'connector'
  | 'audit';

export interface SearchJumpTarget {
  kind: SearchJumpTargetKind;
  label?: string;
  route?: string;
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  messageId?: string;
  projectId?: string;
  workItemId?: string;
  noteId?: string;
  documentId?: string;
  connectorId?: string;
  connectorInstanceId?: string;
  deliveryId?: string;
  skillId?: string;
  memoryKind?: string;
  auditEventId?: string;
  path?: string;
  lineNumber?: number;
  params?: Record<string, string>;
}

export interface SearchItemReference {
  source: LocalSearchSource;
  id: string;
  agentId?: string;
  taskId?: string;
  path?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  workItemId?: string;
  noteId?: string;
  documentId?: string;
  connectorId?: string;
  connectorInstanceId?: string;
  deliveryId?: string;
  skillId?: string;
  memoryKind?: string;
  category?: AuditEventCategory;
  status?: string;
  jump?: SearchJumpTarget;
}

export interface SearchResultItem {
  id: string;
  source: LocalSearchSource;
  title: string;
  subtitle?: string;
  excerpt: string;
  score: number;
  updatedAt?: string;
  agentId?: string;
  tags?: string[];
  ref: SearchItemReference;
}

export interface SearchIndexRebuildRequest {
  agentId?: string;
  includeGit?: boolean;
}

export interface SearchIndexRebuildResult {
  ok: true;
  indexedAt: string;
  totalItems: number;
  sourceCounts: Partial<Record<LocalSearchSource, number>>;
  warnings: string[];
}

export interface SearchQueryRequest {
  query: string;
  sources?: LocalSearchSource[];
  agentId?: string;
  taskId?: string;
  projectId?: string;
  connectorId?: string;
  connectorInstanceId?: string;
  skillId?: string;
  memoryKind?: string;
  category?: AuditEventCategory;
  status?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface SearchQueryResult {
  query: string;
  indexedAt?: string;
  totalItems: number;
  results: SearchResultItem[];
  sourceCounts: Partial<Record<LocalSearchSource, number>>;
  warnings: string[];
}

export interface SearchItemGetRequest {
  id: string;
}

export interface SearchItemDetail {
  item: SearchResultItem;
  content: string;
  data?: unknown;
}

export type AuditEventCategory =
  | 'task'
  | 'tool_use'
  | 'discovery'
  | 'memory'
  | 'skill'
  | 'tool_discovery'
  | 'connector'
  | 'scheduled'
  | 'always_on'
  | 'execution_profile'
  | 'git'
  | 'build_runtime'
  | 'search'
  | 'settings'
  | 'system';

export type AuditEventStatus = 'info' | 'success' | 'warning' | 'error';

export interface AuditEventRecord {
  id: string;
  category: AuditEventCategory;
  action: string;
  title: string;
  summary?: string;
  status: AuditEventStatus;
  timestamp: string;
  agentId?: string;
  taskId?: string;
  projectId?: string;
  connectorId?: string;
  connectorInstanceId?: string;
  skillId?: string;
  memoryKind?: string;
  targetType?: string;
  targetId?: string;
  source?: string;
  jump?: SearchJumpTarget;
  derived?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuditListRequest {
  category?: AuditEventCategory;
  status?: AuditEventStatus;
  agentId?: string;
  taskId?: string;
  projectId?: string;
  connectorId?: string;
  connectorInstanceId?: string;
  skillId?: string;
  memoryKind?: string;
  targetType?: string;
  targetId?: string;
  query?: string;
  since?: string;
  until?: string;
  limit?: number;
  includeDerived?: boolean;
}

export interface AuditListResult {
  events: AuditEventRecord[];
  total: number;
}

export interface AuditGetRequest {
  id: string;
}

export interface AuditExportRequest extends AuditListRequest {
  format?: 'json' | 'jsonl' | 'csv';
}

export interface AuditExportResult {
  filename: string;
  mimeType: string;
  content: string;
  count: number;
}
