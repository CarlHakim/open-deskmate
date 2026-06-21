/**
 * Global token usage + estimated cost (informational only; not billing).
 */

import type { ProviderType, SelectedModel } from './provider';

export type UsagePeriod = 'day' | 'week' | 'month';

export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'CAD'
  | 'AUD'
  | 'JPY';

export type PricingSource = 'manual' | 'ai';

export type ProviderPricingRow = {
  provider: ProviderType;
  /**
   * Optional model id. When set, this row applies only to that model.
   * When null/undefined, it acts as the provider default (fallback).
   */
  model?: string | null;
  /** Legacy uncached input price per 1,000,000 tokens. Use inputMissCostPer1m instead. */
  inputCostPer1m?: number | null;
  /** Price per 1,000,000 cached input tokens (cache hits/read tokens). */
  inputHitCostPer1m: number | null;
  /** Price per 1,000,000 uncached input tokens (cache misses/new input tokens). */
  inputMissCostPer1m: number | null;
  /** Price per 1,000,000 tokens (in selected currency). */
  outputCostPer1m: number | null;
  /** ISO date string (YYYY-MM-DD) in local timezone semantics; nullable means "always". */
  effectiveFrom?: string | null;
  pricingSource: PricingSource;
  pricingUpdatedAt: string;
  createdAt: string;
};

export type UsagePricingSettings = {
  currency: CurrencyCode;
  updatedAt: string;
  providers: ProviderPricingRow[];
};

export type UsagePricingAutofillResult = {
  /** Suggested currency (only provided if the app can infer it). */
  currency?: CurrencyCode;
  /** Suggested provider pricing rows. */
  providers: ProviderPricingRow[];
  /**
   * Per-row metadata explaining where the values came from. Key is `${provider}:${model ?? 'default'}`.
   */
  meta: Record<string, { sourceUrl?: string; note?: string; confidence: 'high' | 'medium' | 'low' }>;
  generatedAt: string;
  message: string;
};

export type UsagePricingAutofillRequest = {
  currency?: CurrencyCode;
  /** Explicit list of provider/model pairs to fetch. */
  targets: Array<{ provider: ProviderType; model?: string | null }>;
};

export type UsageProviderBreakdown = {
  provider: ProviderType;
  inputTokens: number;
  inputHitTokens: number;
  inputMissTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputHitCost?: number | null;
  inputMissCost?: number | null;
  outputCost?: number | null;
  /** Sum of costs for priced events; null when provider pricing missing for this period. */
  cost: number | null;
  /** Number of events that were missing pricing at the time they occurred. */
  unpricedEvents: number;
};

export type UsageSummary = {
  period: UsagePeriod;
  rangeStart: string;
  rangeEnd: string;
  inputTokens: number;
  inputHitTokens: number;
  inputMissTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputHitCost?: number | null;
  inputMissCost?: number | null;
  outputCost?: number | null;
  /**
   * Sum of costs for priced events; null when no pricing configured at all.
   * When only some providers are priced, this is a partial sum and `unpricedProviders`
   * indicates what's missing.
   */
  cost: number | null;
  currency?: CurrencyCode;
  providerBreakdown: UsageProviderBreakdown[];
  unpricedProviders: ProviderType[];
  estimatedEvents: number;
  totalEvents: number;
};

export type UsageBudgetMode = 'warn' | 'block';

export type UsageBudgetLimit = {
  id: string;
  agentId?: string | null;
  period: UsagePeriod;
  amount: number | null;
  currency?: CurrencyCode;
  enabled: boolean;
  mode: UsageBudgetMode;
};

export type UsageBudgetSettings = {
  limits: UsageBudgetLimit[];
  updatedAt: string;
};

export type UsageBudgetStatus = {
  id: string;
  agentId?: string | null;
  period: UsagePeriod;
  spent: number | null;
  limit: number | null;
  currency?: CurrencyCode;
  percent: number | null;
  exceeded: boolean;
  blocking: boolean;
  mode: UsageBudgetMode;
};

export type UsageProjectStatus = 'active' | 'archived';
export type UsageProjectBillingType = 'internal' | 'client_billable' | 'fixed_fee' | 'retainer' | 'r_and_d' | 'support' | 'other';
export type UsageProjectPriority = 'low' | 'normal' | 'high' | 'urgent';
export type UsageAssigneeStatus = 'active' | 'archived';

export type UsageAssignee = {
  id: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  color?: string;
  status: UsageAssigneeStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type UsageAssigneeInput = {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  color?: string;
};

export type UsageAssigneeUpdate = {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  color?: string | null;
  status?: UsageAssigneeStatus;
};

export type UsageAssigneeWorkItem = {
  id: string;
  type: 'budget' | 'chat_project' | 'build_preset' | 'build_session';
  name: string;
  usageProjectId?: string | null;
  usageProjectName?: string;
  detail?: string;
  count?: number;
};

export type UsageAssigneeOverview = {
  assignee: UsageAssignee;
  activeBudgetCount: number;
  chatProjectCount: number;
  buildPresetCount: number;
  buildSessionCount: number;
  taskCount: number;
  runCount: number;
  inputHitTokens: number;
  inputMissTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  work: UsageAssigneeWorkItem[];
};

export type UsageProjectLink = {
  id: string;
  label: string;
  url: string;
};

export type UsageProjectNote = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
};

export type UsageProject = {
  id: string;
  name: string;
  color?: string;
  status: UsageProjectStatus;
  trackingEnabled: boolean;
  clientName?: string;
  projectCode?: string;
  owner?: string;
  billingType?: UsageProjectBillingType;
  billingReference?: string;
  priority?: UsageProjectPriority;
  dueDate?: string | null;
  notes?: string;
  noteEntries?: UsageProjectNote[];
  links?: UsageProjectLink[];
  tags?: string[];
  /** Default people doing the work for this budget. Chat projects and Build presets can override it. */
  assigneeIds?: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type UsageProjectInput = {
  name: string;
  color?: string;
  trackingEnabled?: boolean;
  clientName?: string;
  projectCode?: string;
  owner?: string;
  billingType?: UsageProjectBillingType;
  billingReference?: string;
  priority?: UsageProjectPriority;
  dueDate?: string | null;
  notes?: string;
  noteEntries?: UsageProjectNote[];
  links?: UsageProjectLink[];
  tags?: string[];
  assigneeIds?: string[];
};

export type UsageProjectUpdate = {
  name?: string;
  color?: string | null;
  trackingEnabled?: boolean;
  status?: UsageProjectStatus;
  clientName?: string;
  projectCode?: string;
  owner?: string;
  billingType?: UsageProjectBillingType;
  billingReference?: string;
  priority?: UsageProjectPriority;
  dueDate?: string | null;
  notes?: string;
  noteEntries?: UsageProjectNote[];
  links?: UsageProjectLink[];
  tags?: string[];
  assigneeIds?: string[];
};

export type UsageProjectBudgetWindow = {
  id: string;
  projectId: string;
  name: string;
  startsAt: string;
  endsAt?: string | null;
  enabled: boolean;
  mode: UsageBudgetMode;
  moneyLimit?: number | null;
  tokenLimit?: number | null;
  currency?: CurrencyCode;
  createdAt: string;
  updatedAt: string;
};

export type UsageProjectBudgetWindowInput = {
  projectId: string;
  name?: string;
  startsAt: string;
  endsAt?: string | null;
  enabled?: boolean;
  mode?: UsageBudgetMode;
  moneyLimit?: number | null;
  tokenLimit?: number | null;
  currency?: CurrencyCode;
};

export type UsageProjectBudgetWindowUpdate = Partial<Omit<UsageProjectBudgetWindowInput, 'projectId'>> & {
  projectId?: string;
};

export type UsageProjectSummaryRequest = {
  projectId: string;
  startsAt?: string;
  endsAt?: string | null;
};

export type UsageProjectSummary = {
  projectId: string;
  project?: UsageProject;
  window?: UsageProjectBudgetWindow;
  summary: UsageSummary;
};

export type UsageProjectAnalyticsRequest = {
  projectId: string;
  startsAt?: string;
  endsAt?: string | null;
  windowId?: string;
  days?: number;
};

export type UsageProjectAnalyticsDailyPoint = {
  date: string;
  rangeStart: string;
  rangeEnd: string;
  inputHitTokens: number;
  inputMissTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputHitCost?: number | null;
  inputMissCost?: number | null;
  outputCost?: number | null;
  cost: number | null;
  totalEvents: number;
  estimatedEvents: number;
};

export type UsageProjectAnalyticsModelBreakdown = {
  provider: ProviderType;
  model: string;
  inputHitTokens: number;
  inputMissTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputHitCost?: number | null;
  inputMissCost?: number | null;
  outputCost?: number | null;
  cost: number | null;
  totalEvents: number;
  estimatedEvents: number;
  unpricedProviders: ProviderType[];
};

export type UsageProjectAnalyticsWorkBreakdown = {
  taskId: string;
  inputHitTokens: number;
  inputMissTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputHitCost?: number | null;
  inputMissCost?: number | null;
  outputCost?: number | null;
  cost: number | null;
  totalEvents: number;
  estimatedEvents: number;
  unpricedProviders: ProviderType[];
  firstSeenAt: string;
  lastSeenAt: string;
};

export type UsageProjectAnalytics = {
  projectId: string;
  project?: UsageProject;
  window?: UsageProjectBudgetWindow;
  rangeStart: string;
  rangeEnd: string;
  summary: UsageSummary;
  daily: UsageProjectAnalyticsDailyPoint[];
  modelBreakdown: UsageProjectAnalyticsModelBreakdown[];
  workBreakdown: UsageProjectAnalyticsWorkBreakdown[];
};

export type UsageProjectBudgetStatus = {
  id: string;
  projectId: string;
  windowId: string;
  windowName: string;
  startsAt: string;
  endsAt?: string | null;
  spent: number | null;
  moneyLimit: number | null;
  tokens: number;
  tokenLimit: number | null;
  currency?: CurrencyCode;
  moneyPercent: number | null;
  tokenPercent: number | null;
  exceededMoney: boolean;
  exceededTokens: boolean;
  exceeded: boolean;
  blocking: boolean;
  mode: UsageBudgetMode;
};

export type UsageProjectWorkItemSourceType = 'manual' | 'chat_project' | 'chat_task' | 'build_preset' | 'build_session';

export type UsageProjectWorkItemChecklistItem = {
  id: string;
  text: string;
  completed: boolean;
  assigneeIds?: string[];
  dueDate?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type UsageProjectWorkItemChecklistList = {
  id: string;
  name: string;
  items: UsageProjectWorkItemChecklistItem[];
  context?: string;
  outlineColor?: string;
  createdAt: string;
  updatedAt?: string;
};

export type ChecklistListPromptPurpose = 'build' | 'research' | 'review' | 'write' | 'custom';

export type ChecklistListPromptGenerateItem = {
  id: string;
  text: string;
  completed?: boolean;
  assigneeNames?: string[];
  dueDate?: string | null;
};

export type ChecklistListPromptGenerateRequest = {
  agentId?: string | null;
  purpose?: ChecklistListPromptPurpose;
  customPurpose?: string;
  workItemTitle?: string;
  listName?: string;
  listContext?: string;
  extraInstruction?: string;
  includeWorkItemName?: boolean;
  includeListName?: boolean;
  includeListContext?: boolean;
  includeAssignee?: boolean;
  includeDueDate?: boolean;
  includeCompletedItems?: boolean;
  items: ChecklistListPromptGenerateItem[];
};

export type ChecklistListPromptGenerateResponse = {
  ok: boolean;
  prompt: string;
  model?: SelectedModel | null;
  error?: string;
};

export type WorkItemNotePromptGenerateRequest = {
  agentId?: string | null;
  purpose?: ChecklistListPromptPurpose;
  customPurpose?: string;
  workItemTitle?: string;
  noteTitle?: string;
  noteText: string;
  noteHtml?: string;
  extraInstruction?: string;
  includeWorkItemName?: boolean;
  includeNoteTitle?: boolean;
};

export type WorkItemNotePromptGenerateResponse = ChecklistListPromptGenerateResponse;

export type UsageProjectWorkItemNote = {
  id: string;
  title?: string;
  text: string;
  html?: string;
  outlineColor?: string;
  createdAt: string;
  updatedAt?: string;
};

export type UsageProjectWorkItemDrawingElementKind = 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'text';
export type UsageProjectWorkItemDrawingLineStyle = 'solid' | 'dashed' | 'dotted';

export type UsageProjectWorkItemDrawingElement = {
  id: string;
  kind: UsageProjectWorkItemDrawingElementKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  fill: string;
  fillOpacity?: number;
  strokeWidth: number;
  strokeStyle?: UsageProjectWorkItemDrawingLineStyle;
  text?: string;
  fontSize?: number;
};

export type UsageProjectWorkItemDrawing = {
  id: string;
  title: string;
  width: number;
  height: number;
  elements: UsageProjectWorkItemDrawingElement[];
  outlineColor?: string;
  createdAt: string;
  updatedAt?: string;
};

export type UsageProjectWorkItemDocumentLinkKind = 'local' | 'url';

export type UsageProjectWorkItemDocumentLink = {
  id: string;
  label: string;
  kind: UsageProjectWorkItemDocumentLinkKind;
  path?: string;
  url?: string;
  outlineColor?: string;
  createdAt: string;
};

export type UsageProjectWorkItem = {
  id: string;
  usageProjectId: string;
  title: string;
  description?: string;
  color?: string;
  sourceType: UsageProjectWorkItemSourceType;
  sourceId?: string;
  statusId: string;
  priority: UsageProjectPriority;
  assigneeIds: string[];
  startDate?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  blocked: boolean;
  blockedReason?: string;
  tags: string[];
  checklist: UsageProjectWorkItemChecklistItem[];
  checklistLists?: UsageProjectWorkItemChecklistList[];
  notes: UsageProjectWorkItemNote[];
  drawings?: UsageProjectWorkItemDrawing[];
  documents?: UsageProjectWorkItemDocumentLink[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UsageProjectWorkItemInput = {
  usageProjectId: string;
  title: string;
  description?: string;
  color?: string | null;
  sourceType?: UsageProjectWorkItemSourceType;
  sourceId?: string | null;
  statusId?: string;
  priority?: UsageProjectPriority;
  assigneeIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  blocked?: boolean;
  blockedReason?: string;
  tags?: string[];
  checklist?: UsageProjectWorkItemChecklistItem[];
  checklistLists?: UsageProjectWorkItemChecklistList[];
  notes?: UsageProjectWorkItemNote[];
  drawings?: UsageProjectWorkItemDrawing[];
  documents?: UsageProjectWorkItemDocumentLink[];
  archived?: boolean;
};

export type UsageProjectWorkItemUpdate = Partial<Omit<UsageProjectWorkItemInput, 'usageProjectId'>> & {
  usageProjectId?: string;
};

export type UsageProjectKanbanColumn = {
  id: string;
  usageProjectId: string;
  name: string;
  order: number;
  color?: string;
  wipLimit?: number | null;
  doneState?: boolean;
  archivedState?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UsageProjectKanbanColumnInput = {
  usageProjectId: string;
  name: string;
  order?: number;
  color?: string;
  wipLimit?: number | null;
  doneState?: boolean;
  archivedState?: boolean;
};

export type UsageProjectKanbanColumnUpdate = Partial<Omit<UsageProjectKanbanColumnInput, 'usageProjectId'>> & {
  usageProjectId?: string;
};
