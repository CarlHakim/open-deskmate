export const FORMAL_TOOLSET_IDS = [
  'chat_safe',
  'research',
  'coding',
  'build_runtime',
  'messaging_safe',
  'desktop_full',
  'local_model_light',
  'local_model_extended',
  'custom',
] as const;

export type ToolsetId = typeof FORMAL_TOOLSET_IDS[number];

export type ToolCapabilityCategory =
  | 'conversation'
  | 'research'
  | 'workspace'
  | 'runtime'
  | 'messaging'
  | 'desktop'
  | 'custom';

export type ToolCapabilityRisk = 'low' | 'medium' | 'high';

export const TOOL_DISCOVERY_TOOL_NAMES = [
  'tools.search',
  'tools.describe',
  'tools.enable',
  'tools.enabled.list',
] as const;

export type ToolDiscoveryToolName = typeof TOOL_DISCOVERY_TOOL_NAMES[number];

export interface ToolDiscoveryCommandDefinition {
  name: ToolDiscoveryToolName;
  displayName: string;
  description: string;
  inputSchema: string;
  risk: ToolCapabilityRisk;
}

export const DEFAULT_TOOL_DISCOVERY_COMMANDS: ToolDiscoveryCommandDefinition[] = [
  {
    name: 'tools.search',
    displayName: 'Search tools',
    description: 'Search formal toolsets, capabilities, and discovery commands by keyword.',
    inputSchema: '{ "query": "web, files, browser, skills, mcp, ..." }',
    risk: 'low',
  },
  {
    name: 'tools.describe',
    displayName: 'Describe a tool',
    description: 'Describe a formal toolset, capability, concrete tool name, or discovery command.',
    inputSchema: '{ "name": "research | web_research | websearch | tools.enable" }',
    risk: 'low',
  },
  {
    name: 'tools.enable',
    displayName: 'Enable tools',
    description: 'Enable additional formal toolsets for the current task after intent requires them.',
    inputSchema: '{ "toolsetIds": ["research"], "capabilityNames": ["web_research"], "toolNames": ["websearch"], "reason": "Need current web sources." }',
    risk: 'medium',
  },
  {
    name: 'tools.enabled.list',
    displayName: 'List enabled tools',
    description: 'List the formal toolsets and capabilities currently enabled for the task.',
    inputSchema: '{}',
    risk: 'low',
  },
];

export type ToolsetRuntimeActivation = 'prompt_only' | 'built_in' | 'built_in_mcp' | 'external_mcp';

export interface ToolsetRuntimeMetadata {
  activation: ToolsetRuntimeActivation;
  mcpServerIds?: string[];
  requiresConfigRegenerationOnEnable?: boolean;
}

export interface ToolCapability {
  name: string;
  displayName: string;
  description: string;
  category: ToolCapabilityCategory;
  risk: ToolCapabilityRisk;
  toolNames?: string[];
}

export interface FormalToolsetDefinition {
  id: ToolsetId;
  name: string;
  description: string;
  capabilityNames: string[];
  recommendedFor: string;
  defaultToolNames?: string[];
  runtime?: ToolsetRuntimeMetadata;
}

export interface ResolvedToolsetDefinition extends FormalToolsetDefinition {
  capabilities: ToolCapability[];
}

export interface ToolsetListResult {
  toolsets: FormalToolsetDefinition[];
}

export interface ToolCapabilityListResult {
  tools: ToolCapability[];
}

export interface ToolDiscoveryCustomMcpServerSummary {
  id: string;
  type: 'local' | 'remote';
  enabled: boolean;
  transport: 'command' | 'url';
  commandName?: string;
  commandArgCount?: number;
  urlHost?: string;
  timeout?: number;
  hasEnvironment: boolean;
  environmentKeys?: string[];
}

export interface ToolDiscoveryCustomMcpRegistrySummary {
  registryPath: string;
  serverCount: number;
  enabledServerCount: number;
  servers: ToolDiscoveryCustomMcpServerSummary[];
  note: string;
}

export interface ToolDiscoverySearchResult {
  query: string;
  toolsets: ResolvedToolsetDefinition[];
  tools: ToolCapability[];
  discoveryTools?: ToolDiscoveryCommandDefinition[];
  customMcpRegistry?: ToolDiscoveryCustomMcpRegistrySummary;
}

export interface ToolsetResolution {
  requestedIds: string[];
  resolvedIds: ToolsetId[];
  unknownIds: string[];
  toolsets: ResolvedToolsetDefinition[];
  tools: ToolCapability[];
  promptSummary: string;
}

export type ToolDiscoveryMode = 'full' | 'deferred';

export interface ToolDiscoveryNotificationContract {
  level: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  action: 'none' | 'resume_task';
  actionLabel?: string;
}

export interface ToolDiscoveryMcpConfigRegenerationContract {
  required: boolean;
  resumable: boolean;
  reason?: string;
  toolsetIds: ToolsetId[];
  mcpServerIds: string[];
  notification?: ToolDiscoveryNotificationContract;
}

export interface ToolDiscoveryRuntimeMetadata {
  mode: ToolDiscoveryMode;
  agentId?: string;
  taskId?: string;
  availableToolsetIds: ToolsetId[];
  initialToolsetIds: ToolsetId[];
  enabledToolsetIds: ToolsetId[];
  deferredToolsetIds: ToolsetId[];
  unknownRequestedToolsetIds: string[];
  discoveryToolNames: ToolDiscoveryToolName[];
  capabilities: ToolCapability[];
  toolNames: string[];
  promptSummary: string;
  mcpConfigRegeneration: ToolDiscoveryMcpConfigRegenerationContract;
}

export type ToolDiscoveryDescribeKind = 'toolset' | 'capability' | 'discovery_tool' | 'missing';

export interface ToolDiscoveryDescribeResult {
  query: string;
  kind: ToolDiscoveryDescribeKind;
  found: boolean;
  toolset?: ResolvedToolsetDefinition;
  tool?: ToolCapability;
  discoveryTool?: ToolDiscoveryCommandDefinition;
  matchingToolsets: ResolvedToolsetDefinition[];
  missing?: string;
  customMcpRegistry?: ToolDiscoveryCustomMcpRegistrySummary;
}

export interface ToolDiscoveryEnableRequest {
  taskId?: string;
  agentId?: string;
  toolsetIds?: string[];
  capabilityNames?: string[];
  toolNames?: string[];
  reason?: string;
}

export type ToolDiscoveryEnableStatus =
  | 'enabled'
  | 'already_enabled'
  | 'partial'
  | 'not_found'
  | 'unavailable';

export interface ToolDiscoveryEnableResult {
  ok: boolean;
  status: ToolDiscoveryEnableStatus;
  requested: {
    toolsetIds: string[];
    capabilityNames: string[];
    toolNames: string[];
  };
  enabledToolsetIds: ToolsetId[];
  newlyEnabledToolsetIds: ToolsetId[];
  alreadyEnabledToolsetIds: ToolsetId[];
  missingToolsetIds: string[];
  missingCapabilities: string[];
  missingToolNames: string[];
  unavailableToolsetIds: ToolsetId[];
  runtime: ToolDiscoveryRuntimeMetadata;
  mcpConfigRegeneration: ToolDiscoveryMcpConfigRegenerationContract;
  notification?: ToolDiscoveryNotificationContract;
  message: string;
}

export interface ToolDiscoveryEnabledListResult {
  runtime: ToolDiscoveryRuntimeMetadata;
  toolsets: ResolvedToolsetDefinition[];
  tools: ToolCapability[];
  discoveryTools: ToolDiscoveryCommandDefinition[];
}

export interface ToolDiscoveryAuditEvent {
  action: 'tools.enable';
  status: ToolDiscoveryEnableStatus;
  timestamp: string;
  agentId?: string;
  taskId?: string;
  reason?: string;
  requested: ToolDiscoveryEnableResult['requested'];
  enabledToolsetIds: ToolsetId[];
  newlyEnabledToolsetIds: ToolsetId[];
  alreadyEnabledToolsetIds: ToolsetId[];
  missingToolsetIds: string[];
  missingCapabilities: string[];
  missingToolNames: string[];
  unavailableToolsetIds: ToolsetId[];
  mcpConfigRegeneration: ToolDiscoveryMcpConfigRegenerationContract;
}

export const DEFAULT_AGENT_TOOLSET_IDS: ToolsetId[] = ['desktop_full', 'custom'];
export const DEFAULT_BUILD_PRESET_TOOLSET_IDS: ToolsetId[] = ['build_runtime'];
export const DEFAULT_LOCAL_MODEL_TOOLSET_IDS: ToolsetId[] = ['local_model_light'];
export const DEFAULT_LOCAL_MODEL_EXTENDED_TOOLSET_IDS: ToolsetId[] = ['local_model_extended'];

export const DEFAULT_FORMAL_TOOL_CAPABILITIES: ToolCapability[] = [
  {
    name: 'chat_response',
    displayName: 'Chat response',
    description: 'Answer directly, reason from provided context, and avoid external side effects.',
    category: 'conversation',
    risk: 'low',
  },
  {
    name: 'ask_user',
    displayName: 'Ask user',
    description: 'Ask focused follow-up questions when required to proceed.',
    category: 'conversation',
    risk: 'low',
    toolNames: ['question'],
  },
  {
    name: 'web_research',
    displayName: 'Web research',
    description: 'Fetch URLs and search the web for current or source-backed information.',
    category: 'research',
    risk: 'medium',
    toolNames: ['webfetch', 'websearch'],
  },
  {
    name: 'image_url_context',
    displayName: 'Image URL context',
    description: 'Answer from user-provided image URLs through fetched page context or model vision support.',
    category: 'research',
    risk: 'medium',
    toolNames: ['webfetch'],
  },
  {
    name: 'attachment_context',
    displayName: 'Attachment context',
    description: 'Use attachment text and image context prepared by the Chat composer.',
    category: 'workspace',
    risk: 'medium',
    toolNames: ['read'],
  },
  {
    name: 'workspace_read',
    displayName: 'Workspace read',
    description: 'Read, list, and search files in the active workspace.',
    category: 'workspace',
    risk: 'medium',
    toolNames: ['read', 'list', 'grep', 'glob', 'todoread'],
  },
  {
    name: 'workspace_edit',
    displayName: 'Workspace edit',
    description: 'Create, patch, and update files in the active workspace.',
    category: 'workspace',
    risk: 'high',
    toolNames: ['edit', 'write', 'apply_patch', 'todowrite'],
  },
  {
    name: 'file_permission',
    displayName: 'File permission',
    description: 'Request explicit permission before file operations that change user data.',
    category: 'workspace',
    risk: 'medium',
    toolNames: ['file-permission_request_file_permission'],
  },
  {
    name: 'shell_command',
    displayName: 'Shell command',
    description: 'Run local command-line tools in the task workspace.',
    category: 'workspace',
    risk: 'high',
    toolNames: ['bash'],
  },
  {
    name: 'browser_automation',
    displayName: 'Browser automation',
    description: 'Drive a browser for navigation, page inspection, forms, and screenshots.',
    category: 'desktop',
    risk: 'medium',
    toolNames: ['dev-browser_*'],
  },
  {
    name: 'desktop_artifacts',
    displayName: 'Desktop artifacts',
    description: 'Use built-in desktop helpers for generated artifacts and local UI support.',
    category: 'desktop',
    risk: 'medium',
    toolNames: ['node-tools_*', 'canvas_*'],
  },
  {
    name: 'saved_prompt_context',
    displayName: 'Saved prompt context',
    description: 'Use saved prompts and prompt categories as prepared Chat context.',
    category: 'desktop',
    risk: 'low',
  },
  {
    name: 'user_skill_context',
    displayName: 'User skill context',
    description: 'Use selected managed, workspace, bundled, or shared user skills as prompt guidance.',
    category: 'desktop',
    risk: 'medium',
  },
  {
    name: 'skill_management',
    displayName: 'Skill management',
    description: 'Create, inspect, update, or organize reusable OpenDeskmate skills stored as SKILL.md files. Use normal workspace file tools for workspace-local skill files; request file permission only for skill locations outside the active workspace.',
    category: 'workspace',
    risk: 'high',
    toolNames: ['read', 'glob', 'grep', 'write', 'edit', 'file-permission_request_file_permission'],
  },
  {
    name: 'memory_context',
    displayName: 'Memory context',
    description: 'Use user, long-term, daily, and session memory context supplied to Chat.',
    category: 'desktop',
    risk: 'medium',
    toolNames: ['memory-tools_*'],
  },
  {
    name: 'usage_project_metadata',
    displayName: 'Usage project metadata',
    description: 'Use Chat project, usage budget, project work item, and cost metadata supplied by the desktop app.',
    category: 'desktop',
    risk: 'medium',
  },
  {
    name: 'runtime_status',
    displayName: 'Runtime status',
    description: 'Inspect Build mode runtime state, ports, health, and active commands.',
    category: 'runtime',
    risk: 'medium',
    toolNames: ['build-runtime-tools_get_runtime_status'],
  },
  {
    name: 'runtime_logs',
    displayName: 'Runtime logs',
    description: 'Read Build mode process logs and terminal snapshots.',
    category: 'runtime',
    risk: 'medium',
    toolNames: ['build-runtime-tools_get_runtime_logs', 'build-runtime-tools_get_terminal_snapshot'],
  },
  {
    name: 'runtime_preview',
    displayName: 'Runtime preview',
    description: 'Capture previews, page snapshots, and safe UI interaction smoke tests.',
    category: 'runtime',
    risk: 'medium',
    toolNames: [
      'build-runtime-tools_get_page_snapshot',
      'build-runtime-tools_capture_preview_screenshot',
      'build-runtime-tools_capture_full_page_preview',
      'build-runtime-tools_run_ui_interaction_test',
    ],
  },
  {
    name: 'runtime_quality',
    displayName: 'Runtime quality checks',
    description: 'Run Build mode lint, typecheck, test, build, and preview checks.',
    category: 'runtime',
    risk: 'high',
    toolNames: ['build-runtime-tools_run_quality_checks'],
  },
  {
    name: 'build_git',
    displayName: 'Build Git workflow',
    description: 'Inspect and operate Git state for Build mode workspaces.',
    category: 'runtime',
    risk: 'high',
    toolNames: ['build-runtime-tools_get_git_summary', 'build-runtime-tools_*git*'],
  },
  {
    name: 'messaging_review',
    displayName: 'Messaging review',
    description: 'Read or draft user-visible messages through configured messaging surfaces.',
    category: 'messaging',
    risk: 'medium',
  },
  {
    name: 'messaging_send_guarded',
    displayName: 'Guarded messaging send',
    description: 'Send messages only with explicit user intent and safe recipient handling.',
    category: 'messaging',
    risk: 'high',
  },
  {
    name: 'custom_mcp',
    displayName: 'Custom MCP tools',
    description: 'Use user-registered custom MCP servers and tools discovered at runtime.',
    category: 'custom',
    risk: 'high',
    toolNames: ['custom MCP registry'],
  },
];

export const DEFAULT_FORMAL_TOOLSETS: FormalToolsetDefinition[] = [
  {
    id: 'chat_safe',
    name: 'Chat safe',
    description: 'Direct conversation with no workspace, browser, shell, messaging, or custom-tool side effects.',
    capabilityNames: ['chat_response', 'ask_user'],
    recommendedFor: 'General chat, planning, explanation, and low-context local models.',
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Source-backed lookup and browser-assisted research without workspace edits.',
    capabilityNames: ['chat_response', 'ask_user', 'web_research', 'image_url_context', 'browser_automation'],
    recommendedFor: 'Current facts, source gathering, documentation lookup, and web investigation.',
    defaultToolNames: ['webfetch', 'websearch', 'dev-browser_*'],
    runtime: {
      activation: 'built_in',
    },
  },
  {
    id: 'coding',
    name: 'Coding',
    description: 'Workspace read/edit and local command support for code changes.',
    capabilityNames: ['chat_response', 'ask_user', 'attachment_context', 'workspace_read', 'workspace_edit', 'file_permission', 'shell_command', 'skill_management'],
    recommendedFor: 'Repository inspection, implementation, tests, and local development commands.',
    defaultToolNames: ['read', 'list', 'grep', 'glob', 'edit', 'write', 'apply_patch', 'bash'],
    runtime: {
      activation: 'built_in_mcp',
      mcpServerIds: ['file-permission'],
      requiresConfigRegenerationOnEnable: true,
    },
  },
  {
    id: 'build_runtime',
    name: 'Build runtime',
    description: 'Build mode runtime inspection, preview smoke tests, quality checks, and Git workflow support.',
    capabilityNames: ['runtime_status', 'runtime_logs', 'runtime_preview', 'runtime_quality', 'build_git'],
    recommendedFor: 'Build mode projects with dev servers, previews, logs, tests, and Git actions.',
    defaultToolNames: ['build-runtime-tools_*'],
    runtime: {
      activation: 'built_in_mcp',
      mcpServerIds: ['build-runtime-tools'],
      requiresConfigRegenerationOnEnable: true,
    },
  },
  {
    id: 'messaging_safe',
    name: 'Messaging safe',
    description: 'Messaging-oriented review and guarded send capability metadata.',
    capabilityNames: ['chat_response', 'ask_user', 'messaging_review', 'messaging_send_guarded'],
    recommendedFor: 'Drafting or sending user-visible messages with explicit recipient and send intent.',
  },
  {
    id: 'desktop_full',
    name: 'Desktop full',
    description: 'The existing full OpenDeskmate desktop stack: chat, research, workspace, browser, shell, and built-in desktop helpers.',
    capabilityNames: [
      'chat_response',
      'ask_user',
      'web_research',
      'image_url_context',
      'attachment_context',
      'workspace_read',
      'workspace_edit',
      'file_permission',
      'shell_command',
      'browser_automation',
      'desktop_artifacts',
      'saved_prompt_context',
      'user_skill_context',
      'skill_management',
      'memory_context',
      'usage_project_metadata',
    ],
    recommendedFor: 'Default cloud-model desktop automation where existing OpenDeskmate behavior should be preserved.',
    runtime: {
      activation: 'built_in_mcp',
      mcpServerIds: ['file-permission', 'node-tools', 'memory-tools', 'canvas'],
      requiresConfigRegenerationOnEnable: true,
    },
  },
  {
    id: 'local_model_light',
    name: 'Local model light',
    description: 'Small local-model profile with compact prompting and minimal tool expectations.',
    capabilityNames: ['chat_response', 'ask_user'],
    recommendedFor: 'Smaller Ollama models and chat-only local sessions.',
  },
  {
    id: 'local_model_extended',
    name: 'Local model extended',
    description: 'Larger local-model profile that can handle selected tool calls with compact guidance.',
    capabilityNames: ['chat_response', 'ask_user', 'web_research', 'workspace_read', 'workspace_edit'],
    recommendedFor: 'Larger Ollama models configured for internet, workspace read, or workspace edit modes.',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'User-defined or custom MCP tools discovered outside the built-in formal presets.',
    capabilityNames: ['custom_mcp'],
    recommendedFor: 'Advanced users with custom MCP registry entries or future dynamic tool discovery.',
    defaultToolNames: ['custom MCP registry'],
    runtime: {
      activation: 'external_mcp',
      requiresConfigRegenerationOnEnable: true,
    },
  },
];
