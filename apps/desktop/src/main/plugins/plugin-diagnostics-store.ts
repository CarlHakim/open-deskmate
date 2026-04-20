import { randomUUID } from 'crypto';
import Store from 'electron-store';
import type {
  PluginDiagnosticsEventReason,
  PluginDiagnosticsHistoryEntry,
  PluginDiagnosticsState,
} from '@accomplish/shared';
import { getPluginRegistrationDiagnostics } from './plugin-runtime';

interface PluginDiagnosticsStoreSchema {
  history: PluginDiagnosticsHistoryEntry[];
}

const MAX_HISTORY_ENTRIES = 250;

const store = new Store<PluginDiagnosticsStoreSchema>({
  name: 'plugin-diagnostics',
  defaults: {
    history: [],
  },
});

function createHistorySignature(entry: {
  pluginId: string;
  reason: PluginDiagnosticsEventReason;
  registrationState: string;
  ready: boolean;
  compatible: boolean;
  blockedReasons: string[];
  warnings: string[];
  issues: PluginDiagnosticsHistoryEntry['issues'];
}): string {
  return JSON.stringify({
    pluginId: entry.pluginId,
    reason: entry.reason,
    registrationState: entry.registrationState,
    ready: entry.ready,
    compatible: entry.compatible,
    blockedReasons: [...entry.blockedReasons].sort(),
    warnings: [...entry.warnings].sort(),
    issues: entry.issues
      .map((issue) => JSON.stringify(issue))
      .sort(),
  });
}

export function recordPluginRegistrationDiagnostics(reason: PluginDiagnosticsEventReason): PluginDiagnosticsState {
  const diagnostics = getPluginRegistrationDiagnostics();
  const existingHistory = store.get('history') ?? [];
  const nextHistory = [...existingHistory];

  for (const diagnostic of diagnostics) {
    const candidate: PluginDiagnosticsHistoryEntry = {
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
      reason,
      pluginId: diagnostic.pluginId,
      registrationState: diagnostic.registrationState,
      ready: diagnostic.ready,
      compatible: diagnostic.compatible,
      blockedReasons: [...diagnostic.blockedReasons],
      warnings: [...diagnostic.warnings],
      issues: [...diagnostic.issues],
    };
    let lastForPlugin: PluginDiagnosticsHistoryEntry | null = null;
    for (let index = 0; index < nextHistory.length; index += 1) {
      const entry = nextHistory[index];
      if (entry?.pluginId === diagnostic.pluginId) {
        lastForPlugin = entry;
        break;
      }
    }
    const lastSignature = lastForPlugin ? createHistorySignature(lastForPlugin) : null;
    const nextSignature = createHistorySignature(candidate);
    if (lastSignature === nextSignature) {
      continue;
    }
    nextHistory.unshift(candidate);
  }

  const trimmedHistory = nextHistory.slice(0, MAX_HISTORY_ENTRIES);
  store.set('history', trimmedHistory);
  return {
    diagnostics,
    history: trimmedHistory,
  };
}

export function getPluginDiagnosticsState(): PluginDiagnosticsState {
  return {
    diagnostics: getPluginRegistrationDiagnostics(),
    history: store.get('history') ?? [],
  };
}

export function clearPluginDiagnosticsHistory(): { ok: true } {
  store.set('history', []);
  return { ok: true };
}
