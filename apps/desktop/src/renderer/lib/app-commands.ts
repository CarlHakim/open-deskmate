import type { NavigateFunction } from 'react-router-dom';
import type { PluginAppCommandId, PluginCommandContribution, PluginCommandVisibility } from '@accomplish/shared';
import type { SlashCommandDefinition } from './slash-commands';

export const APP_COMMAND_EVENTS = {
  taskStop: 'opendeskmate:command:task-stop',
  taskSaveSkill: 'opendeskmate:command:task-save-skill',
  subagentsRefresh: 'opendeskmate:command:subagents-refresh',
  buildHistoryOpen: 'opendeskmate:command:build-history-open',
  buildHistoryNew: 'opendeskmate:command:build-history-new',
  buildRuntimeStart: 'opendeskmate:command:build-runtime-start',
  buildRuntimeStop: 'opendeskmate:command:build-runtime-stop',
  buildRuntimeRestart: 'opendeskmate:command:build-runtime-restart',
  buildRuntimeBuild: 'opendeskmate:command:build-runtime-build',
  buildRuntimeOpenPreview: 'opendeskmate:command:build-runtime-open-preview',
  promptPickerOpen: 'opendeskmate:command:prompt-picker-open',
  recipePickerOpen: 'opendeskmate:command:recipe-picker-open',
  backgroundPickerOpen: 'opendeskmate:command:background-picker-open',
  agentPickerOpen: 'opendeskmate:command:agent-picker-open',
  projectPickerOpen: 'opendeskmate:command:project-picker-open',
  workboardOpen: 'opendeskmate:command:workboard-open',
  saveNote: 'opendeskmate:command:save-note',
  exportOpen: 'opendeskmate:command:export-open',
  searchOpen: 'opendeskmate:command:search-open',
} as const;

type AppSlashCommandAction = {
  execute?: () => void | Promise<void>;
  visible?: boolean;
};

type AppSlashCommandOptions = {
  navigate: NavigateFunction;
  pathname: string;
  context: 'home' | 'chat' | 'build' | 'global';
  search?: string;
  modeSwitchTarget?: 'chat' | 'build';
  onOpenSettings?: () => void;
  pluginCommands?: PluginCommandContribution[];
  taskStop?: AppSlashCommandAction;
  taskSaveSkill?: AppSlashCommandAction;
  subagentsRefresh?: AppSlashCommandAction;
  buildHistoryOpen?: AppSlashCommandAction;
  buildHistoryNew?: AppSlashCommandAction;
  buildRuntimeStart?: AppSlashCommandAction;
  buildRuntimeStop?: AppSlashCommandAction;
  buildRuntimeRestart?: AppSlashCommandAction;
  buildRuntimeBuild?: AppSlashCommandAction;
  buildRuntimeOpenPreview?: AppSlashCommandAction;
};

function executeAction(
  action: AppSlashCommandAction | undefined,
  fallbackEvent: string
): void | Promise<void> {
  if (action?.execute) {
    return action.execute();
  }
  window.dispatchEvent(new CustomEvent(fallbackEvent));
}

function dispatchSettingsOpen(onOpenSettings?: () => void, query?: string): void {
  if (onOpenSettings) {
    onOpenSettings();
    return;
  }
  window.dispatchEvent(new CustomEvent('opendeskmate:open-settings', {
    detail: query ? { query } : undefined,
  }));
}

function isPluginCommandVisible(
  visibility: PluginCommandVisibility[] | undefined,
  context: AppSlashCommandOptions['context']
): boolean {
  if (!visibility || visibility.length === 0) return true;
  if (context === 'global') return visibility.includes('global');
  return visibility.includes(context) || visibility.includes('global');
}

function getPluginAppCommandBinding(
  commandId: PluginAppCommandId,
  options: AppSlashCommandOptions
): { action?: AppSlashCommandAction; fallbackEvent: string } | null {
  switch (commandId) {
    case 'task_stop':
      return { action: options.taskStop, fallbackEvent: APP_COMMAND_EVENTS.taskStop };
    case 'task_save_skill':
      return { action: options.taskSaveSkill, fallbackEvent: APP_COMMAND_EVENTS.taskSaveSkill };
    case 'subagents_refresh':
      return { action: options.subagentsRefresh, fallbackEvent: APP_COMMAND_EVENTS.subagentsRefresh };
    case 'build_history_open':
      return { action: options.buildHistoryOpen, fallbackEvent: APP_COMMAND_EVENTS.buildHistoryOpen };
    case 'build_history_new':
      return { action: options.buildHistoryNew, fallbackEvent: APP_COMMAND_EVENTS.buildHistoryNew };
    case 'build_runtime_start':
      return { action: options.buildRuntimeStart, fallbackEvent: APP_COMMAND_EVENTS.buildRuntimeStart };
    case 'build_runtime_stop':
      return { action: options.buildRuntimeStop, fallbackEvent: APP_COMMAND_EVENTS.buildRuntimeStop };
    case 'build_runtime_restart':
      return { action: options.buildRuntimeRestart, fallbackEvent: APP_COMMAND_EVENTS.buildRuntimeRestart };
    case 'build_runtime_build':
      return { action: options.buildRuntimeBuild, fallbackEvent: APP_COMMAND_EVENTS.buildRuntimeBuild };
    case 'build_runtime_open_preview':
      return { action: options.buildRuntimeOpenPreview, fallbackEvent: APP_COMMAND_EVENTS.buildRuntimeOpenPreview };
    default:
      return null;
  }
}

function createPluginSlashCommands(
  commands: PluginCommandContribution[] | undefined,
  options: AppSlashCommandOptions
): SlashCommandDefinition[] {
  if (!commands || commands.length === 0) return [];

  return commands
    .filter((command) => isPluginCommandVisible(command.visibility, options.context))
    .map((command) => {
      const action = command.action;
      let visible = true;
      let execute: SlashCommandDefinition['execute'] = () => {};

      if (action.type === 'navigate') {
        execute = () => {
          options.navigate(`${action.path}${action.search || ''}`);
        };
      } else if (action.type === 'open_settings') {
        execute = () => {
          dispatchSettingsOpen(options.onOpenSettings);
        };
      } else if (action.type === 'open_settings_section') {
        execute = () => {
          dispatchSettingsOpen(options.onOpenSettings, action.sectionQuery);
        };
      } else if (action.type === 'open_help_doc') {
        execute = () => {
          const path = `/help/${encodeURIComponent(action.docId)}`;
          const search = action.query ? `?q=${encodeURIComponent(action.query)}` : '';
          options.navigate(`${path}${search}`);
        };
      } else if (action.type === 'dispatch_app_command') {
        const binding = getPluginAppCommandBinding(action.commandId, options);
        visible = binding ? binding.action?.visible !== false : false;
        execute = () => {
          if (!binding) return;
          const resolvedBinding = binding;
          executeAction(resolvedBinding.action, resolvedBinding.fallbackEvent);
        };
      }

      return {
        id: command.id,
        command: command.command,
        title: command.title,
        description: command.description,
        group: command.group || 'Plugins',
        intent: command.intent,
        previewText: command.previewText,
        aliases: command.aliases,
        keywords: command.keywords,
        visible,
        execute,
      };
    });
}

export function createAppSlashCommands(options: AppSlashCommandOptions): SlashCommandDefinition[] {
  const from = `${options.pathname}${options.search || ''}`;
  const commands: SlashCommandDefinition[] = [
    ...createPluginSlashCommands(options.pluginCommands, options),
  ];

  if (options.modeSwitchTarget === 'build') {
    commands.push({
      id: 'build',
      command: 'build',
      title: 'Build',
      description: 'Switch to Build Mode.',
      group: 'Navigation',
      intent: 'navigate',
      previewText: 'Will switch the app to Build Mode.',
      aliases: ['b'],
      keywords: ['build mode', 'workspace'],
      execute: () => options.navigate('/build'),
    });
  }

  if (options.modeSwitchTarget === 'chat') {
    commands.push({
      id: 'chat',
      command: 'chat',
      title: 'Chat',
      description: 'Switch to Chat Mode.',
      group: 'Navigation',
      intent: 'navigate',
      previewText: 'Will switch the app to Chat Mode.',
      aliases: ['c'],
      keywords: ['home', 'task'],
      execute: () => options.navigate('/'),
    });
  }

  if (options.taskStop) {
    commands.push({
      id: 'stop',
      command: 'stop',
      title: 'Stop Task',
      description: 'Stop the current AI task.',
      group: 'Task',
      intent: 'danger',
      previewText: 'Will interrupt the current AI task immediately.',
      aliases: ['cancel'],
      keywords: ['interrupt', 'cancel', 'abort'],
      visible: options.taskStop.visible !== false,
      execute: () => executeAction(options.taskStop, APP_COMMAND_EVENTS.taskStop),
    });
  }

  if (options.taskSaveSkill) {
    commands.push({
      id: 'save-skill',
      command: 'save-skill',
      title: 'Save as Skill',
      description: 'Turn this completed chat into a reusable skill.',
      group: 'Task',
      intent: 'mutate',
      previewText: 'Will open the save-as-skill flow for the current finished chat.',
      aliases: ['skill'],
      keywords: ['skill', 'save chat', 'reuse'],
      visible: options.taskSaveSkill.visible !== false,
      execute: () => executeAction(options.taskSaveSkill, APP_COMMAND_EVENTS.taskSaveSkill),
    });
  }

  if (options.buildHistoryOpen) {
    commands.push({
      id: 'history',
      command: 'history',
      title: 'Build History',
      description: 'Open build task history.',
      group: 'Build',
      intent: 'inspect',
      previewText: 'Will open the Build task history selector.',
      aliases: ['hist'],
      keywords: ['sessions', 'past tasks', 'build history'],
      visible: options.buildHistoryOpen.visible !== false,
      execute: () => executeAction(options.buildHistoryOpen, APP_COMMAND_EVENTS.buildHistoryOpen),
    });
  }

  if (options.buildHistoryNew) {
    commands.push({
      id: 'history-new',
      command: 'history-new',
      title: 'New Build Task',
      description: 'Start a new Build history session.',
      group: 'Build',
      intent: 'mutate',
      previewText: 'Will clear the current Build task context and start a new history session.',
      aliases: ['newb'],
      keywords: ['new build', 'new session', 'reset build'],
      visible: options.buildHistoryNew.visible !== false,
      execute: () => executeAction(options.buildHistoryNew, APP_COMMAND_EVENTS.buildHistoryNew),
    });
  }

  if (options.buildRuntimeStart) {
    commands.push({
      id: 'runtime-start',
      command: 'runtime-start',
      title: 'Start Runtime',
      description: 'Start the Build runtime.',
      group: 'Build',
      intent: 'mutate',
      previewText: 'Will start the current Build runtime using the active workspace and preset.',
      aliases: ['start', 'rs'],
      keywords: ['dev server', 'start server', 'preview'],
      visible: options.buildRuntimeStart.visible !== false,
      execute: () => executeAction(options.buildRuntimeStart, APP_COMMAND_EVENTS.buildRuntimeStart),
    });
  }

  if (options.buildRuntimeStop) {
    commands.push({
      id: 'runtime-stop',
      command: 'runtime-stop',
      title: 'Stop Runtime',
      description: 'Stop the Build runtime.',
      group: 'Build',
      intent: 'danger',
      previewText: 'Will stop the currently running Build runtime.',
      aliases: ['rstop'],
      keywords: ['stop server', 'kill runtime', 'preview'],
      visible: options.buildRuntimeStop.visible !== false,
      execute: () => executeAction(options.buildRuntimeStop, APP_COMMAND_EVENTS.buildRuntimeStop),
    });
  }

  if (options.buildRuntimeRestart) {
    commands.push({
      id: 'runtime-restart',
      command: 'runtime-restart',
      title: 'Restart Runtime',
      description: 'Restart the Build runtime.',
      group: 'Build',
      intent: 'mutate',
      previewText: 'Will restart the Build runtime with the current settings.',
      aliases: ['restart', 'rr'],
      keywords: ['restart server', 'reload runtime', 'preview'],
      visible: options.buildRuntimeRestart.visible !== false,
      execute: () => executeAction(options.buildRuntimeRestart, APP_COMMAND_EVENTS.buildRuntimeRestart),
    });
  }

  if (options.buildRuntimeBuild) {
    commands.push({
      id: 'runtime-build',
      command: 'runtime-build',
      title: 'Run Build',
      description: 'Run the project build command once.',
      group: 'Build',
      intent: 'mutate',
      previewText: 'Will run the project build command once without changing the active chat task.',
      aliases: ['rb'],
      keywords: ['compile', 'bundle', 'build once'],
      visible: options.buildRuntimeBuild.visible !== false,
      execute: () => executeAction(options.buildRuntimeBuild, APP_COMMAND_EVENTS.buildRuntimeBuild),
    });
  }

  if (options.buildRuntimeOpenPreview) {
    commands.push({
      id: 'runtime-open',
      command: 'runtime-open',
      title: 'Open Preview',
      description: 'Open the Build runtime preview in your browser.',
      group: 'Build',
      intent: 'navigate',
      previewText: 'Will open the current Build preview URL in your external browser.',
      aliases: ['preview'],
      keywords: ['browser', 'preview', 'open runtime'],
      visible: options.buildRuntimeOpenPreview.visible !== false,
      execute: () => executeAction(options.buildRuntimeOpenPreview, APP_COMMAND_EVENTS.buildRuntimeOpenPreview),
    });
  }

  if (options.subagentsRefresh) {
    commands.push({
      id: 'subagents-refresh',
      command: 'subagents-refresh',
      title: 'Refresh Subagents',
      description: 'Refresh tracked subagent runs.',
      group: 'Subagents',
      intent: 'inspect',
      previewText: 'Will reload the current tracked subagent run list.',
      aliases: ['subs-refresh'],
      keywords: ['child agents', 'reload subagents', 'refresh agents'],
      visible: options.subagentsRefresh.visible !== false,
      execute: () => executeAction(options.subagentsRefresh, APP_COMMAND_EVENTS.subagentsRefresh),
    });
  }

  commands.push(
    {
      id: 'prompt',
      command: 'prompt',
      title: 'Saved Prompt',
      description: 'Open saved prompts for insertion.',
      group: 'Prompts',
      intent: 'inspect',
      previewText: 'Will open the saved prompt picker.',
      aliases: ['prompts'],
      keywords: ['saved prompt', 'prompt library', 'prompt card'],
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.promptPickerOpen));
      },
    },
    {
      id: 'recipe',
      command: 'recipe',
      title: 'Recipe',
      description: 'Open bundled recipes for insertion.',
      group: 'Prompts',
      intent: 'inspect',
      previewText: 'Will open the prompt picker with recipes included.',
      aliases: ['recipes'],
      keywords: ['prompt recipe', 'build recipe', 'prompt card'],
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.recipePickerOpen));
      },
    },
    {
      id: 'background',
      command: 'background',
      title: 'Background',
      description: 'Open the chat background picker.',
      group: 'Chat',
      intent: 'inspect',
      previewText: 'Will open the Chat Mode background picker.',
      aliases: ['wallpaper', 'theme'],
      keywords: ['chat background', 'background picker', 'appearance', 'wallpaper', 'theme'],
      visible: options.context !== 'build',
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.backgroundPickerOpen));
      },
    },
    {
      id: 'agent',
      command: 'agent',
      title: 'Agent',
      description: 'Open the agent selector.',
      group: 'Chat',
      intent: 'inspect',
      previewText: 'Will open agent selection for the current chat context.',
      aliases: ['agents', 'persona'],
      keywords: ['agent picker', 'agent selector', 'assistant', 'persona', 'profile'],
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.agentPickerOpen));
      },
    },
    {
      id: 'project',
      command: 'project',
      title: 'Project',
      description: 'Open project selection for the current chat.',
      group: 'Projects',
      intent: 'inspect',
      previewText: 'Will open the project selector for chat budget and context.',
      aliases: ['budget', 'usage'],
      keywords: ['usage project', 'project selector', 'budget project', 'billing', 'client'],
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.projectPickerOpen));
      },
    },
    {
      id: 'workboard',
      command: 'workboard',
      title: 'Workboard',
      description: 'Open linked project work items.',
      group: 'Projects',
      intent: 'inspect',
      previewText: 'Will open project Workboard items for the current chat context.',
      aliases: ['board', 'tasks'],
      keywords: ['work items', 'kanban', 'project work', 'task board', 'checklist'],
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.workboardOpen));
      },
    },
    {
      id: 'save-note',
      command: 'save-note',
      title: 'Save Note',
      description: 'Save the latest answer as a project note.',
      group: 'Projects',
      intent: 'mutate',
      previewText: 'Will start the flow for saving the latest answer to a Workboard note.',
      aliases: ['note', 'save-answer'],
      keywords: ['answer note', 'project note', 'workboard note', 'save response', 'capture'],
      visible: options.context === 'chat',
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.saveNote));
      },
    },
    {
      id: 'export',
      command: 'export',
      title: 'Export',
      description: 'Open export options for the current chat.',
      group: 'Chat',
      intent: 'mutate',
      previewText: 'Will open available export actions for the current chat or answer.',
      aliases: ['download', 'share'],
      keywords: ['export chat', 'download', 'save file', 'rtf', 'postcard', 'share'],
      visible: options.context === 'chat',
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.exportOpen));
      },
    },
    {
      id: 'search',
      command: 'search',
      title: 'Search',
      description: 'Open local search.',
      group: 'System',
      intent: 'inspect',
      previewText: 'Will open local search across history, Workboard, memory, skills, Git, and audit.',
      aliases: ['find', 'audit'],
      keywords: ['local search', 'search audit', 'history search', 'memory search', 'workboard search'],
      execute: () => {
        void window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENTS.searchOpen));
      },
    },
    {
      id: 'subagents-active',
      command: 'subagents-active',
      title: 'Subagents: Active',
      description: 'Open the global subagents page filtered to active runs.',
      group: 'Subagents',
      intent: 'navigate',
      previewText: 'Will open the Subagents page filtered to active runs.',
      aliases: ['subs-active'],
      keywords: ['running subagents', 'active child agents'],
      execute: () => options.navigate('/subagents?filter=active', { state: { from } }),
    },
    {
      id: 'subagents-session',
      command: 'subagents-session',
      title: 'Subagents: Session',
      description: 'Open the global subagents page filtered to session-mode runs.',
      group: 'Subagents',
      intent: 'navigate',
      previewText: 'Will open the Subagents page filtered to session-mode runs.',
      aliases: ['subs-session'],
      keywords: ['session subagents', 'persistent child agents'],
      execute: () => options.navigate('/subagents?filter=session', { state: { from } }),
    },
    {
      id: 'subagents-archived',
      command: 'subagents-archived',
      title: 'Subagents: Archived',
      description: 'Open the global subagents page filtered to archived runs.',
      group: 'Subagents',
      intent: 'navigate',
      previewText: 'Will open the Subagents page filtered to archived runs.',
      aliases: ['subs-archived'],
      keywords: ['archived subagents'],
      execute: () => options.navigate('/subagents?filter=archived', { state: { from } }),
    },
    {
      id: 'subagents-closed',
      command: 'subagents-closed',
      title: 'Subagents: Closed',
      description: 'Open the global subagents page filtered to closed sessions.',
      group: 'Subagents',
      intent: 'navigate',
      previewText: 'Will open the Subagents page filtered to closed sessions.',
      aliases: ['subs-closed'],
      keywords: ['closed subagents', 'closed sessions'],
      execute: () => options.navigate('/subagents?filter=closed', { state: { from } }),
    },
    {
      id: 'settings',
      command: 'settings',
      title: 'Settings',
      description: 'Open application settings.',
      group: 'System',
      intent: 'navigate',
      previewText: 'Will open the full Settings dialog.',
      aliases: ['prefs'],
      keywords: ['preferences', 'config'],
      execute: () => dispatchSettingsOpen(options.onOpenSettings),
    },
    {
      id: 'settings-models',
      command: 'settings-models',
      title: 'Settings: Models',
      description: 'Open Settings filtered to model-related sections.',
      group: 'System',
      intent: 'navigate',
      previewText: 'Will open Settings with the section search focused on model-related settings.',
      aliases: ['models'],
      keywords: ['model settings', 'providers', 'api keys'],
      execute: () => dispatchSettingsOpen(options.onOpenSettings, 'model'),
    },
    {
      id: 'settings-agents',
      command: 'settings-agents',
      title: 'Settings: Agents',
      description: 'Open Settings filtered to agent-related sections.',
      group: 'System',
      intent: 'navigate',
      previewText: 'Will open Settings with the section search focused on agent-related settings.',
      aliases: ['agents'],
      keywords: ['agent settings', 'persona', 'subagents'],
      execute: () => dispatchSettingsOpen(options.onOpenSettings, 'agent'),
    },
    {
      id: 'settings-skills',
      command: 'settings-skills',
      title: 'Settings: Skills',
      description: 'Open Settings filtered to skills-related sections.',
      group: 'System',
      intent: 'navigate',
      previewText: 'Will open Settings with the section search focused on skills-related settings.',
      aliases: ['skills'],
      keywords: ['skills settings', 'user skills'],
      execute: () => dispatchSettingsOpen(options.onOpenSettings, 'skill'),
    },
    {
      id: 'settings-hooks',
      command: 'settings-hooks',
      title: 'Settings: Runtime Hooks',
      description: 'Open Settings filtered to runtime hooks.',
      group: 'System',
      intent: 'navigate',
      previewText: 'Will open Settings with the section search focused on runtime hooks.',
      aliases: ['hooks'],
      keywords: ['hooks', 'runtime hooks', 'policies'],
      execute: () => dispatchSettingsOpen(options.onOpenSettings, 'runtime hooks'),
    },
    {
      id: 'subagents',
      command: 'subagents',
      title: 'Subagents',
      description: 'Open the global subagents page.',
      group: 'Subagents',
      intent: 'navigate',
      previewText: 'Will open the global Subagents page.',
      aliases: ['subs'],
      keywords: ['agents', 'children'],
      execute: () => options.navigate('/subagents', { state: { from } }),
    },
    {
      id: 'help',
      command: 'help',
      title: 'Help',
      description: 'Open the help page.',
      group: 'System',
      intent: 'navigate',
      previewText: 'Will open the Help page.',
      aliases: ['docs'],
      keywords: ['docs', 'documentation'],
      execute: () => options.navigate('/help'),
    },
    {
      id: 'new',
      command: 'new',
      title: 'New',
      description: 'Go to the new task page.',
      group: 'Navigation',
      intent: 'navigate',
      previewText: 'Will open the new task page.',
      aliases: ['home'],
      keywords: ['home', 'new task'],
      execute: () => options.navigate('/'),
    }
  );

  return commands;
}
