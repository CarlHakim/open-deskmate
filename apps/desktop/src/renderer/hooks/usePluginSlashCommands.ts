'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PluginCommandContribution } from '@accomplish/shared';
import { getAccomplish } from '@/lib/accomplish';

export const PLUGIN_COMMANDS_CHANGED_EVENT = 'opendeskmate:plugins-changed';

export function notifyPluginCommandsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PLUGIN_COMMANDS_CHANGED_EVENT));
}

export function usePluginSlashCommands(): PluginCommandContribution[] {
  const [commands, setCommands] = useState<PluginCommandContribution[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await getAccomplish().listPluginCommands();
      setCommands(Array.isArray(result.commands) ? result.commands : []);
    } catch {
      setCommands([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const handleChanged = () => {
      void load();
    };
    window.addEventListener(PLUGIN_COMMANDS_CHANGED_EVENT, handleChanged as EventListener);
    return () => {
      window.removeEventListener(PLUGIN_COMMANDS_CHANGED_EVENT, handleChanged as EventListener);
    };
  }, [load]);

  return commands;
}
