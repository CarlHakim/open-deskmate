import type { RuntimeHookContext, RuntimeHookDefinition, RuntimeHookRunResult } from '@accomplish/shared';
import { loadRuntimeHooksRegistry } from './hook-registry';
import { recordHookDiagnostic } from './hook-diagnostics';
import { listRegisteredPluginHooks } from '../plugins/plugin-runtime';

function previewValue(value: unknown, maxLen = 1200): string | undefined {
  if (value === undefined) return undefined;
  try {
    const text = JSON.stringify(value);
    if (!text) return undefined;
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
  } catch {
    const text = String(value);
    return text ? text.slice(0, maxLen) : undefined;
  }
}

function matchesList(value: string | undefined, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized) && allowed.includes(normalized);
}

function matchesHook(hook: RuntimeHookDefinition, context: RuntimeHookContext): boolean {
  if (!hook.enabled) return false;
  if (hook.event !== context.event) return false;
  const match = hook.match;
  if (!match) return true;
  return (
    matchesList(context.agentId, match.agentIds)
    && matchesList(context.toolName, match.toolNames)
    && matchesList(context.source, match.sources)
  );
}

function joinSections(parts: string[]): string | undefined {
  const cleaned = parts.map((part) => String(part || '').trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join('\n\n') : undefined;
}

export async function runRuntimeHooks(context: RuntimeHookContext): Promise<RuntimeHookRunResult> {
  const registry = loadRuntimeHooksRegistry();
  const hooks: RuntimeHookDefinition[] = [
    ...registry.hooks,
    ...listRegisteredPluginHooks(),
  ];
  const matchedHookIds: string[] = [];
  const promptParts: string[] = [];
  const systemPromptParts: string[] = [];
  const notes: string[] = [];
  const inputPatch: Record<string, unknown> = {};

  for (const hook of hooks) {
    if (!matchesHook(hook, context)) continue;
    matchedHookIds.push(hook.id);

    if (hook.action === 'record_note' && hook.noteText) {
      notes.push(hook.noteText);
      continue;
    }

    if (hook.action === 'block') {
      const result: RuntimeHookRunResult = {
        ok: false,
        blockReason: hook.message || `Blocked by hook "${hook.id}"`,
        matchedHookIds,
        promptPrefix: joinSections(promptParts),
        systemPromptAppend: joinSections(systemPromptParts),
        inputPatch: Object.keys(inputPatch).length > 0 ? inputPatch : undefined,
        notes: notes.length > 0 ? notes : undefined,
      };
      recordHookDiagnostic({
        id: `hookdiag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        event: context.event,
        agentId: context.agentId,
        taskId: context.taskId,
        toolName: context.toolName,
        source: context.source,
        matchedHookIds,
        ok: false,
        blockReason: result.blockReason,
        notes: result.notes,
        inputPreview: previewValue(context.input),
        outputPreview: previewValue(context.output),
      });
      return result;
    }

    if (hook.action === 'prepend_prompt' && hook.promptText) {
      promptParts.push(hook.promptText);
      continue;
    }

    if (hook.action === 'append_system_prompt' && hook.systemPromptText) {
      systemPromptParts.push(hook.systemPromptText);
      continue;
    }

    if (hook.action === 'patch_input' && hook.inputPatch) {
      Object.assign(inputPatch, hook.inputPatch);
    }
  }

  const result: RuntimeHookRunResult = {
    ok: true,
    matchedHookIds,
    promptPrefix: joinSections(promptParts),
    systemPromptAppend: joinSections(systemPromptParts),
    inputPatch: Object.keys(inputPatch).length > 0 ? inputPatch : undefined,
    notes: notes.length > 0 ? notes : undefined,
  };
  if (matchedHookIds.length > 0) {
    recordHookDiagnostic({
      id: `hookdiag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      event: context.event,
      agentId: context.agentId,
      taskId: context.taskId,
      toolName: context.toolName,
      source: context.source,
      matchedHookIds,
      ok: true,
      notes: result.notes,
      inputPreview: previewValue(context.input),
      outputPreview: previewValue(context.output),
    });
  }
  return result;
}
