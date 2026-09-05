import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_TOOLSET_IDS,
  type ToolsetId,
  FORMAL_TOOLSET_IDS,
} from '@accomplish/shared';
import {
  buildDeferredToolDiscoveryPrompt,
  enableTaskScopedTools,
  filterToolsetIdsForOllamaToolMode,
  getDefaultToolsetIdsForOllamaToolMode,
  inferDeferredToolsetIdsForPrompt,
  listEnabledTaskTools,
  listAvailableTools,
  listAvailableToolsets,
  markToolDiscoveryConfigLoaded,
  mergeToolsetIds,
  preEnableDeferredToolsetsForPrompt,
  resetAllTaskScopedToolDiscovery,
  resolveRuntimeToolsetIds,
  resolveToolDiscoveryRuntimeMetadata,
  resolveToolsets,
  searchToolsetsAndTools,
  setToolDiscoveryAuditHook,
  describeToolDiscoveryTarget,
} from '@main/services/toolsets';

describe('toolset registry and resolver', () => {
  afterEach(() => {
    setToolDiscoveryAuditHook(undefined);
    resetAllTaskScopedToolDiscovery();
  });

  it('lists every formal default toolset id', () => {
    const result = listAvailableToolsets();

    expect(result.toolsets.map((toolset) => toolset.id)).toEqual(FORMAL_TOOLSET_IDS);
    expect(result.toolsets.find((toolset) => toolset.id === 'desktop_full')?.capabilityNames)
      .toContain('workspace_edit');
    expect(result.toolsets.find((toolset) => toolset.id === 'coding')?.runtime).toMatchObject({
      mcpServerIds: ['file-permission'],
      requiresConfigRegenerationOnEnable: true,
    });
  });

  it('resolves, de-duplicates, and reports unknown toolset ids', () => {
    const result = resolveToolsets(['coding', 'research', 'coding', 'missing']);

    expect(result.resolvedIds).toEqual(['coding', 'research']);
    expect(result.unknownIds).toEqual(['missing']);
    expect(result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'workspace_edit',
      'web_research',
    ]));
    expect(result.promptSummary).toContain('coding: Coding');
    expect(result.promptSummary).toContain('Unknown requested toolset ids ignored: missing');
  });

  it('maps legacy Ollama tool modes to formal local model defaults', () => {
    expect(getDefaultToolsetIdsForOllamaToolMode('off')).toEqual(['local_model_light']);
    expect(getDefaultToolsetIdsForOllamaToolMode('basic')).toEqual(['local_model_light', 'research']);
    expect(getDefaultToolsetIdsForOllamaToolMode('workspace-edit')).toEqual(['local_model_extended', 'coding']);
    expect(getDefaultToolsetIdsForOllamaToolMode('full')).toEqual(['local_model_extended', 'desktop_full', 'custom']);
  });

  it('merges inherited subagent toolsets without duplicates', () => {
    expect(mergeToolsetIds(
      ['chat_safe', 'research'],
      ['research', 'coding'],
      undefined,
      ['chat_safe', 'build_runtime']
    )).toEqual(['chat_safe', 'research', 'coding', 'build_runtime']);
  });

  it('filters inherited toolsets through local model capability limits', () => {
    const inherited: ToolsetId[] = ['chat_safe', 'research', 'coding', 'desktop_full', 'build_runtime', 'custom'];

    expect(filterToolsetIdsForOllamaToolMode(inherited, 'off')).toEqual(['chat_safe']);
    expect(filterToolsetIdsForOllamaToolMode(inherited, 'workspace-read')).toEqual(['chat_safe', 'research']);
    expect(filterToolsetIdsForOllamaToolMode(inherited, 'workspace-edit')).toEqual(['chat_safe', 'research', 'coding']);
    expect(filterToolsetIdsForOllamaToolMode(inherited, 'desktop')).toEqual(inherited);
  });

  it('preserves cloud defaults and adds build runtime when requested', () => {
    expect(resolveRuntimeToolsetIds()).toEqual(DEFAULT_AGENT_TOOLSET_IDS);
    expect(resolveRuntimeToolsetIds({ buildRuntimeToolsEnabled: true })).toEqual([
      ...DEFAULT_AGENT_TOOLSET_IDS,
      'build_runtime',
    ]);
  });

  it('filters available tools by selected toolsets and supports search', () => {
    expect(listAvailableTools(['chat_safe']).tools.map((tool) => tool.name)).toEqual([
      'chat_response',
      'ask_user',
    ]);

    const search = searchToolsetsAndTools('preview');
    expect(search.toolsets.map((toolset) => toolset.id)).toContain('build_runtime');
    expect(search.tools.map((tool) => tool.name)).toContain('runtime_preview');

    const skillSearch = searchToolsetsAndTools('reusable skills');
    expect(skillSearch.tools.map((tool) => tool.name)).toContain('skill_management');
    expect(skillSearch.toolsets.map((toolset) => toolset.id)).toEqual(expect.arrayContaining([
      'coding',
      'desktop_full',
    ]));

    const mixedCustomSkillSearch = searchToolsetsAndTools('skill create manage custom MCP');
    expect(mixedCustomSkillSearch.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'skill_management',
      'custom_mcp',
    ]));
    expect(mixedCustomSkillSearch.toolsets.map((toolset) => toolset.id)).toEqual(expect.arrayContaining([
      'coding',
      'custom',
    ]));

    const customServerSearch = searchToolsetsAndTools('node-tools canvas memory custom server');
    expect(customServerSearch.toolsets.map((toolset) => toolset.id)).toEqual(expect.arrayContaining([
      'desktop_full',
      'custom',
    ]));
  });

  it('preserves default Chat as full-tool runtime metadata', () => {
    const runtime = resolveToolDiscoveryRuntimeMetadata({
      agentId: 'main',
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
    });

    expect(runtime.mode).toBe('full');
    expect(runtime.initialToolsetIds).toEqual(DEFAULT_AGENT_TOOLSET_IDS);
    expect(runtime.enabledToolsetIds).toEqual(DEFAULT_AGENT_TOOLSET_IDS);
    expect(runtime.deferredToolsetIds).toEqual([]);
    expect(runtime.toolNames).toEqual(expect.arrayContaining(['webfetch', 'memory-tools_*']));
  });

  it('starts deferred discovery from a minimal enabled set and exposes discovery commands', () => {
    const runtime = resolveToolDiscoveryRuntimeMetadata({
      taskId: 'task-deferred',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
    });
    const enabled = listEnabledTaskTools({
      taskId: 'task-deferred',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
    });
    const prompt = buildDeferredToolDiscoveryPrompt(runtime);

    expect(runtime.mode).toBe('deferred');
    expect(runtime.initialToolsetIds).toEqual(['chat_safe']);
    expect(runtime.enabledToolsetIds).toEqual(['chat_safe']);
    expect(runtime.deferredToolsetIds).toEqual(FORMAL_TOOLSET_IDS.filter((id) => id !== 'chat_safe'));
    expect(enabled.discoveryTools.map((tool) => tool.name)).toEqual([
      'tools.search',
      'tools.describe',
      'tools.enable',
      'tools.enabled.list',
    ]);
    expect(prompt).toContain('tools_enable: Enable additional formal toolsets');
    expect(prompt).toContain('tools.enable is task-scoped and auditable');
    expect(prompt).toContain('If the user asks you to search, list, inventory, or describe your available tools/capabilities/toolsets, you MUST call tools_search or tools_enabled_list before answering.');
    expect(prompt).toContain('For reusable skill creation or management, search for "skill" first.');
    expect(prompt).toContain('For custom MCP availability, do not read the custom MCP registry JSON file directly.');
    expect(prompt).toContain('do not ask the user to click Resume task');
    expect(prompt).toContain('do not quote the notification action label');
    expect(prompt).not.toContain('Surface the notification');
  });

  it('describes concrete tool names and discovery commands', () => {
    expect(describeToolDiscoveryTarget('websearch')).toMatchObject({
      found: true,
      kind: 'capability',
      tool: { name: 'web_research' },
    });
    expect(describeToolDiscoveryTarget('tools.enable')).toMatchObject({
      found: true,
      kind: 'discovery_tool',
      discoveryTool: { name: 'tools.enable' },
    });
    expect(describeToolDiscoveryTarget('skill_management')).toMatchObject({
      found: true,
      kind: 'capability',
      tool: { name: 'skill_management' },
      matchingToolsets: expect.arrayContaining([
        expect.objectContaining({ id: 'coding' }),
      ]),
    });
  });

  it('enables deferred toolsets for the current task and reports missing tools', async () => {
    const research = await enableTaskScopedTools({
      taskId: 'task-enable-web',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
      request: {
        toolNames: ['webfetch'],
        reason: 'Need current web sources.',
      },
      now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(research.status).toBe('enabled');
    expect(research.newlyEnabledToolsetIds).toEqual(['research']);

    resetAllTaskScopedToolDiscovery();
    const explicitResearch = await enableTaskScopedTools({
      taskId: 'task-enable-web-explicit',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
      request: {
        toolsetIds: ['research'],
        capabilityNames: ['web_research'],
        reason: 'Need current web sources.',
      },
      now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(explicitResearch.status).toBe('enabled');
    expect(explicitResearch.newlyEnabledToolsetIds).toEqual(['research']);
    expect(explicitResearch.runtime.enabledToolsetIds).toEqual(['chat_safe', 'research']);

    const enabled = await enableTaskScopedTools({
      taskId: 'task-enable',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
      request: {
        toolsetIds: ['desktop_full'],
        reason: 'Need workspace and memory context.',
      },
      now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(enabled.status).toBe('enabled');
    expect(enabled.newlyEnabledToolsetIds).toEqual(['desktop_full']);
    expect(enabled.runtime.enabledToolsetIds).toEqual(['chat_safe', 'desktop_full']);

    const missing = await enableTaskScopedTools({
      taskId: 'task-enable',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
      request: {
        toolNames: ['not-a-real-tool'],
      },
    });

    expect(missing.status).toBe('not_found');
    expect(missing.missingToolNames).toEqual(['not-a-real-tool']);
    expect(missing.message).toContain('No matching toolsets');
  });

  it('enables the smallest file-backed toolset for reusable skill management', async () => {
    const result = await enableTaskScopedTools({
      taskId: 'task-enable-skills',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
      request: {
        capabilityNames: ['skill_management'],
        reason: 'Need to create or manage reusable skills.',
      },
      now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(result.status).toBe('enabled');
    expect(result.newlyEnabledToolsetIds).toEqual(['coding']);
    expect(result.runtime.enabledToolsetIds).toEqual(['chat_safe', 'coding']);
    expect(result.mcpConfigRegeneration).toMatchObject({
      required: true,
      resumable: true,
      toolsetIds: ['coding'],
      mcpServerIds: ['file-permission'],
    });
  });

  it('pre-enables workspace file turns before config generation', async () => {
    expect(inferDeferredToolsetIdsForPrompt('Create a Word document from the research and save it.'))
      .toEqual(['coding']);
    expect(inferDeferredToolsetIdsForPrompt('List files in the root working directory.'))
      .toEqual(['coding']);
    expect(inferDeferredToolsetIdsForPrompt('Show me what is inside the workspace folder.'))
      .toEqual(['coding']);
    expect(inferDeferredToolsetIdsForPrompt('Run git status in the repository.'))
      .toEqual(['coding']);
    expect(inferDeferredToolsetIdsForPrompt('Run a browser smoke test against the runtime preview.'))
      .toEqual(['build_runtime']);
    expect(inferDeferredToolsetIdsForPrompt('Create a Markdown test report and capture a full-page preview screenshot.'))
      .toEqual(['coding', 'build_runtime']);
    expect(inferDeferredToolsetIdsForPrompt('Summarize the latest research.'))
      .toEqual([]);

    const runtime = await preEnableDeferredToolsetsForPrompt({
      taskId: 'task-document-follow-up',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
      prompt: 'Create a document from the research and save it as a file.',
      now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(runtime.enabledToolsetIds).toEqual(['chat_safe', 'coding']);
    expect(runtime.mcpConfigRegeneration).toMatchObject({
      required: false,
      resumable: false,
      toolsetIds: [],
      mcpServerIds: [],
    });

    const loaded = markToolDiscoveryConfigLoaded({
      taskId: 'task-document-follow-up',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
    });

    expect(loaded.enabledToolsetIds).toEqual(['chat_safe', 'coding']);
    expect(loaded.mcpConfigRegeneration.required).toBe(false);

    const buildRuntimeIds = resolveRuntimeToolsetIds({ buildRuntimeToolsEnabled: true });
    const buildRuntime = await preEnableDeferredToolsetsForPrompt({
      taskId: 'task-build-smoke-test',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: buildRuntimeIds,
      prompt: 'Run a smoke test against the runtime preview and capture a full-page screenshot.',
      now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(buildRuntime.enabledToolsetIds).toEqual(['chat_safe', 'build_runtime']);
  });

  it('audits enablement through a hook and returns a resumable MCP regeneration notification', async () => {
    const auditEvents: unknown[] = [];
    setToolDiscoveryAuditHook((event) => {
      auditEvents.push(event);
    });

    const result = await enableTaskScopedTools({
      taskId: 'task-audit',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
      request: {
        toolsetIds: ['custom'],
        reason: 'Need a custom MCP registry tool.',
      },
      now: () => '2026-06-22T00:00:00.000Z',
    });

    expect(result.status).toBe('enabled');
    expect(result.mcpConfigRegeneration).toMatchObject({
      required: true,
      resumable: true,
      toolsetIds: ['custom'],
      notification: {
        action: 'resume_task',
        title: 'Additional tools enabled',
        actionLabel: 'Tools loading',
      },
    });
    const runtime = resolveToolDiscoveryRuntimeMetadata({
      taskId: 'task-audit',
      agentId: 'main',
      deferredToolDiscoveryEnabled: true,
      requestedToolsetIds: DEFAULT_AGENT_TOOLSET_IDS,
    });
    expect(runtime.mcpConfigRegeneration.required).toBe(true);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      action: 'tools.enable',
      status: 'enabled',
      taskId: 'task-audit',
      reason: 'Need a custom MCP registry tool.',
      newlyEnabledToolsetIds: ['custom'],
    });
  });
});
