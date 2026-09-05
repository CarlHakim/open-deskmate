export type MemoryKind = 'user' | 'long-term' | 'daily' | 'snapshot';
export type MemoryChangeMode = 'append' | 'replace';
export type MemoryChangeStatus = 'automatic' | 'staged' | 'applied' | 'reverted';

export interface MemoryEntrySummary {
  id: string;
  kind: MemoryKind;
  label: string;
  path: string;
  relativePath: string;
  exists: boolean;
  bytes: number;
  updatedAt?: string;
  date?: string;
  fileName?: string;
  taskId?: string;
  sessionId?: string;
  source?: string;
  excerpt: string;
}

export interface MemorySearchResult extends MemoryEntrySummary {
  lineNumber?: number;
  matchExcerpt: string;
}

export interface MemoryChangeSnapshot {
  exists: boolean;
  content: string;
  sha256: string;
}

export interface MemoryChangePreview {
  file: string;
  kind: MemoryKind;
  mode: MemoryChangeMode;
  beforeBytes: number;
  afterBytes: number;
  beforeExcerpt: string;
  afterExcerpt: string;
}

export interface MemoryChangeRecord {
  id: string;
  kind: MemoryKind;
  mode: MemoryChangeMode;
  status: MemoryChangeStatus;
  filePath: string;
  relativePath?: string;
  date?: string;
  agentId?: string;
  source?: string;
  taskId?: string;
  reason?: string;
  before: MemoryChangeSnapshot;
  after: MemoryChangeSnapshot;
  preview: MemoryChangePreview;
  createdAt: string;
  appliedAt?: string;
  revertedAt?: string;
}

export interface MemoryChangeHistoryFilter {
  limit?: number;
  kind?: MemoryKind | MemoryKind[];
  status?: MemoryChangeStatus | MemoryChangeStatus[];
  agentId?: string;
  taskId?: string;
  source?: string | string[];
  includeReverted?: boolean;
  since?: string;
  until?: string;
}

export interface MemoryChangeListResult {
  changes: MemoryChangeRecord[];
}

export interface MemorySearchResponse {
  results: MemorySearchResult[];
}
