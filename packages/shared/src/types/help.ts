export interface HelpDocIndexEntry {
  id: string;
  title: string;
  file: string;
  description?: string;
}

export interface HelpDocsIndexFile {
  docs: HelpDocIndexEntry[];
  embeddedSiteUrl?: string;
}

export interface HelpDocSummary {
  id: string;
  title: string;
  file: string;
  description?: string;
  order: number;
}

export interface HelpDocsListResponse {
  docs: HelpDocSummary[];
  rootDir: string;
  embeddedSiteUrl?: string;
}

export interface HelpDocPageResponse {
  doc: HelpDocSummary;
  content: string;
  absolutePath: string;
  lastModifiedMs: number;
}

export interface HelpDocsSearchResult {
  docId: string;
  title: string;
  file: string;
  score: number;
  excerpt: string;
}

export interface HelpDocsSearchResponse {
  query: string;
  results: HelpDocsSearchResult[];
}

export interface HelpDocsUpdatedEvent {
  changedAt: string;
}
