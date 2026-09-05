import {
  DEFAULT_AGENT_TOOLSET_IDS,
  DEFAULT_BUILD_PRESET_TOOLSET_IDS,
  DEFAULT_FORMAL_TOOL_CAPABILITIES,
  DEFAULT_FORMAL_TOOLSETS,
  DEFAULT_LOCAL_MODEL_EXTENDED_TOOLSET_IDS,
  DEFAULT_LOCAL_MODEL_TOOLSET_IDS,
  DEFAULT_TOOL_DISCOVERY_COMMANDS,
  FORMAL_TOOLSET_IDS,
  TOOL_DISCOVERY_TOOL_NAMES,
  type FormalToolsetDefinition,
  type OllamaToolMode,
  type ResolvedToolsetDefinition,
  type ToolCapability,
  type ToolCapabilityListResult,
  type ToolDiscoveryAuditEvent,
  type ToolDiscoveryCommandDefinition,
  type ToolDiscoveryDescribeResult,
  type ToolDiscoveryEnableRequest,
  type ToolDiscoveryEnableResult,
  type ToolDiscoveryEnableStatus,
  type ToolDiscoveryEnabledListResult,
  type ToolDiscoveryMcpConfigRegenerationContract,
  type ToolDiscoveryRuntimeMetadata,
  type ToolDiscoverySearchResult,
  type ToolDiscoveryToolName,
  type ToolsetId,
  type ToolsetListResult,
  type ToolsetResolution,
} from '@accomplish/shared';

const KNOWN_TOOLSET_IDS = new Set<string>(FORMAL_TOOLSET_IDS);
const CAPABILITY_BY_NAME = new Map(DEFAULT_FORMAL_TOOL_CAPABILITIES.map((entry) => [entry.name, entry]));
const TOOLSET_BY_ID = new Map(DEFAULT_FORMAL_TOOLSETS.map((entry) => [entry.id, entry]));
const DISCOVERY_TOOL_BY_NAME = new Map(DEFAULT_TOOL_DISCOVERY_COMMANDS.map((entry) => [entry.name, entry]));
const DEFAULT_DEFERRED_INITIAL_TOOLSET_IDS: ToolsetId[] = ['chat_safe'];
const TASK_SCOPED_DISCOVERY_STATE = new Map<string, ToolDiscoveryRuntimeMetadata>();
const PREFERRED_TOOLSET_BY_CAPABILITY = new Map<string, ToolsetId>([
  ['chat_response', 'chat_safe'],
  ['ask_user', 'chat_safe'],
  ['web_research', 'research'],
  ['image_url_context', 'research'],
  ['browser_automation', 'research'],
  ['attachment_context', 'coding'],
  ['workspace_read', 'coding'],
  ['workspace_edit', 'coding'],
  ['file_permission', 'coding'],
  ['shell_command', 'coding'],
  ['skill_management', 'coding'],
  ['runtime_status', 'build_runtime'],
  ['runtime_logs', 'build_runtime'],
  ['runtime_preview', 'build_runtime'],
  ['runtime_quality', 'build_runtime'],
  ['build_git', 'build_runtime'],
  ['messaging_review', 'messaging_safe'],
  ['messaging_send_guarded', 'messaging_safe'],
  ['desktop_artifacts', 'desktop_full'],
  ['saved_prompt_context', 'desktop_full'],
  ['user_skill_context', 'desktop_full'],
  ['memory_context', 'desktop_full'],
  ['usage_project_metadata', 'desktop_full'],
  ['custom_mcp', 'custom'],
]);

export type ToolDiscoveryAuditHook = (event: ToolDiscoveryAuditEvent) => void | Promise<void>;

let toolDiscoveryAuditHook: ToolDiscoveryAuditHook | undefined;

export function setToolDiscoveryAuditHook(hook: ToolDiscoveryAuditHook | undefined): void {
  toolDiscoveryAuditHook = hook;
}

function cloneCapability(capability: ToolCapability): ToolCapability {
  return {
    ...capability,
    toolNames: capability.toolNames ? [...capability.toolNames] : undefined,
  };
}

function cloneToolset(toolset: FormalToolsetDefinition): FormalToolsetDefinition {
  return {
    ...toolset,
    capabilityNames: [...toolset.capabilityNames],
    defaultToolNames: toolset.defaultToolNames ? [...toolset.defaultToolNames] : undefined,
    runtime: toolset.runtime
      ? {
          ...toolset.runtime,
          mcpServerIds: toolset.runtime.mcpServerIds ? [...toolset.runtime.mcpServerIds] : undefined,
        }
      : undefined,
  };
}

function resolveToolset(toolset: FormalToolsetDefinition): ResolvedToolsetDefinition {
  return {
    ...cloneToolset(toolset),
    capabilities: toolset.capabilityNames
      .map((name) => CAPABILITY_BY_NAME.get(name))
      .filter((entry): entry is ToolCapability => Boolean(entry))
      .map(cloneCapability),
  };
}

function uniqueCapabilities(toolsets: ResolvedToolsetDefinition[]): ToolCapability[] {
  const seen = new Set<string>();
  const capabilities: ToolCapability[] = [];
  for (const toolset of toolsets) {
    for (const capability of toolset.capabilities) {
      if (seen.has(capability.name)) continue;
      seen.add(capability.name);
      capabilities.push(cloneCapability(capability));
    }
  }
  return capabilities;
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function matchesQuery(query: string, parts: Array<string | undefined>): boolean {
  if (!query) return true;
  const normalizedParts = parts.map((part) => String(part ?? '').toLowerCase());
  if (normalizedParts.some((part) => part.includes(query))) return true;
  const terms = query.split(/\s+/).map((term) => term.trim()).filter(Boolean);
  return terms.length > 1 && terms.some((term) => normalizedParts.some((part) => part.includes(term)));
}

function normalizeOllamaToolModeForToolsets(value: unknown): OllamaToolMode {
  switch (value) {
    case 'basic':
    case 'internet':
      return 'internet';
    case 'workspace-read':
    case 'workspace-edit':
    case 'desktop':
    case 'full':
      return value;
    default:
      return 'off';
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function uniqueToolsetIds(values: readonly ToolsetId[]): ToolsetId[] {
  return uniqueStrings(values) as ToolsetId[];
}

export function mergeToolsetIds(...values: Array<readonly ToolsetId[] | undefined>): ToolsetId[] {
  return uniqueToolsetIds(values.flatMap((entry) => entry ?? []));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((entry) => String(entry ?? '')));
}

function cloneDiscoveryTool(tool: ToolDiscoveryCommandDefinition): ToolDiscoveryCommandDefinition {
  return { ...tool };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardMatches(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern.toLowerCase() === value.toLowerCase();
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
  return regex.test(value);
}

function toolNameMatches(patternOrName: string, value: string): boolean {
  return wildcardMatches(patternOrName, value) || wildcardMatches(value, patternOrName);
}

function toolNamesForResolution(resolution: ToolsetResolution): string[] {
  const names: string[] = [];
  for (const toolset of resolution.toolsets) {
    names.push(...(toolset.defaultToolNames ?? []));
  }
  for (const capability of resolution.tools) {
    names.push(...(capability.toolNames ?? []));
  }
  return uniqueStrings(names);
}

function discoveryScopeKey(params: { taskId?: string; agentId?: string }): string | null {
  const taskId = String(params.taskId ?? '').trim();
  if (taskId) return `task:${taskId}`;
  const agentId = String(params.agentId ?? '').trim();
  return agentId ? `agent:${agentId}` : null;
}

function mergeAvailableToolsetIds(initialToolsetIds: readonly ToolsetId[], requestedToolsetIds: readonly ToolsetId[]): ToolsetId[] {
  return uniqueToolsetIds([...initialToolsetIds, ...requestedToolsetIds]);
}

function buildEmptyMcpRegenerationContract(): ToolDiscoveryMcpConfigRegenerationContract {
  return {
    required: false,
    resumable: false,
    toolsetIds: [],
    mcpServerIds: [],
  };
}

function buildMcpRegenerationContract(toolsetIds: readonly ToolsetId[]): ToolDiscoveryMcpConfigRegenerationContract {
  const resolution = resolveToolsets(toolsetIds);
  const requiringToolsets = resolution.toolsets.filter((toolset) => (
    toolset.runtime?.requiresConfigRegenerationOnEnable === true
  ));
  const requiringIds = requiringToolsets.map((toolset) => toolset.id);
  if (requiringIds.length === 0) {
    return buildEmptyMcpRegenerationContract();
  }

  const mcpServerIds = uniqueStrings(requiringToolsets.flatMap((toolset) => toolset.runtime?.mcpServerIds ?? []));
  const customOnly = requiringIds.every((id) => id === 'custom');
  const reason = customOnly
    ? 'External custom MCP tools are loaded from the OpenDeskmate MCP registry when a task starts or resumes.'
    : 'One or more enabled toolsets require OpenCode MCP server configuration to be regenerated before use.';

  return {
    required: true,
    resumable: true,
    reason,
    toolsetIds: requiringIds,
    mcpServerIds,
    notification: {
      level: 'info',
      title: 'Additional tools enabled',
      message: `${requiringIds.join(', ')} will be loaded automatically after OpenCode refreshes its tool configuration.`,
      action: 'resume_task',
      actionLabel: 'Tools loading',
    },
  };
}

function promptLooksLikeFileOrDocumentWrite(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const hasWriteIntent = /\b(create|make|write|save|export|generate|produce|build|prepare|draft)\b/.test(text);
  if (!hasWriteIntent) return false;
  return /\b(file|document|docx|word doc|word document|rtf|pdf|csv|spreadsheet|markdown|md file|text file|txt|report|briefing|deliverable)\b/.test(text);
}

function promptLooksLikeWorkspaceFileInspection(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const hasInspectionIntent = /\b(list|show|display|view|read|open|inspect|find|search|scan|enumerate|grep|ls|dir|tree)\b/.test(text)
    || /\bwhat(?:'s| is| are)?\s+(?:in|inside)\b/.test(text)
    || /\bcontents?\s+of\b/.test(text);
  if (!hasInspectionIntent) return false;
  return /\b(file|files|folder|folders|directory|directories|dir|workspace|working directory|root|repo|repository|project tree|tree|path|paths)\b/.test(text);
}

function promptLooksLikeShellOrWorkspaceCommand(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return /\b(run|execute|use|call)\b.{0,80}\b(command|terminal|shell|powershell|cmd|bash|script)\b/.test(text)
    || /\b(pnpm|npm|node|python|git)\b.{0,80}\b(run|install|test|build|status|log|diff|list|show)\b/.test(text)
    || /\b(ls|dir|tree)\b.{0,80}\b(workspace|working directory|root|folder|directory|files?)\b/.test(text);
}

function promptLooksLikeBuildRuntimeValidation(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return /\b(smoke[\s-]?test|browser[\s-]?based|ui\s+test|runtime preview|preview page|page snapshot|full[-\s]?page screenshot|screenshot|screen shot|inspect page|test buttons?|click buttons?|start runtime|restart runtime|runtime logs?|runtime status|dev server|preview url|localhost|health check)\b/.test(text)
    || /\b(run|perform|do|complete)\b.{0,80}\b(smoke[\s-]?test|ui validation|browser validation|runtime validation)\b/.test(text)
    || /\b(capture|take|get)\b.{0,80}\b(full page|preview|screenshot|screen shot)\b/.test(text);
}

export function inferDeferredToolsetIdsForPrompt(prompt: string): ToolsetId[] {
  const inferred: ToolsetId[] = [];
  if (
    promptLooksLikeFileOrDocumentWrite(prompt)
    || promptLooksLikeWorkspaceFileInspection(prompt)
    || promptLooksLikeShellOrWorkspaceCommand(prompt)
  ) {
    inferred.push('coding');
  }
  if (promptLooksLikeBuildRuntimeValidation(prompt)) {
    inferred.push('build_runtime');
  }
  return uniqueToolsetIds(inferred);
}

export function markToolDiscoveryConfigLoaded(params: {
  agentId?: string;
  taskId?: string;
  deferredToolDiscoveryEnabled?: boolean;
  requestedToolsetIds?: unknown;
  initialToolsetIds?: unknown;
}): ToolDiscoveryRuntimeMetadata {
  const runtime = resolveToolDiscoveryRuntimeMetadata(params);
  if (runtime.mode !== 'deferred' || !runtime.mcpConfigRegeneration.required) {
    return runtime;
  }
  const nextRuntime = buildRuntimeMetadata({
    mode: runtime.mode,
    agentId: runtime.agentId,
    taskId: runtime.taskId,
    availableToolsetIds: runtime.availableToolsetIds,
    initialToolsetIds: runtime.initialToolsetIds,
    enabledToolsetIds: runtime.enabledToolsetIds,
    unknownRequestedToolsetIds: runtime.unknownRequestedToolsetIds,
    mcpConfigRegeneration: buildEmptyMcpRegenerationContract(),
  });
  persistRuntimeMetadata(nextRuntime);
  return nextRuntime;
}

function buildRuntimeMetadata(params: {
  mode: ToolDiscoveryRuntimeMetadata['mode'];
  agentId?: string;
  taskId?: string;
  availableToolsetIds: readonly ToolsetId[];
  initialToolsetIds: readonly ToolsetId[];
  enabledToolsetIds: readonly ToolsetId[];
  unknownRequestedToolsetIds?: readonly string[];
  mcpConfigRegeneration?: ToolDiscoveryMcpConfigRegenerationContract;
}): ToolDiscoveryRuntimeMetadata {
  const availableToolsetIds = uniqueToolsetIds(params.availableToolsetIds);
  const initialToolsetIds = uniqueToolsetIds(params.initialToolsetIds);
  const enabledToolsetIds = uniqueToolsetIds(
    params.enabledToolsetIds.filter((id) => availableToolsetIds.includes(id))
  );
  const deferredToolsetIds = availableToolsetIds.filter((id) => !enabledToolsetIds.includes(id));
  const resolution = resolveToolsets(enabledToolsetIds);

  return {
    mode: params.mode,
    agentId: params.agentId,
    taskId: params.taskId,
    availableToolsetIds,
    initialToolsetIds,
    enabledToolsetIds,
    deferredToolsetIds,
    unknownRequestedToolsetIds: uniqueStrings(params.unknownRequestedToolsetIds ?? []),
    discoveryToolNames: [...TOOL_DISCOVERY_TOOL_NAMES] as ToolDiscoveryToolName[],
    capabilities: resolution.tools,
    toolNames: toolNamesForResolution(resolution),
    promptSummary: resolution.promptSummary,
    mcpConfigRegeneration: params.mcpConfigRegeneration ?? buildEmptyMcpRegenerationContract(),
  };
}

function persistRuntimeMetadata(runtime: ToolDiscoveryRuntimeMetadata): void {
  const key = discoveryScopeKey(runtime);
  if (key) {
    TASK_SCOPED_DISCOVERY_STATE.set(key, runtime);
  }
}

async function emitToolDiscoveryAudit(event: ToolDiscoveryAuditEvent): Promise<void> {
  if (!toolDiscoveryAuditHook) return;
  await toolDiscoveryAuditHook(event);
}

export function isKnownToolsetId(value: unknown): value is ToolsetId {
  return typeof value === 'string' && KNOWN_TOOLSET_IDS.has(value);
}

export function normalizeToolsetIds(value: unknown, fallback: readonly ToolsetId[] = []): ToolsetId[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<ToolsetId>();
  const ids: ToolsetId[] = [];
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (!isKnownToolsetId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function sanitizeToolsetIds(value: unknown, field = 'toolsetIds'): ToolsetId[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  const seen = new Set<ToolsetId>();
  const ids: ToolsetId[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`${field}[${index}] must be a string`);
    }
    const id = entry.trim();
    if (!isKnownToolsetId(id)) {
      throw new Error(`${field}[${index}] must be a known toolset id`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
}

export function getDefaultToolsetIdsForOllamaToolMode(value: unknown): ToolsetId[] {
  const toolMode = normalizeOllamaToolModeForToolsets(value);
  switch (toolMode) {
    case 'internet':
      return ['local_model_light', 'research'];
    case 'workspace-read':
      return ['local_model_extended', 'research'];
    case 'workspace-edit':
      return ['local_model_extended', 'coding'];
    case 'desktop':
      return ['local_model_extended', 'desktop_full'];
    case 'full':
      return ['local_model_extended', 'desktop_full', 'custom'];
    case 'off':
    default:
      return [...DEFAULT_LOCAL_MODEL_TOOLSET_IDS];
  }
}

export function filterToolsetIdsForOllamaToolMode(toolsetIds: readonly ToolsetId[], value: unknown): ToolsetId[] {
  const toolMode = normalizeOllamaToolModeForToolsets(value);
  const ids = uniqueToolsetIds([...toolsetIds]);
  if (toolMode === 'full' || toolMode === 'desktop') {
    return ids;
  }
  const allowed = new Set<ToolsetId>(
    toolMode === 'workspace-edit'
      ? ['chat_safe', 'research', 'coding', 'local_model_light', 'local_model_extended']
      : toolMode === 'workspace-read'
        ? ['chat_safe', 'research', 'local_model_light', 'local_model_extended']
        : toolMode === 'internet'
          ? ['chat_safe', 'research', 'local_model_light', 'local_model_extended']
          : ['chat_safe', 'local_model_light']
  );
  return ids.filter((id) => allowed.has(id));
}

export function getDefaultAgentToolsetIds(): ToolsetId[] {
  return [...DEFAULT_AGENT_TOOLSET_IDS];
}

export function getDefaultBuildPresetToolsetIds(): ToolsetId[] {
  return [...DEFAULT_BUILD_PRESET_TOOLSET_IDS];
}

export function getDefaultLocalModelToolsetIds(extended = false): ToolsetId[] {
  return extended ? [...DEFAULT_LOCAL_MODEL_EXTENDED_TOOLSET_IDS] : [...DEFAULT_LOCAL_MODEL_TOOLSET_IDS];
}

export function resolveRuntimeToolsetIds(params: {
  agentToolsetIds?: unknown;
  localModel?: boolean;
  ollamaToolMode?: unknown;
  ollamaToolsetIds?: unknown;
  buildRuntimeToolsEnabled?: boolean;
} = {}): ToolsetId[] {
  const base = params.localModel
    ? normalizeToolsetIds(
        params.ollamaToolsetIds,
        getDefaultToolsetIdsForOllamaToolMode(params.ollamaToolMode)
      )
    : normalizeToolsetIds(params.agentToolsetIds, DEFAULT_AGENT_TOOLSET_IDS);

  const seen = new Set<ToolsetId>();
  const ids: ToolsetId[] = [];
  for (const id of base) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (params.buildRuntimeToolsEnabled && !seen.has('build_runtime')) {
    ids.push('build_runtime');
  }
  return ids;
}

export function listAvailableToolsets(): ToolsetListResult {
  return {
    toolsets: DEFAULT_FORMAL_TOOLSETS.map(cloneToolset),
  };
}

export function listAvailableTools(toolsetIds?: unknown): ToolCapabilityListResult {
  if (toolsetIds !== undefined) {
    return { tools: resolveToolsets(toolsetIds).tools };
  }
  return {
    tools: DEFAULT_FORMAL_TOOL_CAPABILITIES.map(cloneCapability),
  };
}

export function describeToolset(id: unknown): ResolvedToolsetDefinition | null {
  const normalized = typeof id === 'string' ? id.trim() : '';
  if (!isKnownToolsetId(normalized)) return null;
  const toolset = TOOLSET_BY_ID.get(normalized);
  return toolset ? resolveToolset(toolset) : null;
}

export function describeTool(name: unknown): ToolCapability | null {
  const normalized = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!normalized) return null;
  const capability = CAPABILITY_BY_NAME.get(normalized)
    ?? DEFAULT_FORMAL_TOOL_CAPABILITIES.find((entry) => (
      (entry.toolNames ?? []).some((toolName) => toolNameMatches(toolName, normalized))
    ));
  return capability ? cloneCapability(capability) : null;
}

export function describeDiscoveryCommand(name: unknown): ToolDiscoveryCommandDefinition | null {
  const normalized = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!normalized) return null;
  const command = DISCOVERY_TOOL_BY_NAME.get(normalized as ToolDiscoveryToolName);
  return command ? cloneDiscoveryTool(command) : null;
}

function matchingToolsetsForCapabilityOrToolName(name: string): ResolvedToolsetDefinition[] {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return [];
  const capability = describeTool(normalized);
  const capabilityName = capability?.name ?? normalized;
  return DEFAULT_FORMAL_TOOLSETS
    .filter((toolset) => (
      toolset.capabilityNames.includes(capabilityName)
      || (toolset.defaultToolNames ?? []).some((toolName) => toolNameMatches(toolName, normalized))
    ))
    .map(resolveToolset);
}

export function describeToolDiscoveryTarget(rawName: unknown): ToolDiscoveryDescribeResult {
  const query = String(rawName ?? '').trim();
  const normalized = query.toLowerCase();
  const toolset = describeToolset(query);
  if (toolset) {
    return {
      query,
      kind: 'toolset',
      found: true,
      toolset,
      matchingToolsets: [toolset],
    };
  }

  const tool = describeTool(query);
  if (tool) {
    return {
      query,
      kind: 'capability',
      found: true,
      tool,
      matchingToolsets: matchingToolsetsForCapabilityOrToolName(tool.name),
    };
  }

  const discoveryTool = describeDiscoveryCommand(normalized);
  if (discoveryTool) {
    return {
      query,
      kind: 'discovery_tool',
      found: true,
      discoveryTool,
      matchingToolsets: [],
    };
  }

  return {
    query,
    kind: 'missing',
    found: false,
    matchingToolsets: [],
    missing: query || 'No tool name provided',
  };
}

export function searchToolsetsAndTools(rawQuery: unknown): ToolDiscoverySearchResult {
  const query = normalizeSearchText(rawQuery);
  const toolsets = DEFAULT_FORMAL_TOOLSETS
    .filter((toolset) => {
      const capabilityParts = toolset.capabilityNames.flatMap((name) => {
        const capability = CAPABILITY_BY_NAME.get(name);
        return capability
          ? [
              capability.name,
              capability.displayName,
              capability.description,
              capability.category,
              capability.risk,
              ...(capability.toolNames ?? []),
            ]
          : [name];
      });
      return matchesQuery(query, [
        toolset.id,
        toolset.name,
        toolset.description,
        toolset.recommendedFor,
        ...toolset.capabilityNames,
        ...capabilityParts,
        ...(toolset.defaultToolNames ?? []),
      ]);
    })
    .map(resolveToolset);
  const tools = DEFAULT_FORMAL_TOOL_CAPABILITIES
    .filter((tool) => matchesQuery(query, [
      tool.name,
      tool.displayName,
      tool.description,
      tool.category,
      tool.risk,
      ...(tool.toolNames ?? []),
    ]))
    .map(cloneCapability);
  const discoveryTools = DEFAULT_TOOL_DISCOVERY_COMMANDS
    .filter((tool) => matchesQuery(query, [
      tool.name,
      tool.displayName,
      tool.description,
      tool.inputSchema,
      tool.risk,
    ]))
    .map(cloneDiscoveryTool);
  return { query, toolsets, tools, discoveryTools };
}

export function resolveToolsets(toolsetIds: unknown, fallback: readonly ToolsetId[] = []): ToolsetResolution {
  const requestedIds = Array.isArray(toolsetIds)
    ? toolsetIds.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];
  const ids = normalizeToolsetIds(toolsetIds, fallback);
  const unknownIds = requestedIds.filter((id) => !isKnownToolsetId(id));
  const toolsets = ids
    .map((id) => TOOLSET_BY_ID.get(id))
    .filter((entry): entry is FormalToolsetDefinition => Boolean(entry))
    .map(resolveToolset);
  const tools = uniqueCapabilities(toolsets);
  return {
    requestedIds,
    resolvedIds: ids,
    unknownIds,
    toolsets,
    tools,
    promptSummary: buildToolsetPromptSummary(toolsets, tools, unknownIds),
  };
}

export function resetTaskScopedToolDiscovery(params: { taskId?: string; agentId?: string } = {}): void {
  const key = discoveryScopeKey(params);
  if (key) {
    TASK_SCOPED_DISCOVERY_STATE.delete(key);
  }
}

export function resetAllTaskScopedToolDiscovery(): void {
  TASK_SCOPED_DISCOVERY_STATE.clear();
}

export function resolveToolDiscoveryRuntimeMetadata(params: {
  agentId?: string;
  taskId?: string;
  deferredToolDiscoveryEnabled?: boolean;
  requestedToolsetIds?: unknown;
  initialToolsetIds?: unknown;
  unknownRequestedToolsetIds?: readonly string[];
} = {}): ToolDiscoveryRuntimeMetadata {
  const mode: ToolDiscoveryRuntimeMetadata['mode'] = params.deferredToolDiscoveryEnabled ? 'deferred' : 'full';
  const requestedResolution = resolveToolsets(params.requestedToolsetIds, DEFAULT_AGENT_TOOLSET_IDS);
  const initialToolsetIds = mode === 'deferred'
    ? normalizeToolsetIds(params.initialToolsetIds, DEFAULT_DEFERRED_INITIAL_TOOLSET_IDS)
    : requestedResolution.resolvedIds;
  const availableToolsetIds = mode === 'deferred'
    ? mergeAvailableToolsetIds(initialToolsetIds, [...FORMAL_TOOLSET_IDS] as ToolsetId[])
    : requestedResolution.resolvedIds;
  const key = discoveryScopeKey(params);
  const existing = key ? TASK_SCOPED_DISCOVERY_STATE.get(key) : undefined;
  const existingEnabled = existing && existing.mode === mode
    ? existing.enabledToolsetIds.filter((id) => availableToolsetIds.includes(id))
    : [];
  const existingMcpConfigRegeneration = existing && existing.mode === mode
    ? existing.mcpConfigRegeneration
    : undefined;
  const enabledToolsetIds = mode === 'deferred'
    ? uniqueToolsetIds([...initialToolsetIds, ...existingEnabled])
    : availableToolsetIds;
  const runtime = buildRuntimeMetadata({
    mode,
    agentId: params.agentId,
    taskId: params.taskId,
    availableToolsetIds,
    initialToolsetIds,
    enabledToolsetIds,
    unknownRequestedToolsetIds: [
      ...requestedResolution.unknownIds,
      ...(params.unknownRequestedToolsetIds ?? []),
    ],
    mcpConfigRegeneration: existingMcpConfigRegeneration,
  });
  persistRuntimeMetadata(runtime);
  return runtime;
}

export function listEnabledTaskTools(params: {
  agentId?: string;
  taskId?: string;
  deferredToolDiscoveryEnabled?: boolean;
  requestedToolsetIds?: unknown;
  initialToolsetIds?: unknown;
} = {}): ToolDiscoveryEnabledListResult {
  const runtime = resolveToolDiscoveryRuntimeMetadata(params);
  const resolution = resolveToolsets(runtime.enabledToolsetIds);
  return {
    runtime,
    toolsets: resolution.toolsets,
    tools: resolution.tools,
    discoveryTools: DEFAULT_TOOL_DISCOVERY_COMMANDS.map(cloneDiscoveryTool),
  };
}

function findToolsetIdsForCapability(capabilityName: string): ToolsetId[] {
  const normalized = capabilityName.trim().toLowerCase();
  if (!normalized) return [];
  const preferred = PREFERRED_TOOLSET_BY_CAPABILITY.get(normalized);
  if (preferred) {
    return [preferred];
  }
  return DEFAULT_FORMAL_TOOLSETS
    .filter((toolset) => toolset.capabilityNames.includes(normalized))
    .map((toolset) => toolset.id);
}

function findToolsetIdsForToolName(toolName: string): ToolsetId[] {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) return [];
  const directMatches = DEFAULT_FORMAL_TOOLSETS
    .filter((toolset) => (toolset.defaultToolNames ?? []).some((name) => toolNameMatches(name, normalized)))
    .map((toolset) => toolset.id);
  if (directMatches.length > 0) {
    return directMatches;
  }
  return DEFAULT_FORMAL_TOOLSETS
    .filter((toolset) => toolset.capabilityNames.some((capabilityName) => {
      const capability = CAPABILITY_BY_NAME.get(capabilityName);
      return (capability?.toolNames ?? []).some((name) => toolNameMatches(name, normalized));
    }))
    .map((toolset) => toolset.id);
}

function buildEnableStatus(params: {
  newlyEnabledToolsetIds: readonly ToolsetId[];
  alreadyEnabledToolsetIds: readonly ToolsetId[];
  missingToolsetIds: readonly string[];
  missingCapabilities: readonly string[];
  missingToolNames: readonly string[];
  unavailableToolsetIds: readonly ToolsetId[];
}): ToolDiscoveryEnableStatus {
  if (params.newlyEnabledToolsetIds.length > 0) {
    if (
      params.missingToolsetIds.length > 0
      || params.missingCapabilities.length > 0
      || params.missingToolNames.length > 0
      || params.unavailableToolsetIds.length > 0
    ) {
      return 'partial';
    }
    return 'enabled';
  }
  if (params.alreadyEnabledToolsetIds.length > 0) {
    return 'already_enabled';
  }
  if (params.unavailableToolsetIds.length > 0) {
    return 'unavailable';
  }
  return 'not_found';
}

function buildEnableMessage(result: Pick<
  ToolDiscoveryEnableResult,
  'status' | 'newlyEnabledToolsetIds' | 'alreadyEnabledToolsetIds' | 'missingToolsetIds' | 'missingCapabilities' | 'missingToolNames' | 'unavailableToolsetIds'
>): string {
  if (result.status === 'enabled') {
    return `Enabled toolsets: ${result.newlyEnabledToolsetIds.join(', ')}`;
  }
  if (result.status === 'already_enabled') {
    return `Toolsets already enabled: ${result.alreadyEnabledToolsetIds.join(', ')}`;
  }
  if (result.status === 'partial') {
    return [
      result.newlyEnabledToolsetIds.length ? `Enabled: ${result.newlyEnabledToolsetIds.join(', ')}` : '',
      result.missingToolsetIds.length ? `Missing toolsets: ${result.missingToolsetIds.join(', ')}` : '',
      result.missingCapabilities.length ? `Missing capabilities: ${result.missingCapabilities.join(', ')}` : '',
      result.missingToolNames.length ? `Missing tools: ${result.missingToolNames.join(', ')}` : '',
      result.unavailableToolsetIds.length ? `Unavailable in this task: ${result.unavailableToolsetIds.join(', ')}` : '',
    ].filter(Boolean).join('. ');
  }
  if (result.status === 'unavailable') {
    return `Requested toolsets are not available in this task: ${result.unavailableToolsetIds.join(', ')}`;
  }
  return 'No matching toolsets, capabilities, or tools were found.';
}

export async function enableTaskScopedTools(params: {
  request: ToolDiscoveryEnableRequest;
  agentId?: string;
  taskId?: string;
  deferredToolDiscoveryEnabled?: boolean;
  requestedToolsetIds?: unknown;
  initialToolsetIds?: unknown;
  configWillBeRegeneratedImmediately?: boolean;
  now?: () => string;
}): Promise<ToolDiscoveryEnableResult> {
  const requested = {
    toolsetIds: normalizeStringArray(params.request.toolsetIds),
    capabilityNames: normalizeStringArray(params.request.capabilityNames),
    toolNames: normalizeStringArray(params.request.toolNames),
  };
  const runtime = resolveToolDiscoveryRuntimeMetadata({
    agentId: params.request.agentId ?? params.agentId,
    taskId: params.request.taskId ?? params.taskId,
    deferredToolDiscoveryEnabled: params.deferredToolDiscoveryEnabled,
    requestedToolsetIds: params.requestedToolsetIds,
    initialToolsetIds: params.initialToolsetIds,
  });

  const candidateIds: ToolsetId[] = [];
  const missingToolsetIds: string[] = [];
  const missingCapabilities: string[] = [];
  const missingToolNames: string[] = [];

  for (const id of requested.toolsetIds) {
    if (isKnownToolsetId(id)) {
      candidateIds.push(id);
    } else {
      missingToolsetIds.push(id);
    }
  }

  for (const capabilityName of requested.capabilityNames) {
    const matches = findToolsetIdsForCapability(capabilityName);
    if (matches.length === 0) {
      missingCapabilities.push(capabilityName);
    } else {
      candidateIds.push(...matches);
    }
  }

  for (const toolName of requested.toolNames) {
    const matches = findToolsetIdsForToolName(toolName);
    if (matches.length === 0) {
      missingToolNames.push(toolName);
    } else {
      candidateIds.push(...matches);
    }
  }

  const uniqueCandidates = uniqueToolsetIds(candidateIds);
  const unavailableToolsetIds = uniqueCandidates.filter((id) => !runtime.availableToolsetIds.includes(id));
  const enableableToolsetIds = uniqueCandidates.filter((id) => runtime.availableToolsetIds.includes(id));
  const alreadyEnabledToolsetIds = enableableToolsetIds.filter((id) => runtime.enabledToolsetIds.includes(id));
  const newlyEnabledToolsetIds = enableableToolsetIds.filter((id) => !runtime.enabledToolsetIds.includes(id));
  const nextEnabledToolsetIds = uniqueToolsetIds([...runtime.enabledToolsetIds, ...newlyEnabledToolsetIds]);
  const mcpConfigRegeneration = params.configWillBeRegeneratedImmediately
    ? buildEmptyMcpRegenerationContract()
    : buildMcpRegenerationContract(newlyEnabledToolsetIds);
  const nextRuntime = buildRuntimeMetadata({
    mode: runtime.mode,
    agentId: runtime.agentId,
    taskId: runtime.taskId,
    availableToolsetIds: runtime.availableToolsetIds,
    initialToolsetIds: runtime.initialToolsetIds,
    enabledToolsetIds: nextEnabledToolsetIds,
    unknownRequestedToolsetIds: runtime.unknownRequestedToolsetIds,
    mcpConfigRegeneration,
  });
  persistRuntimeMetadata(nextRuntime);

  const status = buildEnableStatus({
    newlyEnabledToolsetIds,
    alreadyEnabledToolsetIds,
    missingToolsetIds,
    missingCapabilities,
    missingToolNames,
    unavailableToolsetIds,
  });
  const result: ToolDiscoveryEnableResult = {
    ok: status === 'enabled' || status === 'already_enabled' || status === 'partial',
    status,
    requested,
    enabledToolsetIds: nextRuntime.enabledToolsetIds,
    newlyEnabledToolsetIds,
    alreadyEnabledToolsetIds,
    missingToolsetIds,
    missingCapabilities,
    missingToolNames,
    unavailableToolsetIds,
    runtime: nextRuntime,
    mcpConfigRegeneration,
    notification: mcpConfigRegeneration.notification,
    message: '',
  };
  result.message = buildEnableMessage(result);

  await emitToolDiscoveryAudit({
    action: 'tools.enable',
    status,
    timestamp: params.now ? params.now() : new Date().toISOString(),
    agentId: nextRuntime.agentId,
    taskId: nextRuntime.taskId,
    reason: params.request.reason,
    requested,
    enabledToolsetIds: result.enabledToolsetIds,
    newlyEnabledToolsetIds,
    alreadyEnabledToolsetIds,
    missingToolsetIds,
    missingCapabilities,
    missingToolNames,
    unavailableToolsetIds,
    mcpConfigRegeneration,
  });

  return result;
}

export async function preEnableDeferredToolsetsForPrompt(params: {
  prompt: string;
  agentId?: string;
  taskId?: string;
  deferredToolDiscoveryEnabled?: boolean;
  requestedToolsetIds?: unknown;
  initialToolsetIds?: unknown;
  now?: () => string;
}): Promise<ToolDiscoveryRuntimeMetadata> {
  const runtime = resolveToolDiscoveryRuntimeMetadata({
    agentId: params.agentId,
    taskId: params.taskId,
    deferredToolDiscoveryEnabled: params.deferredToolDiscoveryEnabled,
    requestedToolsetIds: params.requestedToolsetIds,
    initialToolsetIds: params.initialToolsetIds,
  });
  if (runtime.mode !== 'deferred') {
    return runtime;
  }

  const inferredToolsetIds = inferDeferredToolsetIdsForPrompt(params.prompt)
    .filter((id) => runtime.availableToolsetIds.includes(id))
    .filter((id) => !runtime.enabledToolsetIds.includes(id));
  if (inferredToolsetIds.length === 0) {
    return runtime;
  }

  const result = await enableTaskScopedTools({
    agentId: params.agentId,
    taskId: params.taskId,
    deferredToolDiscoveryEnabled: params.deferredToolDiscoveryEnabled,
    requestedToolsetIds: params.requestedToolsetIds,
    initialToolsetIds: params.initialToolsetIds,
    configWillBeRegeneratedImmediately: true,
    now: params.now,
    request: {
      toolsetIds: inferredToolsetIds,
      reason: 'Pre-enabled before the turn because the prompt appears to require workspace file tools or Build runtime validation tools.',
    },
  });
  return result.runtime;
}

export function buildDeferredToolDiscoveryPrompt(runtime: ToolDiscoveryRuntimeMetadata): string {
  if (runtime.mode !== 'deferred') return '';
  const lines = [
    '<deferred_tool_discovery>',
    'On-demand tool discovery is enabled for this task.',
    `Initially enabled toolsets: ${runtime.initialToolsetIds.join(', ') || 'none'}.`,
    `Currently enabled toolsets: ${runtime.enabledToolsetIds.join(', ') || 'none'}.`,
    `Available deferred toolsets: ${runtime.deferredToolsetIds.join(', ') || 'none'}.`,
    'Start with direct answers. Before using a capability outside the enabled list, enable the smallest relevant formal toolset for this task.',
    'If the user asks you to search, list, inventory, or describe your available tools/capabilities/toolsets, you MUST call tools_search or tools_enabled_list before answering. Do not answer that kind of request only from the visible prompt or remembered context.',
    'For reusable skill creation or management, search for "skill" first. Skill work is file-backed: use normal workspace file tools for skill files inside the active workspace. Request file permission only if the skill location is outside the active workspace. Tell the user if no dedicated one-click skill-management tool exists.',
    'For custom MCP availability, do not read the custom MCP registry JSON file directly. Call tools_search with "custom MCP" or tools_describe with "custom"; discovery returns a safe registered-server summary. Enabling custom MCP tools may require task resume before the actual tools are visible.',
    'Discovery commands available to the model as MCP tools:',
    '- tools_search: Search formal toolsets, capabilities, and discovery commands by keyword.',
    '- tools_describe: Describe a formal toolset, capability, concrete tool name, or discovery command.',
    '- tools_enable: Enable additional formal toolsets for the current task. Include a short reason.',
    '- tools_enabled_list: List the formal toolsets and capabilities currently enabled for the task.',
    '- tools_webfetch: Fetch a URL after the research toolset has been enabled. If it says research is not enabled, call tools_enable first.',
    'Conceptual discovery commands:',
  ];

  for (const command of DEFAULT_TOOL_DISCOVERY_COMMANDS) {
    lines.push(`- ${command.name}: ${command.description} Input: ${command.inputSchema}`);
  }

  lines.push(
    'tools.enable is task-scoped and auditable. Include a short reason whenever enabling tools.',
    'In on-demand tool discovery mode, do not call direct built-in tools such as webfetch/websearch/bash/edit unless the enabled list says the relevant toolset is active and the tool is visible. For web research in the same run, prefer tools_webfetch after enabling research.',
    'If tools.enable reports missingTools, missingCapabilities, or missingToolsets, tell the user exactly what is unavailable.',
    'If tools.enable returns a resume_task notification for MCP config regeneration, do not ask the user to click Resume task, do not quote the notification action label, and do not say user action is needed. Do not attempt those newly enabled tools in the same turn, and do not invent tool results. Briefly state that the required tools are loading automatically; the desktop app will continue after the regenerated tool inventory is loaded when possible.',
    '</deferred_tool_discovery>'
  );

  return lines.join('\n');
}

export function buildToolsetPromptSummary(
  toolsets: ResolvedToolsetDefinition[],
  tools: ToolCapability[],
  unknownIds: string[] = []
): string {
  const lines = [
    '<formal_toolsets>',
    'Formal toolset discovery (v1): these toolsets describe the intended capability surface for this run. They are prompt guidance and discovery metadata; existing runtime tools are not removed by this setting.',
  ];

  if (toolsets.length === 0) {
    lines.push('- No formal toolsets are selected. Use the existing runtime tools conservatively and prefer direct answers when possible.');
  } else {
    lines.push('Selected toolsets:');
    for (const toolset of toolsets) {
      lines.push(`- ${toolset.id}: ${toolset.name} - ${toolset.description}`);
    }
  }

  if (tools.length > 0) {
    lines.push('Resolved capabilities:');
    for (const capability of tools) {
      lines.push(`- ${capability.name}: ${capability.description}`);
    }
  }

  if (unknownIds.length > 0) {
    lines.push(`Unknown requested toolset ids ignored: ${unknownIds.join(', ')}`);
  }

  lines.push('</formal_toolsets>');
  return lines.join('\n');
}
