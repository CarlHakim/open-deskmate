'use client';

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Terminal as XTermTerminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import type {
  BuildEnvProfile,
  BuildFileTreeNode,
  BuildDiffEnforcementMode,
  BuildLogEntry,
  BuildProjectPreset,
  BuildSessionSnapshot,
  BuildStartEntry,
  BuildTerminalEntry,
  BuildTerminalSessionSummary,
  BuildTerminalSnapshot,
  BuildTaskSession,
  BuildTaskSessionListItem,
  BuildWorkspaceFingerprint,
  BuildWorkspaceDiff,
  ContextWindowEstimateResponse,
  ProviderConfig,
  SelectedModel,
  SubagentRunRecord,
  SubagentRunTreeNode,
  Task,
  TaskStatus,
  TaskMessage,
} from '@accomplish/shared';
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clipboard,
  Circle,
  Code,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  File,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  FolderOpen,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Search,
  History,
  GripVertical,
  Star,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  PanelBottomClose,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';
import { getAccomplish } from '@/lib/accomplish';
import ModeSwitch from '@/components/layout/ModeSwitch';
import ContextWindowIndicator from '@/components/chat/ContextWindowIndicator';
import { useTheme } from '@/contexts/ThemeContext';
import InlineSlashCommandMenu from '@/components/commands/InlineSlashCommandMenu';
import { filterSlashCommands, type SlashCommandDefinition } from '@/lib/slash-commands';
import { APP_COMMAND_EVENTS, createAppSlashCommands } from '@/lib/app-commands';
import { usePluginSlashCommands } from '@/hooks/usePluginSlashCommands';

const TERMINAL_TASK_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
  xai: 'xAI',
  ollama: 'Ollama',
};
const CODE_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt',
  'html', 'css', 'scss', 'sass', 'less', 'sql', 'sh', 'ps1', 'c', 'cpp', 'h', 'hpp',
]);
const TEXT_FILE_EXTENSIONS = new Set(['md', 'txt', 'rtf', 'log']);
const CONFIG_FILE_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'lock']);
const ASSET_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp', 'mp4', 'mp3', 'wav']);
const BUILD_CENTER_PANEL_MIN_HEIGHT = 180;
const BUILD_LOWER_PANEL_MIN_HEIGHT = 160;
const BUILD_CENTER_PANEL_SPLITTER_HEIGHT = 8;
const BUILD_RUNTIME_GET_WORKSPACE_SWITCH_ERROR = "Error invoking remote method 'build-mode:runtime:get': Error: Cannot switch workspace path while process is running. Stop runtime first.";
const BUILD_HOVER_TOOLTIP_ATTR = 'data-build-hover-tooltip';
const BUILD_RESTORED_RUNTIME_LOG_LIMIT = 250;
const BUILD_SUBAGENTS_PANEL_MAX_HEIGHT = 136;

type BuildHoverTooltipState = {
  content: string;
  x: number;
  y: number;
};

type BuildEditorTab = {
  node: BuildFileTreeNode;
  workspaceRelativePath: string;
  content: string;
  dirty: boolean;
};

type PersistedBuildEditorLayout = {
  openTabs: Array<{
    relativePath: string;
    workspaceRelativePath: string;
  }>;
  activeEditorTabKey: string | null;
  centerPanelView: 'preview' | 'editor';
};

type PersistedBuildViewState = {
  workspaceRelativePath: string;
  selectedPresetId: string | null;
  diffCollapsed?: boolean;
};

type WorkspaceTreeClipboardEntry = {
  mode: 'cut' | 'copy';
  relativePath: string;
  workspaceRelativePath: string;
  type: BuildFileTreeNode['type'];
};

type WorkspaceTreeContextMenuState = {
  node: BuildFileTreeNode;
  x: number;
  y: number;
};

type WorkspacePathBlockedDialogState = {
  requestedPath: string;
  sourceLabel: string;
};

type PresetWorkspaceConfirmDialogState = {
  presetId: string;
  presetName: string;
  presetWorkspaceRelativePath: string;
  currentWorkspaceRelativePath: string;
};

type EditableBuildStartEntry = {
  id: string;
  role: 'preview' | 'worker';
  workspaceRelativePath: string;
  command: string;
};

type BuildTooltipProps = {
  content: ReactNode;
  children: ReactElement;
  side?: ComponentProps<typeof TooltipContent>['side'];
  align?: ComponentProps<typeof TooltipContent>['align'];
  className?: string;
};

const BUILD_EDITOR_LAYOUT_STORAGE_PREFIX = 'opendeskmate:build-editor-layout:v1';
const BUILD_VIEW_STATE_STORAGE_PREFIX = 'opendeskmate:build-view-state:v1';
const BUILD_ACTIVE_HISTORY_SESSION_STORAGE_PREFIX = 'opendeskmate:build-active-history-session:v1';

type PersistedBuildActiveHistorySessionState = {
  sessionId: string | null;
  historyDropdownOpen?: boolean;
};

function BuildTooltip({ content, children, side = 'top', align = 'center', className }: BuildTooltipProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className={cn('max-w-xs whitespace-pre-line text-[11px] leading-relaxed', className)}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function formatRuntimeStatus(status: BuildSessionSnapshot['runtime']['status']): string {
  switch (status) {
    case 'running': return 'Running';
    case 'starting': return 'Starting';
    case 'error': return 'Error';
    default: return 'Stopped';
  }
}

function formatStream(stream: BuildLogEntry['stream']): string {
  if (stream === 'stdout') return 'OUT';
  if (stream === 'stderr') return 'ERR';
  return 'SYS';
}

function formatSubagentRunStatus(status: SubagentRunRecord['status'], resultStatus?: SubagentRunRecord['resultStatus']): string {
  if (status === 'done') {
    if (resultStatus === 'interrupted') return 'Interrupted';
    if (resultStatus === 'error') return 'Failed';
    return 'Completed';
  }
  if (status === 'error') return 'Failed';
  if (status === 'accepted') return 'Queued';
  return 'Running';
}

function getSubagentRunStatusClasses(status: SubagentRunRecord['status'], resultStatus?: SubagentRunRecord['resultStatus']): string {
  if (status === 'done' && resultStatus === 'success') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if ((status === 'done' && resultStatus === 'interrupted') || status === 'accepted') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'error' || (status === 'done' && resultStatus === 'error')) return 'bg-destructive/10 text-destructive';
  return 'bg-sky-500/10 text-sky-700 dark:text-sky-300';
}

function formatSubagentModeLabel(run: Pick<SubagentRunRecord, 'mode' | 'sessionState' | 'reuseCount'> & { childTaskStatus?: string }): string {
  const parts = [run.mode === 'session' ? 'Session mode' : 'Run mode'];
  if (run.mode === 'session' && run.sessionState) {
    parts.push(`session ${run.sessionState}`);
  }
  if (run.mode === 'run' && run.childTaskStatus) {
    parts.push(`task ${run.childTaskStatus}`);
  }
  if (typeof run.reuseCount === 'number' && run.reuseCount > 0) {
    parts.push(`reused ${run.reuseCount}x`);
  }
  return parts.join(' · ');
}

function areSubagentRunListsEquivalent(a: SubagentRunRecord[], b: SubagentRunRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.runId !== right.runId
      || left.status !== right.status
      || left.resultStatus !== right.resultStatus
      || left.updatedAt !== right.updatedAt
      || left.archivedAt !== right.archivedAt
      || left.closedAt !== right.closedAt
      || left.sessionState !== right.sessionState
      || left.reuseCount !== right.reuseCount
    ) {
      return false;
    }
  }
  return true;
}

function areSubagentRunTreesEquivalent(a: SubagentRunTreeNode[], b: SubagentRunTreeNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.runId !== right.runId
      || left.status !== right.status
      || left.resultStatus !== right.resultStatus
      || left.updatedAt !== right.updatedAt
      || left.archivedAt !== right.archivedAt
      || left.closedAt !== right.closedAt
      || left.sessionState !== right.sessionState
      || left.reuseCount !== right.reuseCount
    ) {
      return false;
    }
    if (!areSubagentRunTreesEquivalent(left.children, right.children)) {
      return false;
    }
  }
  return true;
}

function BuildSubagentTreeList({
  nodes,
  level = 0,
  stoppingSubagentRunId,
  onOpen,
  onStop,
  onCloseSession,
}: {
  nodes: SubagentRunTreeNode[];
  level?: number;
  stoppingSubagentRunId: string | null;
  onOpen: (run: SubagentRunRecord) => void;
  onStop: (runId: string) => void;
  onCloseSession: (runId: string) => void;
}): ReactElement | null {
  if (nodes.length === 0) return null;
  return (
    <div className={cn('space-y-1.5', level > 0 ? 'ml-4 border-l border-border/50 pl-3' : '')}>
      {nodes.map((run) => {
        const stoppable = run.status === 'running' || run.status === 'accepted';
        return (
          <div key={run.runId} className="rounded-md border border-border/50 bg-background/70 px-2 py-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">
                  {run.label || run.childAgentId}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  Agent: {run.childAgentId}
                  {run.model ? ` · ${run.model.provider}:${run.model.model}` : ''}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {formatSubagentModeLabel(run)}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getSubagentRunStatusClasses(run.status, run.resultStatus))}>
                  {formatSubagentRunStatus(run.status, run.resultStatus)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onOpen(run)}
                >
                  Open
                </Button>
                {stoppable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => onStop(run.runId)}
                    disabled={stoppingSubagentRunId === run.runId}
                  >
                    {stoppingSubagentRunId === run.runId ? 'Stopping' : 'Stop'}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onCloseSession(run.runId)}
                >
                  Close session
                </Button>
              </div>
            </div>
            <div className="mt-1 truncate text-[10px] text-muted-foreground" title={run.task}>
              {run.task}
            </div>
            {run.children.length > 0 ? (
              <div className="mt-2">
                <BuildSubagentTreeList
                  nodes={run.children}
                  level={level + 1}
                  stoppingSubagentRunId={stoppingSubagentRunId}
                  onOpen={onOpen}
                  onStop={onStop}
                  onCloseSession={onCloseSession}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function isBuildModeGoalPanelMessage(message: TaskMessage): boolean {
  const content = String(message.content || '');
  return message.type === 'user' && content.startsWith('Build Mode goal:');
}

function formatBuildAssistantPanelMessageType(message: TaskMessage): string {
  if (isBuildModeGoalPanelMessage(message)) {
    return 'Build Mode Goal';
  }
  if (message.type === 'assistant') return 'Assistant';
  if (message.type === 'tool') return 'Tool';
  if (message.type === 'system') return 'System';
  if (message.type === 'user') return 'User';
  return message.type;
}

function getCollapsedToolMessageContent(content: string): { preview: string; truncated: boolean } {
  const normalized = String(content || '').trim();
  if (!normalized) {
    return { preview: '', truncated: false };
  }

  const fenceMatch = normalized.match(/```([^\n`]*)\n([\s\S]*?)```/);
  const previewParts: string[] = [];
  let truncated = false;

  const proseParagraphs = normalized
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith('```'));

  const firstProseParagraph = proseParagraphs[0] || '';
  if (firstProseParagraph) {
    let prosePreview = firstProseParagraph;
    const proseLines = prosePreview.split(/\r?\n/);
    if (proseLines.length > 6) {
      prosePreview = proseLines.slice(0, 6).join('\n').trimEnd();
      truncated = true;
    }
    if (prosePreview.length > 380) {
      prosePreview = `${prosePreview.slice(0, 380).trimEnd()}...`;
      truncated = true;
    }
    previewParts.push(prosePreview);
  }

  if (fenceMatch) {
    const language = (fenceMatch[1] || '').trim();
    let codeBody = fenceMatch[2] || '';
    const codeLines = codeBody.replace(/\s+$/g, '').split(/\r?\n/);
    if (codeLines.length > 12) {
      codeBody = `${codeLines.slice(0, 12).join('\n').trimEnd()}\n...`;
      truncated = true;
    } else {
      codeBody = codeLines.join('\n').trimEnd();
    }
    if (codeBody.length > 700) {
      codeBody = `${codeBody.slice(0, 700).trimEnd()}\n...`;
      truncated = true;
    }
    previewParts.push(`\`\`\`${language}\n${codeBody}\n\`\`\``.trim());
  }

  let preview = previewParts.join('\n\n').trim();

  if (!preview) {
    const paragraphs = normalized.split(/\n\s*\n/);
    preview = paragraphs[0]?.trim() || '';
    const previewLines = preview.split(/\r?\n/);
    if (previewLines.length > 10) {
      preview = previewLines.slice(0, 10).join('\n').trimEnd();
      truncated = true;
    }
  }

  if (preview.length > 900) {
    preview = `${preview.slice(0, 900).trimEnd()}...`;
    truncated = true;
  }

  if (!truncated) {
    const normalizedPreview = preview.replace(/\s+/g, ' ').trim();
    const normalizedFull = normalized.replace(/\s+/g, ' ').trim();
    truncated = normalizedPreview !== normalizedFull;
  }

  return { preview, truncated };
}

function getBuildEditorTabLabel(relativePath: string): string {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized || 'file';
}

function renderBuildEditorTabIcon(relativePath: string, isSelected: boolean): ReactElement {
  const fileName = getBuildEditorTabLabel(relativePath);
  return getFileIcon(fileName, isSelected);
}

function getBuildEditorLayoutStorageKey(agentId: string): string {
  return `${BUILD_EDITOR_LAYOUT_STORAGE_PREFIX}:${agentId}`;
}

function getBuildEditorTabKey(relativePath: string, workspaceRelativePath: string): string {
  return `${canonicalizeWorkspaceRelativePath(workspaceRelativePath)}::${normalizeFsPath(relativePath || '')}`;
}

function toWorkspaceScopedRelativePath(fullRelativePath: string, workspaceRelativePath: string): string {
  const normalizedFullPath = normalizeFsPath(fullRelativePath || '.') || '.';
  const normalizedWorkspacePath = canonicalizeWorkspaceRelativePath(workspaceRelativePath);

  if (normalizedWorkspacePath === '.' || normalizedFullPath === '.') {
    return normalizedFullPath === '.' ? '' : normalizedFullPath;
  }

  if (normalizedFullPath === normalizedWorkspacePath) {
    return '';
  }

  if (normalizedFullPath.startsWith(`${normalizedWorkspacePath}/`)) {
    return normalizedFullPath.slice(normalizedWorkspacePath.length + 1);
  }

  return normalizedFullPath;
}

function treeHasDirectoryPath(node: BuildFileTreeNode | null, relativePath: string): boolean {
  if (!node) return false;
  if (node.type === 'directory' && node.relativePath === relativePath) return true;
  if (!Array.isArray(node.children) || node.children.length === 0) return false;
  return node.children.some((child) => treeHasDirectoryPath(child, relativePath));
}

function treeHasNodePath(node: BuildFileTreeNode | null, relativePath: string): boolean {
  if (!node) return false;
  if (node.relativePath === relativePath) return true;
  if (!Array.isArray(node.children) || node.children.length === 0) return false;
  return node.children.some((child) => treeHasNodePath(child, relativePath));
}

function findTreeNodeByPath(node: BuildFileTreeNode | null, relativePath: string): BuildFileTreeNode | null {
  if (!node) return null;
  if (node.relativePath === relativePath) return node;
  if (!Array.isArray(node.children) || node.children.length === 0) return null;
  for (const child of node.children) {
    const match = findTreeNodeByPath(child, relativePath);
    if (match) return match;
  }
  return null;
}

function collectAssistantMessages(messages: TaskMessage[]): TaskMessage[] {
  return messages.filter((message) => (
    (message.type === 'user' && !isBuildModeGoalPanelMessage(message))
    || message.type === 'assistant'
    || message.type === 'tool'
    || message.type === 'system'
  ));
}

function isLocalBuildGoalMessage(message: TaskMessage): boolean {
  return message.type === 'user' && message.id.startsWith('local-build-goal-');
}

function isLocalBuildAutoRepairAttemptMessage(message: TaskMessage): boolean {
  return message.type === 'system' && message.id.startsWith('local-auto-repair-attempt-');
}

function isLocalBuildTimelineMessage(message: TaskMessage): boolean {
  return isLocalBuildGoalMessage(message) || isLocalBuildAutoRepairAttemptMessage(message);
}

function getNextAutoRepairAttemptNumber(messages: TaskMessage[]): number {
  const attempts = messages.filter((message) => isLocalBuildAutoRepairAttemptMessage(message)).length;
  return attempts + 1;
}

function toTimestampMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeIncomingWithLocalBuildGoalMessages(existing: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] {
  const normalizedIncoming = collectAssistantMessages(incoming);
  const merged = [...normalizedIncoming];
  const latestPendingLocalGoalMessage = [...existing].reverse().find((message) => {
    if (!isLocalBuildGoalMessage(message)) return false;
    return !normalizedIncoming.some((incomingMessage) => (
      incomingMessage.type === 'user'
      && String(incomingMessage.content || '').trim() === String(message.content || '').trim()
    ));
  });
  const localAutoRepairMessages = existing.filter((message) => isLocalBuildAutoRepairAttemptMessage(message));

  if (latestPendingLocalGoalMessage) {
    merged.push(latestPendingLocalGoalMessage);
  }

  for (const localMessage of localAutoRepairMessages) {
    merged.push(localMessage);
  }

  const deduped: TaskMessage[] = [];
  const seen = new Set<string>();
  for (const message of merged) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    deduped.push(message);
  }

  deduped.sort((a, b) => {
    const delta = toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp);
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id);
  });
  return deduped;
}

function createDefaultEnvProfile(): BuildEnvProfile {
  return {
    id: `env-${Date.now().toString(36)}`,
    name: 'default',
    variables: {},
  };
}

function envVarsToText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseEnvVarsText(text: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    const value = line.slice(eqIndex + 1);
    next[key] = value;
  }
  return next;
}

type ParsedStartEntriesResult = {
  entries: BuildStartEntry[];
  issues: string[];
};

function createEditableBuildStartEntry(
  overrides: Partial<EditableBuildStartEntry> = {}
): EditableBuildStartEntry {
  return {
    id: overrides.id || `start-entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: overrides.role === 'worker' ? 'worker' : 'preview',
    workspaceRelativePath: overrides.workspaceRelativePath || '',
    command: overrides.command || '',
  };
}

function buildStartEntriesToEditable(entries?: BuildStartEntry[] | null): EditableBuildStartEntry[] {
  const normalized = Array.isArray(entries) ? entries.filter((entry) => typeof entry?.command === 'string' && entry.command.trim()) : [];
  if (normalized.length === 0) {
    return [];
  }
  let previewAssigned = false;
  return normalized.map((entry, index) => {
    const role = entry.role === 'preview'
      ? 'preview'
      : !previewAssigned && index === 0
        ? 'preview'
        : 'worker';
    if (role === 'preview') {
      previewAssigned = true;
    }
    return createEditableBuildStartEntry({
      role,
      workspaceRelativePath: entry.workspaceRelativePath || '',
      command: entry.command || '',
    });
  });
}

function parseEditableStartEntries(entriesInput: EditableBuildStartEntry[]): ParsedStartEntriesResult {
  const entries: BuildStartEntry[] = [];
  const issues: string[] = [];

  const nonEmptyEntries = entriesInput.filter((entry) =>
    entry.command.trim().length > 0 || entry.workspaceRelativePath.trim().length > 0
  );

  if (nonEmptyEntries.length === 0) {
    return { entries: [], issues: [] };
  }

  const previewEntries = nonEmptyEntries.filter((entry) => entry.role === 'preview');
  if (previewEntries.length !== 1) {
    issues.push('Exactly one start entry must be marked as preview.');
  }

  nonEmptyEntries.forEach((entry, index) => {
    const command = entry.command.trim();
    const folder = entry.workspaceRelativePath.trim();
    if (!command) {
      issues.push(`Start entry ${index + 1} is missing a command.`);
      return;
    }
    entries.push({
      command,
      workspaceRelativePath: folder || undefined,
      role: entry.role,
    });
  });

  if (entries.length > 1 && previewEntries.length === 1) {
    const previewIndex = nonEmptyEntries.findIndex((entry) => entry.role === 'preview');
    if (previewIndex > 0) {
      issues.push('Preview entry is not first. Reorder entries if you want the preview process at the top.');
    }
  }

  return { entries, issues };
}

function getBuildViewStateStorageKey(agentId: string): string {
  return `${BUILD_VIEW_STATE_STORAGE_PREFIX}:${agentId}`;
}

function getBuildActiveHistorySessionStorageKey(agentId: string): string {
  return `${BUILD_ACTIVE_HISTORY_SESSION_STORAGE_PREFIX}:${agentId}`;
}

function formatTimestamp(value?: string): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function mapTaskStatusToLifecycle(status: TaskStatus): BuildTaskSession['lifecycleStatus'] {
  if (status === 'failed') return 'failed';
  if (status === 'interrupted' || status === 'cancelled') return 'interrupted';
  if (status === 'completed') return 'completed';
  return 'active';
}

function formatAgeShort(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const deltaMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${Math.max(1, months)}mo`;
  const years = Math.floor(days / 365);
  return `${Math.max(1, years)}y`;
}

function formatSessionStatus(status: BuildTaskSession['lifecycleStatus']): string {
  switch (status) {
    case 'active': return 'Active';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'interrupted': return 'Interrupted';
    case 'archived': return 'Archived';
    default: return status;
  }
}

function formatTokensShort(value?: number): string {
  if (!value || value <= 0) return '';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function normalizeFsPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '').trim();
}

function canonicalizeWorkspaceRelativePath(value: string | null | undefined): string {
  const normalized = normalizeFsPath(value || '.');
  if (!normalized || normalized === '.') return '.';
  const withoutLeadingDot = normalized.replace(/^\.\/+/, '');
  return withoutLeadingDot || '.';
}

function normalizeWorkspacePathKey(value: string | null | undefined): string {
  return canonicalizeWorkspaceRelativePath(value).toLowerCase();
}

function toWorkspaceRelativePath(agentRoot: string, selectedPath: string): string | null {
  const rootNorm = normalizeFsPath(agentRoot);
  const selectedNorm = normalizeFsPath(selectedPath);
  if (!rootNorm || !selectedNorm) return null;

  const rootCmp = rootNorm.toLowerCase();
  const selectedCmp = selectedNorm.toLowerCase();
  if (selectedCmp === rootCmp) return '.';
  const withSlash = `${rootCmp}/`;
  if (!selectedCmp.startsWith(withSlash)) return null;
  const relative = selectedNorm.slice(rootNorm.length + 1).replace(/^\/+/, '').trim();
  return relative || '.';
}

function replacePathPrefix(value: string, fromPrefix: string, toPrefix: string): string {
  const normalizedValue = normalizeFsPath(value || '.') || '.';
  const normalizedFrom = normalizeFsPath(fromPrefix || '.') || '.';
  const normalizedTo = normalizeFsPath(toPrefix || '.') || '.';

  if (normalizedValue === normalizedFrom) {
    return normalizedTo;
  }
  if (normalizedValue.startsWith(`${normalizedFrom}/`)) {
    const suffix = normalizedValue.slice(normalizedFrom.length + 1);
    return normalizedTo === '.' ? suffix : `${normalizedTo}/${suffix}`;
  }
  return normalizedValue;
}

function pathMatchesOrDescendsFrom(value: string | null | undefined, parentPath: string): boolean {
  if (!value) return false;
  const normalizedValue = normalizeFsPath(value);
  const normalizedParent = normalizeFsPath(parentPath);
  if (!normalizedValue || !normalizedParent) return false;
  return normalizedValue === normalizedParent || normalizedValue.startsWith(`${normalizedParent}/`);
}

function getParentRelativePath(value: string): string {
  const normalized = normalizeFsPath(value || '.') || '.';
  if (normalized === '.' || !normalized.includes('/')) {
    return '.';
  }
  return normalized.slice(0, normalized.lastIndexOf('/')) || '.';
}

type BuildPresetInputWithHelpProps = ComponentProps<typeof Input> & {
  helpTitle: string;
  helpDescription: string;
  optional?: boolean;
};

type BuildPresetFieldHelpProps = {
  helpTitle: string;
  helpDescription: string;
  optional?: boolean;
  children: ReactNode;
};

function BuildPresetFieldHelp({
  helpTitle,
  helpDescription,
  optional = false,
  children,
}: BuildPresetFieldHelpProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocusCapture={() => setOpen(true)}
          onBlurCapture={() => setOpen(false)}
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-xs leading-relaxed text-foreground" align="start">
        <div className="space-y-1">
          <div className="font-medium text-foreground">
            {helpTitle}
            {optional ? <span className="ml-1 text-muted-foreground">(optional)</span> : null}
          </div>
          <div className="text-muted-foreground">{helpDescription}</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BuildPresetInputWithHelp({
  helpTitle,
  helpDescription,
  optional = false,
  placeholder,
  ...props
}: BuildPresetInputWithHelpProps) {
  return (
    <BuildPresetFieldHelp helpTitle={helpTitle} helpDescription={helpDescription} optional={optional}>
      <Input placeholder={placeholder} {...props} />
    </BuildPresetFieldHelp>
  );
}

function pathLeaf(value: string): string {
  const normalized = normalizeFsPath(value);
  if (!normalized || normalized === '.') return 'workspace root';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function resolveLocalhostPreviewUrl(snapshot: BuildSessionSnapshot | null): string | null {
  if (!snapshot) return null;

  const port = Number(snapshot.runtime.port);
  const rawPreviewUrl = typeof snapshot.runtime.previewUrl === 'string' ? snapshot.runtime.previewUrl.trim() : '';
  if (rawPreviewUrl) {
    try {
      const parsed = new URL(rawPreviewUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // Force local open behavior from desktop regardless of advertised host.
        parsed.hostname = 'localhost';
        return parsed.toString();
      }
    } catch {
      // Fall back to port-only URL generation below.
    }
  }

  if (Number.isFinite(port) && port > 0) {
    return `http://localhost:${port}`;
  }
  return null;
}

function formatSelectedModelBadgeLabel(model: SelectedModel | null | undefined): string {
  if (!model || typeof model !== 'object') return '';
  const providerId = typeof model.provider === 'string' ? model.provider.trim() : '';
  const modelFullId = typeof model.model === 'string' ? model.model.trim() : '';
  if (!modelFullId) return '';

  const providerPrefix = providerId ? `${providerId}/`.toLowerCase() : '';
  let modelName = modelFullId;
  if (providerPrefix && modelFullId.toLowerCase().startsWith(providerPrefix)) {
    modelName = modelFullId.slice(providerPrefix.length);
  } else if (modelFullId.includes('/')) {
    modelName = modelFullId.slice(modelFullId.indexOf('/') + 1);
  }

  const providerLabel = PROVIDER_LABELS[providerId.toLowerCase()] || providerId;
  return providerLabel ? `${providerLabel}: ${modelName}` : modelName;
}

interface TreeNodeProps {
  node: BuildFileTreeNode;
  selectedPath: string | null;
  onSelect: (node: BuildFileTreeNode) => void;
  depth?: number;
  collapseToken?: number;
  pendingCreateType?: 'file' | 'folder' | null;
  pendingCreateName?: string;
  pendingCreateParentPath?: string | null;
  onPendingCreateNameChange?: (value: string) => void;
  onCommitPendingCreate?: () => void;
  onCancelPendingCreate?: () => void;
  onDirectoryInteract?: (node: BuildFileTreeNode) => void;
  pendingCreateInputRef?: React.RefObject<HTMLInputElement | null>;
  pendingRenamePath?: string | null;
  pendingRenameName?: string;
  onPendingRenameNameChange?: (value: string) => void;
  onCommitPendingRename?: () => void;
  onCancelPendingRename?: () => void;
  pendingRenameInputRef?: React.RefObject<HTMLInputElement | null>;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>, node: BuildFileTreeNode) => void;
  clipboardEntry?: WorkspaceTreeClipboardEntry | null;
  currentWorkspaceRelativePath?: string;
}

interface ParsedPlanItem {
  id: string;
  content: string;
  status?: string;
  priority?: string;
}

function parsePlanItemsFromAssistantContent(content: string): ParsedPlanItem[] | null {
  const raw = String(content || '').trim();
  if (!raw) return null;

  const candidates: string[] = [raw];
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!Array.isArray(parsed)) continue;
      const items: ParsedPlanItem[] = [];
      for (let idx = 0; idx < parsed.length; idx += 1) {
        const entry = parsed[idx];
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const text = typeof record.content === 'string' ? record.content.trim() : '';
        if (!text) return null;
        items.push({
          id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : String(idx + 1),
          content: text,
          status: typeof record.status === 'string' ? record.status.trim().toLowerCase() : undefined,
          priority: typeof record.priority === 'string' ? record.priority.trim().toLowerCase() : undefined,
        });
      }
      return items.length > 0 ? items : null;
    } catch {
      // Try next parse candidate.
    }
  }

  return null;
}

function renderPlanStatusIcon(status?: string) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === 'in_progress') return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />;
  if (status === 'failed' || status === 'blocked') return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatPlanStatusLabel(status?: string): string {
  if (!status) return 'pending';
  if (status === 'in_progress') return 'in progress';
  return status.replace(/_/g, ' ');
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function getEditorLanguageExtensions(filePath: string | null | undefined): Extension[] {
  const ext = getFileExtension(filePath || '');
  if (['ts', 'tsx'].includes(ext)) return [javascript({ typescript: true, jsx: true })];
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return [javascript({ jsx: true })];
  if (ext === 'json') return [json()];
  if (['html', 'htm'].includes(ext)) return [html()];
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return [css()];
  if (['md', 'markdown'].includes(ext)) return [markdown()];
  if (ext === 'py') return [python()];
  if (ext === 'sql') return [sql()];
  return [];
}

function getFileIcon(name: string, isSelected: boolean) {
  const ext = getFileExtension(name);
  const selectedClass = isSelected ? 'text-primary' : '';

  if (CODE_FILE_EXTENSIONS.has(ext)) {
    return <FileCode className={cn('h-3.5 w-3.5 shrink-0 text-[#519aba] dark:text-[#519aba]', selectedClass)} />;
  }
  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    return <FileText className={cn('h-3.5 w-3.5 shrink-0 text-[#89d185] dark:text-[#89d185]', selectedClass)} />;
  }
  if (CONFIG_FILE_EXTENSIONS.has(ext)) {
    return <File className={cn('h-3.5 w-3.5 shrink-0 text-[#d19a66] dark:text-[#d19a66]', selectedClass)} />;
  }
  if (ASSET_FILE_EXTENSIONS.has(ext)) {
    return <File className={cn('h-3.5 w-3.5 shrink-0 text-[#c586c0] dark:text-[#c586c0]', selectedClass)} />;
  }
  return <File className={cn('h-3.5 w-3.5 shrink-0 text-[#9aa0a6] dark:text-[#9aa0a6]', selectedClass)} />;
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
  collapseToken = 0,
  pendingCreateType = null,
  pendingCreateName = '',
  pendingCreateParentPath = null,
  onPendingCreateNameChange,
  onCommitPendingCreate,
  onCancelPendingCreate,
  onDirectoryInteract,
  pendingCreateInputRef,
  pendingRenamePath = null,
  pendingRenameName = '',
  onPendingRenameNameChange,
  onCommitPendingRename,
  onCancelPendingRename,
  pendingRenameInputRef,
  onContextMenu,
  clipboardEntry = null,
  currentWorkspaceRelativePath = '.',
}: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node.type === 'directory';
  const isSelected = selectedPath === node.relativePath;
  const isPendingRename = pendingRenamePath === node.relativePath;
  const isCutEntry = clipboardEntry?.mode === 'cut'
    && clipboardEntry.relativePath === node.relativePath
    && canonicalizeWorkspaceRelativePath(clipboardEntry.workspaceRelativePath) === canonicalizeWorkspaceRelativePath(currentWorkspaceRelativePath);
  const sortedChildren = useMemo(() => {
    if (!Array.isArray(node.children)) return [];
    return [...node.children].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [node.children]);

  useEffect(() => {
    if (!isDir) return;
    setOpen(depth < 1);
  }, [collapseToken, depth, isDir]);

  useEffect(() => {
    if (!isDir) return;
    if (pendingCreateParentPath === node.relativePath) {
      setOpen(true);
    }
  }, [isDir, node.relativePath, pendingCreateParentPath]);

  const directoryChildren = sortedChildren.filter((child) => child.type === 'directory');
  const fileChildren = sortedChildren.filter((child) => child.type === 'file');
  const shouldRenderInlineCreate = isDir && open && pendingCreateType && pendingCreateParentPath === node.relativePath;
  const rowPaddingLeft = `${6 + depth * 12}px`;
  const childPaddingLeft = `${6 + (depth + 1) * 12}px`;
  const rowIcon = isDir ? (
    open ? (
      <FolderOpen className={cn('h-3.5 w-3.5 shrink-0 text-[#dcb67a] dark:text-[#dcb67a]', isSelected ? 'text-primary' : '')} />
    ) : (
      <Folder className={cn('h-3.5 w-3.5 shrink-0 text-[#dcb67a] dark:text-[#dcb67a]', isSelected ? 'text-primary' : '')} />
    )
  ) : (
    getFileIcon(node.name, isSelected)
  );

  return (
    <div>
      {isPendingRename ? (
        <div
          className={cn(
            'flex items-center gap-1 rounded-md py-0.5 pr-2 text-xs',
            isSelected ? 'bg-primary/15 text-primary' : 'text-foreground'
          )}
          style={{ paddingLeft: rowPaddingLeft }}
        >
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground/80">
            {isDir ? (
              open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
            ) : null}
          </span>
          {rowIcon}
          <Input
            ref={pendingRenameInputRef}
            value={pendingRenameName}
            onChange={(event) => onPendingRenameNameChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCommitPendingRename?.();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelPendingRename?.();
              }
            }}
            className="h-7 text-xs"
          />
        </div>
      ) : (
        <BuildTooltip content={isDir ? `Toggle folder: ${node.relativePath}` : `Open file: ${node.relativePath}`} side="right" align="start">
          <button
            type="button"
            onClick={() => {
              if (pendingCreateType) {
                onCancelPendingCreate?.();
              }
              if (isDir) {
                onDirectoryInteract?.(node);
                setOpen((value) => !value);
              } else {
                onSelect(node);
              }
            }}
            onContextMenu={(event) => {
              if (pendingCreateType) {
                onCancelPendingCreate?.();
              }
              onContextMenu?.(event, node);
            }}
            className={cn(
              'w-full rounded-md py-0.5 pr-2 text-left text-xs transition-colors',
              isSelected ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              isCutEntry ? 'opacity-60' : null
            )}
            style={{ paddingLeft: rowPaddingLeft }}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground/80">
                {isDir ? (
                  open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                ) : null}
              </span>
              {rowIcon}
              <span className="truncate">{node.name}</span>
            </span>
          </button>
        </BuildTooltip>
      )}
      {isDir && open ? (
        <div className="ml-2 border-l border-border/50">
          {directoryChildren.map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
              collapseToken={collapseToken}
              pendingCreateType={pendingCreateType}
              pendingCreateName={pendingCreateName}
              pendingCreateParentPath={pendingCreateParentPath}
              onPendingCreateNameChange={onPendingCreateNameChange}
              onCommitPendingCreate={onCommitPendingCreate}
              onCancelPendingCreate={onCancelPendingCreate}
              onDirectoryInteract={onDirectoryInteract}
              pendingCreateInputRef={pendingCreateInputRef}
              pendingRenamePath={pendingRenamePath}
              pendingRenameName={pendingRenameName}
              onPendingRenameNameChange={onPendingRenameNameChange}
              onCommitPendingRename={onCommitPendingRename}
              onCancelPendingRename={onCancelPendingRename}
              pendingRenameInputRef={pendingRenameInputRef}
              onContextMenu={onContextMenu}
              clipboardEntry={clipboardEntry}
              currentWorkspaceRelativePath={currentWorkspaceRelativePath}
            />
          ))}
          {shouldRenderInlineCreate ? (
            <div className="flex items-center gap-1 py-1 pr-2" style={{ paddingLeft: childPaddingLeft }}>
              {pendingCreateType === 'file' ? (
                <FilePlus className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <FolderPlus className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
              <Input
                ref={pendingCreateInputRef}
                value={pendingCreateName}
                onChange={(event) => onPendingCreateNameChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onCommitPendingCreate?.();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancelPendingCreate?.();
                  }
                }}
                placeholder={pendingCreateType === 'file' ? 'filename.tsx' : 'new-folder'}
                className="h-7 text-xs"
              />
            </div>
          ) : null}
          {fileChildren.map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
              collapseToken={collapseToken}
              pendingCreateType={pendingCreateType}
              pendingCreateName={pendingCreateName}
              pendingCreateParentPath={pendingCreateParentPath}
              onPendingCreateNameChange={onPendingCreateNameChange}
              onCommitPendingCreate={onCommitPendingCreate}
              onCancelPendingCreate={onCancelPendingCreate}
              onDirectoryInteract={onDirectoryInteract}
              pendingCreateInputRef={pendingCreateInputRef}
              pendingRenamePath={pendingRenamePath}
              pendingRenameName={pendingRenameName}
              onPendingRenameNameChange={onPendingRenameNameChange}
              onCommitPendingRename={onCommitPendingRename}
              onCancelPendingRename={onCancelPendingRename}
              pendingRenameInputRef={pendingRenameInputRef}
              onContextMenu={onContextMenu}
              clipboardEntry={clipboardEntry}
              currentWorkspaceRelativePath={currentWorkspaceRelativePath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type BuildTerminalPaneProps = {
  accomplish: ReturnType<typeof getAccomplish>;
  agentId: string | null;
  session: BuildTerminalSessionSummary;
  layoutHeightToken: number;
  isActive: boolean;
  onActivate: () => void;
  onNewTerminal: () => void;
  onSplitTerminal: () => void;
  onClearTerminal: () => void;
  onInterruptTerminal: () => void;
};

type BuildAssistantMessageItemProps = {
  message: TaskMessage;
  copied: boolean;
  expandedToolMessage: boolean;
  proseClasses: string;
  onCopy: (messageId: string, content: string) => void;
  onToggleToolMessage: (messageId: string) => void;
  onContentRef: (messageId: string, element: HTMLDivElement | null) => void;
};

type BuildRuntimeLogRowProps = {
  entry: BuildLogEntry;
};

type BuildPromptComposerProps = {
  resetKey: number;
  initialValue: string;
  attachedFiles: string[];
  aiBusy: boolean;
  interruptingAiTask: boolean;
  autoRepairBusy: boolean;
  contextStats: ContextWindowEstimateResponse | null;
  onDraftChange: (value: string) => void;
  onRun: (value: string) => void;
  onStop: () => void;
  onAttachFiles: () => void;
  onRemoveFile: (filePath: string) => void;
  slashCommands: SlashCommandDefinition[];
};

const BuildTerminalPane = memo(function BuildTerminalPane({
  accomplish,
  agentId,
  session,
  layoutHeightToken,
  isActive,
  onActivate,
  onNewTerminal,
  onSplitTerminal,
  onClearTerminal,
  onInterruptTerminal,
}: BuildTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeToContainerRef = useRef<(() => void) | null>(null);
  const renderedSeqRef = useRef(0);
  const outputCursorRef = useRef(0);
  const followOutputRef = useRef(true);
  const onNewTerminalRef = useRef(onNewTerminal);
  const onSplitTerminalRef = useRef(onSplitTerminal);
  const onClearTerminalRef = useRef(onClearTerminal);
  const onInterruptTerminalRef = useRef(onInterruptTerminal);

  useEffect(() => {
    onNewTerminalRef.current = onNewTerminal;
  }, [onNewTerminal]);

  useEffect(() => {
    onSplitTerminalRef.current = onSplitTerminal;
  }, [onSplitTerminal]);

  useEffect(() => {
    onClearTerminalRef.current = onClearTerminal;
  }, [onClearTerminal]);

  useEffect(() => {
    onInterruptTerminalRef.current = onInterruptTerminal;
  }, [onInterruptTerminal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new XTermTerminal({
      allowTransparency: true,
      cursorBlink: true,
      convertEol: false,
      cursorStyle: 'bar',
      fontFamily: 'Consolas, "SFMono-Regular", Menlo, Monaco, "Liberation Mono", monospace',
      fontSize: 11,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: '#0b1220',
        foreground: '#f4f4f5',
        cursor: '#5eead4',
        cursorAccent: '#0b1220',
        selectionBackground: 'rgba(148, 163, 184, 0.28)',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    renderedSeqRef.current = 0;

    const resizeToContainer = () => {
      fitAddon.fit();
      if (!agentId) return;
      void accomplish.resizeBuildTerminalSession({
        agentId,
        sessionId: session.id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };
    resizeToContainerRef.current = resizeToContainer;

    const dataDisposable = terminal.onData((data) => {
      if (!agentId) return;
      followOutputRef.current = true;
      void accomplish.writeBuildTerminalInput({
        agentId,
        sessionId: session.id,
        input: data,
      });
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 't') {
        event.preventDefault();
        void onNewTerminalRef.current();
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'd') {
        event.preventDefault();
        void onSplitTerminalRef.current();
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'l') {
        event.preventDefault();
        void onClearTerminalRef.current();
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'c' && !terminal.hasSelection()) {
        event.preventDefault();
        void onInterruptTerminalRef.current();
        return false;
      }
      return true;
    });

    const scrollDisposable = terminal.onScroll(() => {
      followOutputRef.current = isTerminalNearBottom(terminal);
    });

    const resizeObserver = new ResizeObserver(() => {
      scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    });
    resizeObserver.observe(container);
    window.setTimeout(() => {
      scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    }, 0);
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(() => {
        if (!xtermRef.current) return;
        scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
      });
    }

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      scrollDisposable.dispose();
      fitAddonRef.current = null;
      resizeToContainerRef.current = null;
      xtermRef.current = null;
      outputCursorRef.current = 0;
      terminal.dispose();
    };
  }, [accomplish, agentId, session.id]);

  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal || !agentId) return;

    let cancelled = false;

    const appendEntries = (incomingEntries: BuildTerminalEntry[], reset = false) => {
      const instance = xtermRef.current;
      if (!instance) return;
      const hasIncomingEntries = incomingEntries.length > 0;
      const lastSeq = incomingEntries[incomingEntries.length - 1]?.seq || 0;
      const shouldReplayReset = reset && renderedSeqRef.current === 0 && hasIncomingEntries;
      const shouldSeqReset = hasIncomingEntries && lastSeq < renderedSeqRef.current;
      if (shouldReplayReset || shouldSeqReset) {
        instance.reset();
        renderedSeqRef.current = 0;
        outputCursorRef.current = 0;
      }
      const pendingEntries = incomingEntries.filter((entry) => entry.seq > renderedSeqRef.current);
      if (pendingEntries.length === 0) return;
      const shouldFollowOutput = followOutputRef.current || isTerminalNearBottom(instance);
      const pendingText = pendingEntries.map((entry) => entry.text).join('');
      renderedSeqRef.current = pendingEntries[pendingEntries.length - 1]?.seq || renderedSeqRef.current;
      outputCursorRef.current = renderedSeqRef.current;
      instance.write(pendingText, () => {
        if (shouldFollowOutput) {
          followOutputRef.current = true;
          scheduleTerminalScrollToBottom(instance);
        }
      });
    };

    const syncOutput = async (reset = false) => {
      try {
        const response = await accomplish.getBuildTerminalOutput({
          agentId,
          sessionId: session.id,
          cursor: reset ? 0 : outputCursorRef.current,
          limit: 800,
        });
        if (cancelled) return;
        appendEntries(response.entries, reset);
        outputCursorRef.current = Math.max(outputCursorRef.current, response.nextCursor);
      } catch {
        // Ignore transient terminal sync errors.
      }
    };

    const unsubscribe = accomplish.onBuildTerminalEntry((payload) => {
      if (payload.agentId !== agentId || payload.sessionId !== session.id) return;
      appendEntries([payload.entry]);
      outputCursorRef.current = Math.max(outputCursorRef.current, payload.entry.seq);
    });

    void syncOutput(true);

    const interval = window.setInterval(() => {
      void syncOutput(false);
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [accomplish, agentId, session.id]);

  useEffect(() => {
    const resizeToContainer = resizeToContainerRef.current;
    const terminal = xtermRef.current;
    if (!resizeToContainer || !terminal) return;
    const timeout = window.setTimeout(() => {
      scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [layoutHeightToken]);

  useEffect(() => {
    if (!isActive) return;
    const terminal = xtermRef.current;
    const resizeToContainer = resizeToContainerRef.current;
    if (!terminal || !resizeToContainer) return;
    scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    terminal.focus();
  }, [isActive]);

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0b1220]',
        isActive ? 'ring-1 ring-emerald-400/30' : 'ring-1 ring-transparent'
      )}
      onMouseDown={onActivate}
    >
      <div className={cn(
        'flex items-center justify-between border-b px-2 py-1 text-[11px]',
        isActive ? 'border-emerald-400/20 bg-emerald-400/5 text-foreground' : 'border-border/40 bg-background/5 text-muted-foreground'
      )}>
        <span className="truncate">{session.title}</span>
        <span className="truncate text-[10px] opacity-80">{pathLeaf(session.cwd)}</span>
      </div>
      <div
        ref={containerRef}
        className="relative h-full min-h-0 flex-1 overflow-hidden pl-2 pt-1"
        onClick={() => {
          onActivate();
          xtermRef.current?.focus();
        }}
      />
    </div>
  );
}, (prev, next) => (
  prev.accomplish === next.accomplish
  && prev.agentId === next.agentId
  && prev.layoutHeightToken === next.layoutHeightToken
  && prev.isActive === next.isActive
  && prev.session.id === next.session.id
  && prev.session.title === next.session.title
  && prev.session.shellLabel === next.session.shellLabel
  && prev.session.cwd === next.session.cwd
  && prev.session.workspaceRelativePath === next.session.workspaceRelativePath
  && prev.session.running === next.session.running
  && prev.session.pid === next.session.pid
));

const BuildAssistantMessageItem = memo(function BuildAssistantMessageItem({
  message,
  copied,
  expandedToolMessage,
  proseClasses,
  onCopy,
  onToggleToolMessage,
  onContentRef,
}: BuildAssistantMessageItemProps) {
  const planItems = parsePlanItemsFromAssistantContent(message.content || '');
  const isUserPanelMessage = message.type === 'user' && !isBuildModeGoalPanelMessage(message);
  const isToolMessage = message.type === 'tool';
  const toolPreview = isToolMessage ? getCollapsedToolMessageContent(message.content || '') : null;
  const renderedToolContent = isToolMessage && !expandedToolMessage && toolPreview
    ? toolPreview.preview
    : (message.content || '');
  const canExpandToolMessage = Boolean(isToolMessage && toolPreview?.truncated);

  return (
    <div
      className={cn(
        'group rounded-md border border-border/60 bg-background px-2 py-1.5',
        isUserPanelMessage ? 'ml-3 border-primary/35 bg-primary/10' : null,
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div
          className={cn(
            'text-[11px] uppercase tracking-wide text-muted-foreground',
            isUserPanelMessage ? 'text-primary/90' : null,
          )}
        >
          {formatBuildAssistantPanelMessageType(message)}
        </div>
        <BuildTooltip content={copied ? 'Copied' : 'Copy message'}>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground/80 opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            onClick={() => onCopy(message.id, message.content || '')}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </BuildTooltip>
      </div>
      <div
        ref={(element) => {
          onContentRef(message.id, element);
        }}
      >
        {!planItems ? (
          <div className={proseClasses}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {renderedToolContent}
            </ReactMarkdown>
            {canExpandToolMessage ? (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => onToggleToolMessage(message.id)}
                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  {expandedToolMessage ? 'Show less' : 'Show full tool message'}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            {planItems.map((item) => (
              <div key={`${message.id}:${item.id}:${item.content}`} className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
                <div className="mt-0.5 shrink-0">{renderPlanStatusIcon(item.status)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-foreground">{item.content}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded border border-border/60 bg-background px-1 py-0.5">#{item.id}</span>
                    <span className="rounded border border-border/60 bg-background px-1 py-0.5">{formatPlanStatusLabel(item.status)}</span>
                    {item.priority ? (
                      <span className="rounded border border-border/60 bg-background px-1 py-0.5">priority {item.priority}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.message === next.message
  && prev.copied === next.copied
  && prev.expandedToolMessage === next.expandedToolMessage
  && prev.proseClasses === next.proseClasses
  && prev.onCopy === next.onCopy
  && prev.onToggleToolMessage === next.onToggleToolMessage
  && prev.onContentRef === next.onContentRef
));

const BuildRuntimeLogRow = memo(function BuildRuntimeLogRow({ entry }: BuildRuntimeLogRowProps) {
  return (
    <div className="whitespace-pre-wrap break-words">
      <span className="text-muted-foreground">[{new Date(entry.at).toLocaleTimeString()}] {formatStream(entry.stream)}</span>{' '}
      <span className={entry.stream === 'stderr' ? 'text-destructive' : ''}>{entry.line}</span>
    </div>
  );
}, (prev, next) => prev.entry === next.entry);

const BuildPromptComposer = memo(function BuildPromptComposer({
  resetKey,
  initialValue,
  attachedFiles,
  aiBusy,
  interruptingAiTask,
  autoRepairBusy,
  contextStats,
  onDraftChange,
  onRun,
  onStop,
  onAttachFiles,
  onRemoveFile,
  slashCommands,
}: BuildPromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef(initialValue);
  const syncTimeoutRef = useRef<number | null>(null);
  const [inputValue, setInputValue] = useState(initialValue);
  const [canRun, setCanRun] = useState(Boolean(initialValue.trim()));
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  useEffect(() => {
    draftRef.current = initialValue;
    setInputValue(initialValue);
    setCanRun(Boolean(initialValue.trim()));
    if (textareaRef.current && textareaRef.current.value !== initialValue) {
      textareaRef.current.value = initialValue;
    }
  }, [resetKey]);

  useEffect(() => () => {
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  }, []);

  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(inputValue, slashCommands),
    [inputValue, slashCommands]
  );

  useEffect(() => {
    setSelectedSlashIndex((current) => {
      if (filteredSlashCommands.length === 0) return 0;
      return Math.min(current, filteredSlashCommands.length - 1);
    });
  }, [filteredSlashCommands]);

  const handleChange = useCallback((event: { target: HTMLTextAreaElement }) => {
    const next = event.target.value;
    draftRef.current = next;
    setInputValue(next);
    setCanRun(Boolean(next.trim()));
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    syncTimeoutRef.current = window.setTimeout(() => {
      syncTimeoutRef.current = null;
      onDraftChange(draftRef.current);
    }, 240);
  }, [onDraftChange]);

  const handleRun = useCallback(() => {
    const rawValue = textareaRef.current?.value ?? draftRef.current;
    const next = rawValue.trim();
    if (!next || aiBusy) return;
    onRun(next);
    draftRef.current = '';
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.value = '';
    }
    setCanRun(false);
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    onDraftChange('');
  }, [aiBusy, onDraftChange, onRun]);

  const handleExecuteSlashCommand = useCallback(async (command: SlashCommandDefinition) => {
    await command.execute();
    draftRef.current = '';
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.value = '';
    }
    setCanRun(false);
    setSelectedSlashIndex(0);
    if (syncTimeoutRef.current !== null) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    onDraftChange('');
  }, [onDraftChange]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          defaultValue={initialValue}
          onChange={handleChange}
          onKeyDown={(event) => {
            if (filteredSlashCommands.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedSlashIndex((current) => (
                  current >= filteredSlashCommands.length - 1 ? 0 : current + 1
                ));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedSlashIndex((current) => (
                  current <= 0 ? filteredSlashCommands.length - 1 : current - 1
                ));
                return;
              }
              if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                event.preventDefault();
                const selected = filteredSlashCommands[selectedSlashIndex] || filteredSlashCommands[0];
                if (selected) {
                  void handleExecuteSlashCommand(selected);
                }
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                draftRef.current = '';
                setInputValue('');
                if (textareaRef.current) {
                  textareaRef.current.value = '';
                }
                setCanRun(false);
                setSelectedSlashIndex(0);
                onDraftChange('');
              }
            }
          }}
          placeholder="Describe the software task at a high level. AI will plan, edit files, run checks, and iterate."
          className="min-h-[88px] pb-10 text-sm bg-background dark:bg-input/15"
        />
        <InlineSlashCommandMenu
          commands={filteredSlashCommands}
          selectedIndex={selectedSlashIndex}
          placement="top"
          onSelect={(command, index) => {
            setSelectedSlashIndex(index);
            void handleExecuteSlashCommand(command);
          }}
        />
        <button
          type="button"
          onClick={onAttachFiles}
          className="absolute bottom-2 left-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Attach files to this build prompt."
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {attachedFiles.length > 0 ? (
          <span className="absolute bottom-1.5 left-8 rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
            {attachedFiles.length}
          </span>
        ) : null}
      </div>
      {attachedFiles.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachedFiles.map((filePath) => (
            <div
              key={filePath}
              className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs text-foreground"
            >
              <FileText className="h-3 w-3 shrink-0 text-primary" />
              <span className="max-w-[260px] truncate" title={filePath}>
                {filePath.split(/[\\/]/).pop() || filePath}
              </span>
              <button
                type="button"
                onClick={() => onRemoveFile(filePath)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Remove file"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleRun}
          disabled={aiBusy || !canRun}
          title={aiBusy ? 'AI is currently executing the active build task.' : 'Run an AI build task using your goal prompt.'}
        >
          {aiBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wrench className="h-4 w-4 mr-1.5" />}
          {aiBusy ? 'AI Working' : 'Run AI Task'}
        </Button>
        {aiBusy ? (
          <Button
            variant="outline"
            onClick={onStop}
            disabled={interruptingAiTask}
            title={interruptingAiTask ? 'Stopping the current build task…' : 'Stop the current build task.'}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {interruptingAiTask ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4 fill-current" />}
            {interruptingAiTask ? 'Stopping' : 'Stop Task'}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <ContextWindowIndicator stats={contextStats} className="mb-0" />
        {autoRepairBusy ? <span className="pt-1 text-xs text-muted-foreground">Auto-repair queued…</span> : null}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.resetKey === next.resetKey
  && prev.initialValue === next.initialValue
  && prev.aiBusy === next.aiBusy
  && prev.interruptingAiTask === next.interruptingAiTask
  && prev.autoRepairBusy === next.autoRepairBusy
  && prev.contextStats === next.contextStats
  && prev.onDraftChange === next.onDraftChange
  && prev.onRun === next.onRun
  && prev.onStop === next.onStop
  && prev.onAttachFiles === next.onAttachFiles
  && prev.onRemoveFile === next.onRemoveFile
  && prev.slashCommands === next.slashCommands
  && prev.attachedFiles.length === next.attachedFiles.length
  && prev.attachedFiles.every((entry, index) => entry === next.attachedFiles[index])
));

function isTerminalNearBottom(terminal: XTermTerminal): boolean {
  const buffer = terminal.buffer.active;
  return (buffer.baseY - buffer.viewportY) <= 1;
}

function scheduleTerminalScrollToBottom(terminal: XTermTerminal): void {
  const syncViewport = () => {
    terminal.scrollToBottom();
    const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null | undefined;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  };
  syncViewport();
  window.requestAnimationFrame(() => {
    syncViewport();
    window.setTimeout(() => {
      syncViewport();
    }, 0);
  });
}

function scheduleTerminalRefit(
  resizeToContainer: () => void,
  terminal: XTermTerminal,
  shouldFollowOutput: boolean,
): void {
  const run = () => {
    resizeToContainer();
    if (shouldFollowOutput) {
      scheduleTerminalScrollToBottom(terminal);
    }
  };
  run();
  window.requestAnimationFrame(() => {
    run();
    window.setTimeout(run, 80);
  });
}

function areBuildStartEntriesEqual(a: BuildStartEntry[] | undefined, b: BuildStartEntry[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return entry.command === other?.command
      && entry.workspaceRelativePath === other?.workspaceRelativePath
      && entry.role === other?.role;
  });
}

function areBuildSnapshotsEquivalent(a: BuildSessionSnapshot | null, b: BuildSessionSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.agentId === b.agentId
    && a.workspaceRoot === b.workspaceRoot
    && a.workspaceRelativePath === b.workspaceRelativePath
    && a.detection.runtimeAdapterId === b.detection.runtimeAdapterId
    && a.detection.projectType === b.detection.projectType
    && a.detection.category === b.detection.category
    && a.detection.previewStrategy === b.detection.previewStrategy
    && a.detection.packageManager === b.detection.packageManager
    && a.detection.requiresPort === b.detection.requiresPort
    && a.detection.defaultPort === b.detection.defaultPort
    && a.detection.healthCheckPath === b.detection.healthCheckPath
    && a.detection.commands.startCommand === b.detection.commands.startCommand
    && a.detection.commands.buildCommand === b.detection.commands.buildCommand
    && a.detection.commands.runCommand === b.detection.commands.runCommand
    && areBuildStartEntriesEqual(a.detection.commands.startEntries, b.detection.commands.startEntries)
    && a.runtime.status === b.runtime.status
    && a.runtime.mode === b.runtime.mode
    && a.runtime.buildStatus === b.runtime.buildStatus
    && a.runtime.activeCommand === b.runtime.activeCommand
    && areBuildStartEntriesEqual(a.runtime.activeStartEntries, b.runtime.activeStartEntries)
    && a.runtime.pid === b.runtime.pid
    && a.runtime.port === b.runtime.port
    && a.runtime.previewUrl === b.runtime.previewUrl
    && a.runtime.lastExitCode === b.runtime.lastExitCode
    && a.runtime.lastExitSignal === b.runtime.lastExitSignal
    && a.runtime.restartCount === b.runtime.restartCount
    && a.runtime.crashCount === b.runtime.crashCount
    && a.runtime.autoRestart === b.runtime.autoRestart
    && a.runtime.healthy === b.runtime.healthy
    && a.runtime.healthMessage === b.runtime.healthMessage
    && a.runtime.lastError === b.runtime.lastError
    && a.runtime.suggestedRepairPrompt === b.runtime.suggestedRepairPrompt
    && a.runtime.autoRepairRequestedAt === b.runtime.autoRepairRequestedAt;
}

function areBuildTerminalSnapshotsEquivalent(a: BuildTerminalSnapshot | null, b: BuildTerminalSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.agentId !== b.agentId || a.activeSessionId !== b.activeSessionId || a.sessions.length !== b.sessions.length) {
    return false;
  }
  return a.sessions.every((session, index) => {
    const other = b.sessions[index];
    return session.id === other?.id
      && session.title === other?.title
      && session.shellLabel === other?.shellLabel
      && session.cwd === other?.cwd
      && session.workspaceRelativePath === other?.workspaceRelativePath
      && session.running === other?.running
      && session.pid === other?.pid;
  });
}

export default function BuildPage() {
  const accomplish = getAccomplish();
  const navigate = useNavigate();
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  const { activeAgentId, agents, loadAgents } = useAgentStore();
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);

  const [workspaceRelativePath, setWorkspaceRelativePath] = useState('.');
  const [agentWorkspaceRoot, setAgentWorkspaceRoot] = useState<string | null>(null);
  const [presets, setPresets] = useState<BuildProjectPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | undefined>(undefined);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [workspacePathReady, setWorkspacePathReady] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [presetStartEntriesInput, setPresetStartEntriesInput] = useState<EditableBuildStartEntry[]>([]);
  const [presetBuildCommandInput, setPresetBuildCommandInput] = useState('');
  const [presetRunCommandInput, setPresetRunCommandInput] = useState('');
  const [presetEnvProfiles, setPresetEnvProfiles] = useState<BuildEnvProfile[]>([createDefaultEnvProfile()]);
  const [presetActiveEnvProfileId, setPresetActiveEnvProfileId] = useState<string | undefined>(undefined);
  const [presetEnvEditorText, setPresetEnvEditorText] = useState('');
  const [snapshot, setSnapshot] = useState<BuildSessionSnapshot | null>(null);
  const [globalSelectedModel, setGlobalSelectedModel] = useState<SelectedModel | null>(null);
  const [modelProviders, setModelProviders] = useState<ProviderConfig[]>([]);
  const [modelApiKeyStatus, setModelApiKeyStatus] = useState<Record<string, { exists: boolean; prefix?: string }>>({});
  const [logs, setLogs] = useState<BuildLogEntry[]>([]);
  const [terminalSnapshot, setTerminalSnapshot] = useState<BuildTerminalSnapshot | null>(null);
  const [logCursor, setLogCursor] = useState(0);
  const [workspaceTree, setWorkspaceTree] = useState<BuildFileTreeNode | null>(null);
  const [editorTabs, setEditorTabs] = useState<BuildEditorTab[]>([]);
  const [activeEditorTabKey, setActiveEditorTabKey] = useState<string | null>(null);
  const [centerPanelView, setCenterPanelView] = useState<'preview' | 'editor'>('preview');
  const [diff, setDiff] = useState<BuildWorkspaceDiff | null>(null);
  const [buildDiffEnforcementMode, setBuildDiffEnforcementMode] = useState<BuildDiffEnforcementMode>('preview-only');
  const [pendingDiffBaselineId, setPendingDiffBaselineId] = useState<string | null>(null);
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<string | null>(null);
  const [diffCollapsed, setDiffCollapsed] = useState(false);
  const [resolvingDiffDecision, setResolvingDiffDecision] = useState<'approve' | 'reject' | null>(null);
  const [workspaceFingerprint, setWorkspaceFingerprint] = useState<BuildWorkspaceFingerprint | null>(null);
  const [fingerprintBusy, setFingerprintBusy] = useState(false);
  const [goalPrompt, setGoalPrompt] = useState('');
  const [promptAttachedFiles, setPromptAttachedFiles] = useState<string[]>([]);
  const [contextStats, setContextStats] = useState<ContextWindowEstimateResponse | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyArchivedOnly, setHistoryArchivedOnly] = useState(false);
  const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historySessions, setHistorySessions] = useState<BuildTaskSessionListItem[]>([]);
  const [activeHistorySessionId, setActiveHistorySessionId] = useState<string | null>(null);
  const [activeHistoryRunTaskId, setActiveHistoryRunTaskId] = useState<string | null>(null);
  const [activeHistorySessionToken, setActiveHistorySessionToken] = useState<string | null>(null);
  const [buildHistorySessionStateReady, setBuildHistorySessionStateReady] = useState(false);
  const [aiTaskId, setAiTaskId] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<TaskMessage[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [interruptingAiTask, setInterruptingAiTask] = useState(false);
  const [subagentRuns, setSubagentRuns] = useState<SubagentRunRecord[]>([]);
  const [subagentTree, setSubagentTree] = useState<SubagentRunTreeNode[]>([]);
  const [subagentRunsLoading, setSubagentRunsLoading] = useState(false);
  const [subagentsCollapsed, setSubagentsCollapsed] = useState(false);
  const [stoppingSubagentRunId, setStoppingSubagentRunId] = useState<string | null>(null);
  const [subagentDetailRun, setSubagentDetailRun] = useState<SubagentRunRecord | null>(null);
  const [subagentDetailTask, setSubagentDetailTask] = useState<Task | null>(null);
  const [subagentDetailLoading, setSubagentDetailLoading] = useState(false);
  const [subagentDetailPrompt, setSubagentDetailPrompt] = useState('');
  const [subagentDetailModelOverride, setSubagentDetailModelOverride] = useState('');
  const [subagentDetailSending, setSubagentDetailSending] = useState(false);
  const [subagentDetailMutating, setSubagentDetailMutating] = useState(false);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
  const [expandedToolMessageIds, setExpandedToolMessageIds] = useState<Record<string, boolean>>({});
  const [assistantNearBottom, setAssistantNearBottom] = useState(true);
  const [autoRestart, setAutoRestart] = useState(true);
  const [autoRepairEnabled, setAutoRepairEnabled] = useState(true);
  const [autoRepairBusy, setAutoRepairBusy] = useState(false);
  const [lastRepairFingerprint, setLastRepairFingerprint] = useState('');
  const availableSubagentModelOptions = useMemo(() => (
    modelProviders
      .filter((provider) => {
        const hasModels = Array.isArray(provider.models) && provider.models.length > 0;
        if (!hasModels) return false;
        if (provider.requiresApiKey === false || provider.id === 'ollama') return true;
        return Boolean(modelApiKeyStatus?.[provider.id]?.exists);
      })
      .flatMap((provider) => provider.models.map((model) => ({
        value: model.fullId,
        providerId: String(provider.id),
        providerName: provider.name,
        displayName: model.displayName,
        modelId: model.fullId,
        baseUrl: provider.baseUrl,
      })))
  ), [modelApiKeyStatus, modelProviders]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [promptComposerResetKey, setPromptComposerResetKey] = useState(0);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [buildFingerprintCollapsed, setBuildFingerprintCollapsed] = useState(false);
  const [terminalSectionHidden, setTerminalSectionHidden] = useState(false);
  const [runtimeLogsSectionHidden, setRuntimeLogsSectionHidden] = useState(false);
  const [buildLowerPanelHeight, setBuildLowerPanelHeight] = useState(192);

  const [pendingWorkspaceCreateType, setPendingWorkspaceCreateType] = useState<'file' | 'folder' | null>(null);
  const [pendingWorkspaceCreateName, setPendingWorkspaceCreateName] = useState('');
  const [pendingWorkspaceCreateParentPath, setPendingWorkspaceCreateParentPath] = useState<string | null>(null);
  const [pendingWorkspaceRenamePath, setPendingWorkspaceRenamePath] = useState<string | null>(null);
  const [pendingWorkspaceRenameName, setPendingWorkspaceRenameName] = useState('');
  const [workspaceTreeContextMenu, setWorkspaceTreeContextMenu] = useState<WorkspaceTreeContextMenuState | null>(null);
  const [workspaceTreeClipboardEntry, setWorkspaceTreeClipboardEntry] = useState<WorkspaceTreeClipboardEntry | null>(null);
  const [lastWorkspaceDirectoryPath, setLastWorkspaceDirectoryPath] = useState<string | null>(null);
  const [collapseWorkspaceTreeToken, setCollapseWorkspaceTreeToken] = useState(0);
  const [terminalPaneSessionIds, setTerminalPaneSessionIds] = useState<string[]>([]);
  const [draggingPresetStartEntryId, setDraggingPresetStartEntryId] = useState<string | null>(null);
  const [workspacePathBlockedDialog, setWorkspacePathBlockedDialog] = useState<WorkspacePathBlockedDialogState | null>(null);
  const [workspacePathBlockedBusy, setWorkspacePathBlockedBusy] = useState(false);
  const [presetWorkspaceConfirmDialog, setPresetWorkspaceConfirmDialog] = useState<PresetWorkspaceConfirmDialogState | null>(null);
  const [buildHoverTooltip, setBuildHoverTooltip] = useState<BuildHoverTooltipState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildPageRef = useRef<HTMLDivElement | null>(null);
  const terminalSnapshotRequestIdRef = useRef(0);
  const assistantMessagesVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const assistantMessageContentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const restoringHistoryRef = useRef(false);
  const pendingHistoryRestoreScrollRef = useRef(false);
  const historyRowRef = useRef<HTMLDivElement | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const assistantNearBottomRef = useRef(true);
  const restoringEditorLayoutRef = useRef(false);
  const pendingWorkspaceCreateInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkspaceRenameInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceTreeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const centerColumnRef = useRef<HTMLDivElement | null>(null);
  const buildLowerPanelHeightRef = useRef(buildLowerPanelHeight);
  const goalPromptDraftRef = useRef('');
  const aiMessagesRef = useRef<TaskMessage[]>([]);
  const restoreHistorySessionRef = useRef<(sessionId: string) => Promise<void>>(async () => {});
  const activeBuildTooltipElementRef = useRef<HTMLElement | null>(null);
  const runAiGoalActionRef = useRef<(value: string) => void>(() => {});
  const interruptBuildTaskActionRef = useRef<() => void>(() => {});

  useEffect(() => {
    const root = buildPageRef.current;
    if (!root) return;

    const resolveTooltipElement = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const element = target.closest(`[${BUILD_HOVER_TOOLTIP_ATTR}], [title]`);
      if (!(element instanceof HTMLElement)) return null;

      const title = element.getAttribute('title');
      if (title && !element.hasAttribute(BUILD_HOVER_TOOLTIP_ATTR)) {
        element.setAttribute(BUILD_HOVER_TOOLTIP_ATTR, title);
        element.removeAttribute('title');
      }

      return element;
    };

    const updateTooltipTarget = (target: EventTarget | null) => {
      const element = resolveTooltipElement(target);
      if (!element) {
        activeBuildTooltipElementRef.current = null;
        setBuildHoverTooltip(null);
        return;
      }

      const content = element.getAttribute(BUILD_HOVER_TOOLTIP_ATTR);
      if (!content) {
        activeBuildTooltipElementRef.current = null;
        setBuildHoverTooltip(null);
        return;
      }

      if (activeBuildTooltipElementRef.current === element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      activeBuildTooltipElementRef.current = element;
      setBuildHoverTooltip({
        content,
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    };

    const handleMouseOver = (event: MouseEvent) => {
      updateTooltipTarget(event.target);
    };
    const handleMouseOut = (event: MouseEvent) => {
      const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      const currentTarget = event.target instanceof Element
        ? resolveTooltipElement(event.target)
        : null;
      if (!currentTarget) {
        activeBuildTooltipElementRef.current = null;
        setBuildHoverTooltip(null);
        return;
      }
      if (relatedTarget && currentTarget.contains(relatedTarget)) {
        return;
      }
      activeBuildTooltipElementRef.current = null;
      setBuildHoverTooltip(null);
    };
    const handleScroll = () => {
      if (!activeBuildTooltipElementRef.current) return;
      activeBuildTooltipElementRef.current = null;
      setBuildHoverTooltip(null);
    };

    root.addEventListener('mouseover', handleMouseOver);
    root.addEventListener('mouseout', handleMouseOut);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      root.removeEventListener('mouseover', handleMouseOver);
      root.removeEventListener('mouseout', handleMouseOut);
      window.removeEventListener('scroll', handleScroll, true);
      activeBuildTooltipElementRef.current = null;
      setBuildHoverTooltip(null);
    };
  }, []);

  useEffect(() => {
    aiMessagesRef.current = aiMessages;
  }, [aiMessages]);

  const assistantMessages = useMemo(() => collectAssistantMessages(aiMessages), [aiMessages]);

  const scrollAssistantMessagesToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    if (assistantMessages.length === 0) return;
    assistantMessagesVirtuosoRef.current?.scrollToIndex({
      index: assistantMessages.length - 1,
      align: 'end',
      behavior,
    });
    assistantNearBottomRef.current = true;
    setAssistantNearBottom(true);
  }, [assistantMessages.length]);

  const currentWorkspacePathKey = useMemo(
    () => normalizeWorkspacePathKey(workspaceRelativePath),
    [workspaceRelativePath]
  );
  const workspaceMatchedPreset = useMemo(
    () => presets.find((preset) => normalizeWorkspacePathKey(preset.workspaceRelativePath) === currentWorkspacePathKey) ?? null,
    [currentWorkspacePathKey, presets]
  );
  const selectedPreset = useMemo(() => {
    const explicitPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
    if (explicitPreset && normalizeWorkspacePathKey(explicitPreset.workspaceRelativePath) === currentWorkspacePathKey) {
      return explicitPreset;
    }
    return workspaceMatchedPreset;
  }, [currentWorkspacePathKey, presets, selectedPresetId, workspaceMatchedPreset]);
  const workspaceFolderName = useMemo(() => {
    if (snapshot?.workspaceRoot) return pathLeaf(snapshot.workspaceRoot);
    return pathLeaf(workspaceRelativePath);
  }, [snapshot?.workspaceRoot, workspaceRelativePath]);
  const workspaceFolderChosen = useMemo(
    () => canonicalizeWorkspaceRelativePath(workspaceRelativePath) !== '.',
    [workspaceRelativePath]
  );
  const normalizedCurrentWorkspacePath = useMemo(
    () => canonicalizeWorkspaceRelativePath(workspaceRelativePath),
    [workspaceRelativePath]
  );
  const buildEditorLayoutStorageKey = useMemo(
    () => (activeAgentId ? getBuildEditorLayoutStorageKey(activeAgentId) : null),
    [activeAgentId]
  );
  const buildViewStateStorageKey = useMemo(
    () => (activeAgentId ? getBuildViewStateStorageKey(activeAgentId) : null),
    [activeAgentId]
  );
  const buildActiveHistorySessionStorageKey = useMemo(
    () => (activeAgentId ? getBuildActiveHistorySessionStorageKey(activeAgentId) : null),
    [activeAgentId]
  );
  const hiddenBuildSections = useMemo(() => {
    const hidden: string[] = [];
    if (terminalSectionHidden) hidden.push('Terminal');
    if (runtimeLogsSectionHidden) hidden.push('Runtime Logs');
    return hidden;
  }, [runtimeLogsSectionHidden, terminalSectionHidden]);
  const activeTerminalSession = useMemo(
    () => terminalSnapshot?.sessions.find((session) => session.id === terminalSnapshot.activeSessionId) || null,
    [terminalSnapshot]
  );
  const terminalPaneSessions = useMemo(() => {
    const sessions = terminalSnapshot?.sessions || [];
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const resolved = terminalPaneSessionIds
      .map((sessionId) => byId.get(sessionId) || null)
      .filter((session): session is BuildTerminalSessionSummary => Boolean(session));
    return resolved;
  }, [terminalPaneSessionIds, terminalSnapshot?.sessions]);
  const effectiveSelectedModel = activeAgent?.selectedModel ?? globalSelectedModel;
  const modelBadgeLabel = useMemo(
    () => formatSelectedModelBadgeLabel(effectiveSelectedModel),
    [effectiveSelectedModel]
  );
  const selectedDiffFile = useMemo(() => {
    const files = diff?.files || [];
    if (files.length === 0) return null;
    if (selectedDiffFilePath) {
      const hit = files.find((entry) => entry.relativePath === selectedDiffFilePath);
      if (hit) return hit;
    }
    return files[0] || null;
  }, [diff?.files, selectedDiffFilePath]);
  const activeEditorTab = useMemo(
    () => editorTabs.find((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === activeEditorTabKey) || null,
    [activeEditorTabKey, editorTabs]
  );
  const activeEditorTabIsFromCurrentWorkspace = useMemo(
    () => (!activeEditorTab ? true : canonicalizeWorkspaceRelativePath(activeEditorTab.workspaceRelativePath) === normalizedCurrentWorkspacePath),
    [activeEditorTab, normalizedCurrentWorkspacePath]
  );
  const selectedFileEditorExtensions = useMemo(() => {
    const languageExtensions = getEditorLanguageExtensions(activeEditorTab?.node.relativePath);
    return [
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-editor': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
      ...languageExtensions,
    ];
  }, [activeEditorTab?.node.relativePath]);
  const parsedPresetStartEntries = useMemo(
    () => parseEditableStartEntries(presetStartEntriesInput),
    [presetStartEntriesInput]
  );

  const clampBuildLowerPanelHeight = useCallback((nextHeight: number, containerHeight?: number) => {
    const resolvedContainerHeight = containerHeight ?? centerColumnRef.current?.clientHeight ?? 0;
    if (resolvedContainerHeight <= 0) {
      return Math.max(BUILD_LOWER_PANEL_MIN_HEIGHT, nextHeight);
    }
    const maxHeight = Math.max(
      BUILD_LOWER_PANEL_MIN_HEIGHT,
      resolvedContainerHeight - BUILD_CENTER_PANEL_MIN_HEIGHT - BUILD_CENTER_PANEL_SPLITTER_HEIGHT
    );
    return Math.min(Math.max(nextHeight, BUILD_LOWER_PANEL_MIN_HEIGHT), maxHeight);
  }, []);

  const handleBuildCenterPanelResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (terminalSectionHidden && runtimeLogsSectionHidden) return;
    const containerHeight = centerColumnRef.current?.clientHeight ?? 0;
    const startHeight = buildLowerPanelHeightRef.current;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - event.clientY;
      setBuildLowerPanelHeight(clampBuildLowerPanelHeight(startHeight - deltaY, containerHeight));
    };

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [clampBuildLowerPanelHeight, runtimeLogsSectionHidden, terminalSectionHidden]);

  useEffect(() => {
    buildLowerPanelHeightRef.current = buildLowerPanelHeight;
  }, [buildLowerPanelHeight]);

  useEffect(() => {
    if (terminalSectionHidden && runtimeLogsSectionHidden) return;
    const syncLowerPanelHeight = () => {
      setBuildLowerPanelHeight((current) => clampBuildLowerPanelHeight(current));
    };
    syncLowerPanelHeight();
    window.addEventListener('resize', syncLowerPanelHeight);
    return () => window.removeEventListener('resize', syncLowerPanelHeight);
  }, [clampBuildLowerPanelHeight, runtimeLogsSectionHidden, terminalSectionHidden]);
  const diffEmptyReason = useMemo(() => {
    if (!diff) return 'Diff is loading.';
    const hasFiles = (diff.files?.length || 0) > 0;
    const hasPatch = Boolean(diff.patch && diff.patch.trim().length > 0);
    if (hasFiles || hasPatch) return '';

    if (diff.mode === 'synthetic') {
      if (pendingDiffBaselineId) {
        return aiBusy
          ? 'No changes detected yet since baseline capture. Diff will update live as files are edited.'
          : 'No text-file changes detected since baseline capture.';
      }
      return 'No baseline is active for this run. Start a new AI task in Preview/Approval mode to capture a baseline.';
    }

    if (diff.mode === 'git') {
      return 'Git reports no local file changes in the selected workspace.';
    }

    if (buildDiffEnforcementMode === 'auto-apply') {
      return 'Auto-apply mode does not capture synthetic baselines. Enable Preview only or Approval mode to always see before/after diffs.';
    }

    if (diff.available === false && /No Git repository detected/i.test(diff.summary || '')) {
      return 'No Git repository detected and no synthetic baseline is active. Run a new AI task to capture synthetic diff, or initialize Git in this workspace.';
    }

    return 'No patch available for the current workspace state.';
  }, [aiBusy, buildDiffEnforcementMode, diff, pendingDiffBaselineId]);

  const activeEnvProfile = useMemo(() => {
    if (!selectedPreset) return null;
    const preferredId = presetActiveEnvProfileId || selectedPreset.activeEnvProfileId || selectedPreset.envProfiles[0]?.id;
    return selectedPreset.envProfiles.find((profile) => profile.id === preferredId) || selectedPreset.envProfiles[0] || null;
  }, [presetActiveEnvProfileId, selectedPreset]);

  const effectiveEnvOverrides = useMemo(
    () => (activeEnvProfile?.variables && Object.keys(activeEnvProfile.variables).length > 0 ? activeEnvProfile.variables : undefined),
    [activeEnvProfile]
  );

  const refreshHistorySessions = useCallback(async (query?: string) => {
    if (!activeAgentId) return;
    setHistoryBusy(true);
    try {
      const result = await accomplish.listBuildTaskHistorySessions({
        agentId: activeAgentId,
        query: (query ?? historyQuery) || undefined,
        includeArchived: true,
        limit: 80,
      });
      setHistorySessions(result.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistoryBusy(false);
    }
  }, [accomplish, activeAgentId, historyQuery]);

  const subagentParentTaskId = aiTaskId || activeHistoryRunTaskId;

  const refreshSubagentRuns = useCallback(async (showLoading = false) => {
    if (!subagentParentTaskId) {
      setSubagentRuns([]);
      setSubagentTree([]);
      setSubagentRunsLoading(false);
      return;
    }
    if (showLoading) {
      setSubagentRunsLoading(true);
    }
    try {
      const result = await accomplish.listSubagents({ parentTaskId: subagentParentTaskId });
      setSubagentRuns((current) => areSubagentRunListsEquivalent(current, result.runs || []) ? current : (result.runs || []));
      setSubagentTree((current) => areSubagentRunTreesEquivalent(current, result.tree || []) ? current : (result.tree || []));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (showLoading) {
        setSubagentRunsLoading(false);
      }
    }
  }, [accomplish, subagentParentTaskId]);

  useEffect(() => {
    if (!subagentParentTaskId) {
      setSubagentRuns([]);
      setSubagentTree([]);
      return;
    }
    void refreshSubagentRuns(subagentRuns.length === 0);
    const timer = window.setInterval(() => {
      void refreshSubagentRuns();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refreshSubagentRuns, subagentParentTaskId, subagentRuns.length]);

  const exportRuntimeLogs = useCallback(() => {
    if (logs.length === 0) return;
    const text = logs.map((entry) => (
      `[${new Date(entry.at).toLocaleTimeString()}] ${formatStream(entry.stream)} ${entry.line}`
    )).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const workspaceLabel = workspaceFolderName || 'workspace';
    const timestamp = new Date().toISOString().replace(/[:]/g, '-');
    link.href = url;
    link.download = `${workspaceLabel}-runtime-logs-${timestamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [logs, workspaceFolderName]);

  const stopSubagentRun = useCallback(async (runId: string) => {
    if (!runId) return;
    setStoppingSubagentRunId(runId);
    try {
      await accomplish.stopSubagent({ runId });
      await refreshSubagentRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoppingSubagentRunId((current) => (current === runId ? null : current));
    }
  }, [accomplish, refreshSubagentRuns]);

  const loadSubagentDetail = useCallback(async (run: SubagentRunRecord, options?: { showLoading?: boolean; replaceRun?: boolean }) => {
    if (options?.replaceRun !== false) {
      setSubagentDetailRun(run);
    }
    if (options?.showLoading !== false) {
      setSubagentDetailLoading(true);
    }
    try {
      const task = await accomplish.getTask(run.childTaskId, run.childAgentId);
      setSubagentDetailTask(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (options?.showLoading !== false) {
        setSubagentDetailLoading(false);
      }
    }
  }, [accomplish]);

  useEffect(() => {
    if (!subagentDetailRun) {
      setSubagentDetailTask(null);
      setSubagentDetailPrompt('');
      setSubagentDetailModelOverride('');
      return;
    }
    void loadSubagentDetail(subagentDetailRun, { showLoading: true, replaceRun: false });
    const timer = window.setInterval(() => {
      void loadSubagentDetail(subagentDetailRun, { showLoading: false, replaceRun: false });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadSubagentDetail, subagentDetailRun?.runId]);

  const sendSubagentFollowUp = useCallback(async () => {
    const prompt = subagentDetailPrompt.trim();
    if (!prompt || !subagentDetailTask || !subagentDetailRun) return;
    const selectedOverride = availableSubagentModelOptions.find((entry) => entry.value === subagentDetailModelOverride) || null;
    setSubagentDetailSending(true);
    try {
      await accomplish.sendSubagent({
        runId: subagentDetailRun.runId,
        prompt,
        modelProvider: selectedOverride?.providerId,
        modelId: selectedOverride?.modelId,
        modelBaseUrl: selectedOverride?.baseUrl,
      });
      setSubagentDetailPrompt('');
      const refreshed = await accomplish.getTask(subagentDetailTask.id, subagentDetailTask.agentId);
      setSubagentDetailTask(refreshed);
      await refreshSubagentRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubagentDetailSending(false);
    }
  }, [accomplish, availableSubagentModelOptions, refreshSubagentRuns, subagentDetailModelOverride, subagentDetailPrompt, subagentDetailRun, subagentDetailTask]);

  const archiveSubagentDetail = useCallback(async () => {
    if (!subagentDetailRun) return;
    setSubagentDetailMutating(true);
    try {
      await accomplish.archiveSubagent({ runId: subagentDetailRun.runId, archived: true });
      setSubagentDetailRun(null);
      await refreshSubagentRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, refreshSubagentRuns, subagentDetailRun]);

  const closeSubagentDetailSession = useCallback(async () => {
    if (!subagentDetailRun) return;
    setSubagentDetailMutating(true);
    try {
      await accomplish.closeSubagent({ runId: subagentDetailRun.runId });
      setSubagentDetailRun(null);
      setSubagentDetailTask(null);
      setSubagentDetailPrompt('');
      setSubagentDetailModelOverride('');
      await refreshSubagentRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, refreshSubagentRuns, subagentDetailRun]);

  const closeSubagentRun = useCallback(async (runId: string) => {
    if (!runId) return;
    setSubagentDetailMutating(true);
    try {
      await accomplish.closeSubagent({ runId });
      setSubagentDetailRun((current) => current?.runId === runId ? null : current);
      setSubagentDetailTask((current) => (subagentDetailRun?.runId === runId ? null : current));
      setSubagentDetailPrompt((current) => (subagentDetailRun?.runId === runId ? '' : current));
      setSubagentDetailModelOverride((current) => (subagentDetailRun?.runId === runId ? '' : current));
      await refreshSubagentRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, refreshSubagentRuns, subagentDetailRun?.runId]);

  const applyWorkspacePathAndPreset = useCallback((nextPath: string, preferredPresetId?: string | null) => {
    const normalizedNextPath = canonicalizeWorkspaceRelativePath(nextPath);
    const preferredPreset = preferredPresetId
      ? presets.find((preset) => preset.id === preferredPresetId) || null
      : null;
    const preferredPresetMatchesWorkspace = Boolean(
      preferredPreset
      && normalizeWorkspacePathKey(preferredPreset.workspaceRelativePath) === normalizeWorkspacePathKey(normalizedNextPath)
    );
    const matchingPreset = preferredPresetMatchesWorkspace
      ? preferredPreset
      : (presets.find((preset) => normalizeWorkspacePathKey(preset.workspaceRelativePath) === normalizeWorkspacePathKey(normalizedNextPath)) || null);
    const nextPresetId = matchingPreset?.id || null;

    setWorkspaceRelativePath(normalizedNextPath);
    setSelectedPresetId(nextPresetId);
    setActivePresetId(nextPresetId || undefined);

    if (!activeAgentId) return;
    void accomplish.setActiveBuildPreset({ agentId: activeAgentId, presetId: nextPresetId }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [accomplish, activeAgentId, presets]);

  const attemptWorkspacePathChange = useCallback((nextPath: string, sourceLabel: string) => {
    const normalizedNextPath = canonicalizeWorkspaceRelativePath(nextPath);
    const normalizedCurrentPath = canonicalizeWorkspaceRelativePath(workspaceRelativePath);
    if (normalizedNextPath === normalizedCurrentPath) return true;

    if (snapshot?.runtime.status === 'running' || snapshot?.runtime.status === 'starting') {
      setWorkspacePathBlockedDialog({
        requestedPath: normalizedNextPath,
        sourceLabel,
      });
      return false;
    }

    applyWorkspacePathAndPreset(normalizedNextPath);
    return true;
  }, [applyWorkspacePathAndPreset, snapshot?.runtime.status, workspaceRelativePath]);

  const restoreHistorySession = useCallback(async (sessionId: string) => {
    try {
      const session = await accomplish.getBuildTaskHistorySession({ sessionId });
      if (!session) return;
      const nextWorkspaceRelativePath = session.execution.workspaceRelativePath || '.';
      if (!attemptWorkspacePathChange(nextWorkspaceRelativePath, 'Restore task history session')) {
        return;
      }
      restoringHistoryRef.current = true;
      pendingHistoryRestoreScrollRef.current = true;
      const hasRecordedRuns = (session.runs?.length || 0) > 0;
      const restoredRuntimeLogs = session.execution.runtimeLogs || [];
      const visibleRestoredLogs = restoredRuntimeLogs.slice(-BUILD_RESTORED_RUNTIME_LOG_LIMIT);
      setActiveHistorySessionId(session.id);
      setGoalPrompt(hasRecordedRuns ? '' : (session.execution.goalPrompt || ''));
      setPromptAttachedFiles([]);
      setSelectedPresetId(session.execution.selectedPresetId || null);
      startTransition(() => {
        setAiMessages(session.messages || []);
        setDiff(session.execution.latestDiff || null);
        setWorkspaceFingerprint(session.execution.latestFingerprint || null);
        setLogs(visibleRestoredLogs);
        if (session.execution.latestSnapshot) {
          setSnapshot((current) => (
            areBuildSnapshotsEquivalent(current, session.execution.latestSnapshot || null)
              ? current
              : (session.execution.latestSnapshot || null)
          ));
        }
      });
      setPromptComposerResetKey((current) => current + 1);
      if (restoredRuntimeLogs.length > 0) {
        const maxSeq = restoredRuntimeLogs.reduce((max, entry) => Math.max(max, entry.seq), 0);
        setLogCursor(maxSeq + 1);
      } else {
        setLogCursor(0);
      }
      const runs = [...(session.runs || [])].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      const latestRun = runs[0];
      setActiveHistoryRunTaskId(latestRun?.taskId || null);
      setActiveHistorySessionToken(latestRun?.sessionId || null);
      if (latestRun?.taskId && !TERMINAL_TASK_STATES.has(latestRun.status)) {
        setAiTaskId(latestRun.taskId);
        setAiBusy(true);
      } else {
        setAiTaskId(null);
        setAiBusy(false);
      }
      setTimeout(() => {
        restoringHistoryRef.current = false;
      }, 0);
    } catch (err) {
      pendingHistoryRestoreScrollRef.current = false;
      restoringHistoryRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, attemptWorkspacePathChange]);

  useEffect(() => {
    restoreHistorySessionRef.current = async (sessionId: string) => {
      await restoreHistorySession(sessionId);
    };
  }, [restoreHistorySession]);

  const visibleHistorySessions = useMemo(() => (
    historyArchivedOnly
      ? historySessions.filter((session) => session.lifecycleStatus === 'archived')
      : historySessions
  ), [historyArchivedOnly, historySessions]);

  const refreshPresets = useCallback(async (preferredPresetId?: string | null) => {
    if (!activeAgentId) return;
    try {
      const result = await accomplish.listBuildPresets({ agentId: activeAgentId });
      setPresets(result.presets || []);
      setActivePresetId(result.activePresetId);

      const fallbackPresetId = preferredPresetId !== undefined
        ? preferredPresetId
        : (result.activePresetId || result.presets[0]?.id || null);
      setSelectedPresetId(fallbackPresetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId]);

  const refreshSnapshot = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const next = await accomplish.getBuildRuntimeSnapshot({
        agentId: activeAgentId,
        workspaceRelativePath,
      });
      setSnapshot((current) => (areBuildSnapshotsEquivalent(current, next) ? current : next));
      setError((current) => (
        current === BUILD_RUNTIME_GET_WORKSPACE_SWITCH_ERROR
          ? null
          : current
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === BUILD_RUNTIME_GET_WORKSPACE_SWITCH_ERROR) {
        setError((current) => (
          current === BUILD_RUNTIME_GET_WORKSPACE_SWITCH_ERROR
            ? null
            : current
        ));
        return;
      }
      setError(message);
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const refreshTree = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const tree = await accomplish.getBuildWorkspaceTree({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        depth: 4,
        includeHidden: true,
        maxEntries: 2500,
      });
      setWorkspaceTree(tree);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const refreshDiff = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const result = await accomplish.getBuildWorkspaceDiff({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        baselineId: pendingDiffBaselineId || undefined,
      });
      setDiff(result);
      const files = result.files || [];
      if (files.length === 0) {
        setSelectedDiffFilePath(null);
      } else if (!selectedDiffFilePath || !files.some((entry) => entry.relativePath === selectedDiffFilePath)) {
        setSelectedDiffFilePath(files[0].relativePath);
      }

      if (
        buildDiffEnforcementMode === 'approval'
        && pendingDiffBaselineId
        && result.mode === 'synthetic'
        && files.length === 0
        && !aiBusy
      ) {
        await accomplish.resolveBuildWorkspaceBaseline({
          agentId: activeAgentId,
          baselineId: pendingDiffBaselineId,
          decision: 'approve',
        });
        setPendingDiffBaselineId(null);
      }
    } catch {
      setDiff(null);
    }
  }, [
    accomplish,
    activeAgentId,
    aiBusy,
    buildDiffEnforcementMode,
    pendingDiffBaselineId,
    selectedDiffFilePath,
    workspaceRelativePath,
  ]);

  const refreshFingerprint = useCallback(async (showBusy = false) => {
    if (!activeAgentId) return;
    if (showBusy) {
      setFingerprintBusy(true);
    }
    try {
      const result = await accomplish.getBuildWorkspaceFingerprint({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
      });
      setWorkspaceFingerprint(result);
    } catch (err) {
      if (showBusy) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (showBusy) {
        setFingerprintBusy(false);
      }
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const refreshLogs = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const response = await accomplish.getBuildRuntimeLogs({
        agentId: activeAgentId,
        cursor: logCursor,
        limit: 300,
      });
      if (response.logs.length > 0) {
        setLogs((current) => [...current, ...response.logs].slice(-800));
        setLogCursor(response.nextCursor);
      }
    } catch {
      // Ignore transient log polling errors.
    }
  }, [accomplish, activeAgentId, logCursor]);

  const refreshTerminalSnapshot = useCallback(async () => {
    if (!activeAgentId) return null;
    const requestId = ++terminalSnapshotRequestIdRef.current;
    try {
      const next = await accomplish.getBuildTerminalSnapshot({ agentId: activeAgentId });
      if (requestId !== terminalSnapshotRequestIdRef.current) {
        return next;
      }
      setTerminalSnapshot((current) => (areBuildTerminalSnapshotsEquivalent(current, next) ? current : next));
      return next;
    } catch {
      return null;
    }
  }, [accomplish, activeAgentId]);

  const ensureBuildTerminalSession = useCallback(async (splitFromSessionId?: string) => {
    if (!activeAgentId) return null;
    const requestId = ++terminalSnapshotRequestIdRef.current;
    try {
      const next = await accomplish.createBuildTerminalSession({
        agentId: activeAgentId,
        workspaceRelativePath,
        splitFromSessionId,
      });
      if (requestId !== terminalSnapshotRequestIdRef.current) {
        return next;
      }
      setTerminalSnapshot((current) => (areBuildTerminalSnapshotsEquivalent(current, next) ? current : next));
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (!activeAgentId) return;
    if (!presetsLoaded || !workspacePathReady) return;
    let cancelled = false;

    void (async () => {
      const next = await refreshTerminalSnapshot();
      if (cancelled) return;
      if (!next || next.sessions.length === 0) {
        await ensureBuildTerminalSession();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAgentId, ensureBuildTerminalSession, presetsLoaded, refreshTerminalSnapshot, workspacePathReady, workspaceRelativePath]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      accomplish.getSelectedModel(),
      accomplish.listModelProviders(),
      accomplish.getAllApiKeys(),
    ])
      .then(([selected, providers, apiKeys]) => {
        if (cancelled) return;
        setGlobalSelectedModel(selected ?? null);
        setModelProviders(Array.isArray(providers) ? (providers as ProviderConfig[]) : []);
        setModelApiKeyStatus(apiKeys ?? {});
      })
      .catch(() => {
        if (cancelled) return;
        setGlobalSelectedModel(null);
        setModelProviders([]);
        setModelApiKeyStatus({});
      });
    return () => {
      cancelled = true;
    };
  }, [accomplish, activeAgentId]);

  useEffect(() => {
    let cancelled = false;
    void accomplish.getAppSettings()
      .then((settings) => {
        if (cancelled) return;
        const mode = settings?.buildDiffEnforcementMode;
        setBuildDiffEnforcementMode(
          mode === 'auto-apply' ? 'auto-apply' : mode === 'approval' ? 'approval' : 'preview-only'
        );
      })
      .catch(() => {
        if (cancelled) return;
        setBuildDiffEnforcementMode('preview-only');
      });
    return () => {
      cancelled = true;
    };
  }, [accomplish]);

  useEffect(() => {
    if (!activeAgentId) return;
    setBuildHistorySessionStateReady(false);
    setPresetsLoaded(false);
    setWorkspacePathReady(false);
    setWorkspaceRelativePath('.');
    setSelectedPresetId(null);
    setActiveHistorySessionId(null);
    setActiveHistoryRunTaskId(null);
    setActiveHistorySessionToken(null);
    setHistoryDropdownOpen(false);
    let cancelled = false;

    void (async () => {
      let restoredViewState: PersistedBuildViewState | null = null;
      let restoredActiveHistorySessionId: string | null = null;
      let restoredHistoryDropdownOpen = false;
      if (buildViewStateStorageKey) {
        try {
          const raw = window.localStorage.getItem(buildViewStateStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<PersistedBuildViewState>;
            restoredViewState = {
              workspaceRelativePath: canonicalizeWorkspaceRelativePath(parsed.workspaceRelativePath),
              selectedPresetId: typeof parsed.selectedPresetId === 'string'
                ? parsed.selectedPresetId
                : parsed.selectedPresetId === null
                  ? null
                  : null,
              diffCollapsed: typeof parsed.diffCollapsed === 'boolean' ? parsed.diffCollapsed : false,
            };
          }
        } catch {
          restoredViewState = null;
        }
      }
      if (buildActiveHistorySessionStorageKey) {
        try {
          const raw = window.sessionStorage.getItem(buildActiveHistorySessionStorageKey);
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as Partial<PersistedBuildActiveHistorySessionState>;
              restoredActiveHistorySessionId = typeof parsed.sessionId === 'string'
                ? parsed.sessionId
                : parsed.sessionId === null
                  ? null
                  : null;
              restoredHistoryDropdownOpen = parsed.historyDropdownOpen === true;
            } catch {
              restoredActiveHistorySessionId = String(raw).trim() || null;
              restoredHistoryDropdownOpen = false;
            }
          } else {
            restoredActiveHistorySessionId = null;
            restoredHistoryDropdownOpen = false;
          }
        } catch {
          restoredActiveHistorySessionId = null;
          restoredHistoryDropdownOpen = false;
        }
      }

      if (!cancelled && restoredViewState) {
        setDiffCollapsed(Boolean(restoredViewState.diffCollapsed));
        applyWorkspacePathAndPreset(
          restoredViewState.workspaceRelativePath || '.',
          restoredViewState.selectedPresetId ?? null
        );
      }

      try {
        const result = await accomplish.listBuildPresets({ agentId: activeAgentId });
        if (!cancelled) {
          setPresets(result.presets || []);
          setActivePresetId(result.activePresetId);
          const fallbackPresetId = restoredViewState?.selectedPresetId !== undefined
            ? restoredViewState.selectedPresetId
            : (result.activePresetId || result.presets[0]?.id || null);
          setSelectedPresetId(fallbackPresetId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }

      if (!cancelled && restoredActiveHistorySessionId) {
        await restoreHistorySessionRef.current(restoredActiveHistorySessionId);
      }
      if (!cancelled) {
        setHistoryDropdownOpen(restoredHistoryDropdownOpen);
        setBuildHistorySessionStateReady(true);
        setPresetsLoaded(true);
      }
    })();

    void accomplish.listBuildTaskHistorySessions({
      agentId: activeAgentId,
      includeArchived: true,
      limit: 80,
    })
      .then((result) => {
        if (cancelled) return;
        setHistorySessions(result.sessions || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    void accomplish.getBuildWorkspaceRoot({ agentId: activeAgentId })
      .then((result) => {
        if (cancelled) return;
        setAgentWorkspaceRoot(result.workspaceRoot);
      })
      .catch(() => {
        if (cancelled) return;
        setAgentWorkspaceRoot(null);
      });

    return () => {
      cancelled = true;
    };
  }, [accomplish, activeAgentId, buildActiveHistorySessionStorageKey, buildViewStateStorageKey]);

  useEffect(() => {
    if (!activeAgentId) return;
    const timeout = setTimeout(() => {
      void refreshHistorySessions(historyQuery);
    }, 180);
    return () => clearTimeout(timeout);
  }, [activeAgentId, historyQuery, refreshHistorySessions]);

  useEffect(() => {
    if (!historyDropdownOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (historyDropdownRef.current?.contains(target)) return;
      if (historyRowRef.current?.contains(target)) return;
      setHistoryDropdownOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [historyDropdownOpen]);

  useEffect(() => {
    if (buildDiffEnforcementMode !== 'auto-apply' || !pendingDiffBaselineId || !activeAgentId) return;
    void accomplish.resolveBuildWorkspaceBaseline({
      agentId: activeAgentId,
      baselineId: pendingDiffBaselineId,
      decision: 'approve',
    }).catch(() => {
      // Best effort: if baseline already gone this can fail harmlessly.
    });
    setPendingDiffBaselineId(null);
  }, [accomplish, activeAgentId, buildDiffEnforcementMode, pendingDiffBaselineId]);

  useEffect(() => {
    if (!presetsLoaded) return;
    if (!selectedPreset) {
      setPresetNameInput('');
      setPresetStartEntriesInput([]);
      setPresetBuildCommandInput('');
      setPresetRunCommandInput('');
      const fallbackProfile = createDefaultEnvProfile();
      setPresetEnvProfiles([fallbackProfile]);
      setPresetActiveEnvProfileId(fallbackProfile.id);
      setPresetEnvEditorText('');
      setWorkspacePathReady(true);
      return;
    }

    setPresetNameInput(selectedPreset.name);
    setPresetStartEntriesInput(buildStartEntriesToEditable(
      selectedPreset.commands.startEntries
      || (selectedPreset.commands.startCommand ? [{ command: selectedPreset.commands.startCommand, role: 'preview' as const }] : undefined)
    ));
    setPresetBuildCommandInput(selectedPreset.commands.buildCommand || '');
    setPresetRunCommandInput(selectedPreset.commands.runCommand || '');

    const profiles = selectedPreset.envProfiles.length > 0 ? selectedPreset.envProfiles : [createDefaultEnvProfile()];
    setPresetEnvProfiles(profiles);
    const profileId = selectedPreset.activeEnvProfileId || profiles[0]?.id;
    setPresetActiveEnvProfileId(profileId);
    const profile = profiles.find((entry) => entry.id === profileId) || profiles[0];
    setPresetEnvEditorText(envVarsToText(profile?.variables || {}));

    setWorkspacePathReady(true);
  }, [presetsLoaded, selectedPreset]);

  useEffect(() => {
    if (!activeAgentId || !presetsLoaded || !workspacePathReady) return;

    const resolvedPresetId = selectedPreset?.id || null;
    const normalizedSelectedPresetId = selectedPresetId || null;
    const normalizedActivePresetId = activePresetId || null;

    if (normalizedSelectedPresetId === resolvedPresetId && normalizedActivePresetId === resolvedPresetId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await accomplish.setActiveBuildPreset({ agentId: activeAgentId, presetId: resolvedPresetId });
        if (cancelled) return;
        setSelectedPresetId(resolvedPresetId);
        setActivePresetId(resolvedPresetId || undefined);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accomplish,
    activeAgentId,
    activePresetId,
    presetsLoaded,
    selectedPreset,
    selectedPresetId,
    workspacePathReady,
  ]);

  useEffect(() => {
    if (restoringHistoryRef.current) return;
    setLogs([]);
    setLogCursor(0);
    setWorkspaceTree(null);
    setPendingDiffBaselineId(null);
    setSelectedDiffFilePath(null);
    setWorkspaceFingerprint(null);
    setError(null);

    void Promise.all([
      refreshSnapshot(),
      refreshTree(),
      refreshDiff(),
      refreshFingerprint(),
    ]);
  }, [activeAgentId, workspaceRelativePath, refreshSnapshot, refreshTree, refreshDiff, refreshFingerprint]);

  useEffect(() => {
    if (!activeAgentId || !buildEditorLayoutStorageKey) return;
    let cancelled = false;
    restoringEditorLayoutRef.current = true;

    void (async () => {
      try {
        const raw = window.localStorage.getItem(buildEditorLayoutStorageKey);
        if (!raw) {
          if (!cancelled) {
            setEditorTabs([]);
            setActiveEditorTabKey(null);
            setCenterPanelView('preview');
          }
          return;
        }

        const parsed = JSON.parse(raw) as Partial<PersistedBuildEditorLayout>;
        const openTabs = Array.isArray(parsed.openTabs)
          ? parsed.openTabs
            .filter((entry): entry is PersistedBuildEditorLayout['openTabs'][number] => (
              Boolean(entry)
              && typeof entry.relativePath === 'string'
              && entry.relativePath.trim().length > 0
              && typeof entry.workspaceRelativePath === 'string'
            ))
            .map((entry) => ({
              relativePath: entry.relativePath,
              workspaceRelativePath: entry.workspaceRelativePath || '.',
            }))
        : [];

        const tabResults = await Promise.all(openTabs.map(async (entry): Promise<BuildEditorTab | null> => {
          try {
            const result = await accomplish.readBuildWorkspaceFile({
              agentId: activeAgentId,
              relativePath: entry.relativePath,
              workspaceRelativePath: entry.workspaceRelativePath,
            });
            return {
              node: {
                name: getBuildEditorTabLabel(entry.relativePath),
                relativePath: entry.relativePath,
                type: 'file' as const,
              },
              workspaceRelativePath: entry.workspaceRelativePath,
              content: result.content,
              dirty: false,
            };
          } catch {
            return null;
          }
        }));

        if (cancelled) return;

        const restoredTabs = tabResults.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        const requestedActiveKey = typeof parsed.activeEditorTabKey === 'string' ? parsed.activeEditorTabKey : null;
        const restoredActiveKey = restoredTabs.some((entry) => (
          getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === requestedActiveKey
        ))
          ? requestedActiveKey
          : (restoredTabs[0] ? getBuildEditorTabKey(restoredTabs[0].node.relativePath, restoredTabs[0].workspaceRelativePath) : null);

        setEditorTabs(restoredTabs);
        setActiveEditorTabKey(restoredActiveKey);
        setCenterPanelView(parsed.centerPanelView === 'editor' && restoredTabs.length > 0 ? 'editor' : 'preview');
      } catch {
        if (!cancelled) {
          setEditorTabs([]);
          setActiveEditorTabKey(null);
          setCenterPanelView('preview');
        }
      } finally {
        if (!cancelled) {
          restoringEditorLayoutRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
      restoringEditorLayoutRef.current = false;
    };
  }, [activeAgentId, buildEditorLayoutStorageKey]);

  useEffect(() => {
    if (!activeAgentId || !buildViewStateStorageKey || !workspacePathReady) return;
    const payload: PersistedBuildViewState = {
      workspaceRelativePath: canonicalizeWorkspaceRelativePath(workspaceRelativePath),
      selectedPresetId,
      diffCollapsed,
    };
    window.localStorage.setItem(buildViewStateStorageKey, JSON.stringify(payload));
  }, [activeAgentId, buildViewStateStorageKey, diffCollapsed, selectedPresetId, workspacePathReady, workspaceRelativePath]);

  useEffect(() => {
    if (!buildActiveHistorySessionStorageKey || !buildHistorySessionStateReady) return;
    try {
      const payload: PersistedBuildActiveHistorySessionState = {
        sessionId: activeHistorySessionId,
        historyDropdownOpen,
      };
      window.sessionStorage.setItem(buildActiveHistorySessionStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore session storage failures.
    }
  }, [activeHistorySessionId, buildActiveHistorySessionStorageKey, buildHistorySessionStateReady, historyDropdownOpen]);

  useEffect(() => {
    if (!buildEditorLayoutStorageKey || restoringEditorLayoutRef.current) return;
    const payload: PersistedBuildEditorLayout = {
      openTabs: editorTabs.map((entry) => ({
        relativePath: entry.node.relativePath,
        workspaceRelativePath: entry.workspaceRelativePath,
      })),
      activeEditorTabKey: editorTabs.some((entry) => (
        getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === activeEditorTabKey
      ))
        ? activeEditorTabKey
        : (editorTabs[0] ? getBuildEditorTabKey(editorTabs[0].node.relativePath, editorTabs[0].workspaceRelativePath) : null),
      centerPanelView,
    };
    window.localStorage.setItem(buildEditorLayoutStorageKey, JSON.stringify(payload));
  }, [activeEditorTabKey, buildEditorLayoutStorageKey, centerPanelView, editorTabs]);

  useEffect(() => {
    const runtimeInterval = setInterval(() => {
      void refreshSnapshot();
    }, 2000);
    const logInterval = setInterval(() => {
      void refreshLogs();
    }, 1000);
    const terminalSnapshotInterval = setInterval(() => {
      void refreshTerminalSnapshot();
    }, 2000);
    return () => {
      clearInterval(runtimeInterval);
      clearInterval(logInterval);
      clearInterval(terminalSnapshotInterval);
    };
  }, [refreshLogs, refreshSnapshot, refreshTerminalSnapshot]);

  useEffect(() => {
    const sessions = terminalSnapshot?.sessions || [];
    if (sessions.length === 0) {
      setTerminalPaneSessionIds([]);
      return;
    }

    const activeSessionId = terminalSnapshot?.activeSessionId || sessions[0]?.id || null;
    setTerminalPaneSessionIds((current) => {
      const availableIds = new Set(sessions.map((session) => session.id));
      const next = current.filter((sessionId) => availableIds.has(sessionId));
      if (next.length > 0) {
        return next;
      }
      return activeSessionId ? [activeSessionId] : [sessions[0].id];
    });
  }, [terminalSnapshot]);

  useEffect(() => {
    if (!pendingWorkspaceCreateType) return;
    const timeout = window.setTimeout(() => {
      pendingWorkspaceCreateInputRef.current?.scrollIntoView({ block: 'nearest' });
      pendingWorkspaceCreateInputRef.current?.focus();
      pendingWorkspaceCreateInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingWorkspaceCreateType]);

  useEffect(() => {
    if (!pendingWorkspaceRenamePath) return;
    const timeout = window.setTimeout(() => {
      pendingWorkspaceRenameInputRef.current?.scrollIntoView({ block: 'nearest' });
      pendingWorkspaceRenameInputRef.current?.focus();
      pendingWorkspaceRenameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingWorkspaceRenamePath]);

  useEffect(() => {
    if (!workspaceTreeContextMenu) return;
    const handleClickAway = (event: Event) => {
      const target = event.target as Node | null;
      if (workspaceTreeContextMenuRef.current?.contains(target)) return;
      setWorkspaceTreeContextMenu(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspaceTreeContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClickAway);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleClickAway, true);
    return () => {
      window.removeEventListener('mousedown', handleClickAway);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleClickAway, true);
    };
  }, [workspaceTreeContextMenu]);

  useEffect(() => {
    if (!workspaceTree) return;
    setLastWorkspaceDirectoryPath((current) => (
      current && treeHasDirectoryPath(workspaceTree, current)
        ? current
        : workspaceTree.relativePath
    ));
    setPendingWorkspaceCreateParentPath((current) => (
      current && treeHasDirectoryPath(workspaceTree, current)
        ? current
        : workspaceTree.relativePath
    ));
    setPendingWorkspaceRenamePath((current) => (
      current && treeHasNodePath(workspaceTree, current)
        ? current
        : null
    ));
  }, [workspaceTree]);

  useEffect(() => {
    setLastWorkspaceDirectoryPath(null);
    setPendingWorkspaceCreateParentPath(null);
    setPendingWorkspaceCreateType(null);
    setPendingWorkspaceCreateName('');
    setPendingWorkspaceRenamePath(null);
    setPendingWorkspaceRenameName('');
    setWorkspaceTreeContextMenu(null);
  }, [workspaceRelativePath]);

  useEffect(() => {
    if (!aiBusy) return;
    if (!assistantNearBottom) return;
    scrollAssistantMessagesToBottom('auto');
  }, [assistantMessages, aiBusy, assistantNearBottom, scrollAssistantMessagesToBottom]);

  useEffect(() => {
    if (!pendingHistoryRestoreScrollRef.current) return;
    scrollAssistantMessagesToBottom('auto');
    pendingHistoryRestoreScrollRef.current = false;
  }, [assistantMessages, scrollAssistantMessagesToBottom]);

  useEffect(() => {
    if (!aiTaskId || !aiBusy) return;
    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const task = await accomplish.getTask(aiTaskId, activeAgentId);
          if (!task || cancelled) return;
          let mergedMessages: TaskMessage[] = [];
          setAiMessages((current) => {
            mergedMessages = mergeIncomingWithLocalBuildGoalMessages(current, task.messages || []);
            return mergedMessages;
          });
          if (task.sessionId) {
            setActiveHistorySessionToken(task.sessionId);
          }
          if (!TERMINAL_TASK_STATES.has(task.status)) {
            void refreshDiff();
          }
          if (TERMINAL_TASK_STATES.has(task.status)) {
            setAiBusy(false);
            setAiTaskId(null);
            if (activeHistorySessionId) {
              await accomplish.updateBuildTaskHistorySession({
                sessionId: activeHistorySessionId,
                messages: mergedMessages,
                lifecycleStatus: mapTaskStatusToLifecycle(task.status),
                activeRun: {
                  id: task.id,
                  taskId: task.id,
                  sessionId: task.sessionId,
                  status: task.status,
                  startedAt: task.startedAt || task.createdAt || new Date().toISOString(),
                  completedAt: task.completedAt,
                  error: task.result?.error,
                  tokenUsage: contextStats
                    ? {
                      promptTokens: contextStats.estimate.promptTokensEst,
                      contextLimitTokens: contextStats.context.contextLimitTokens,
                      usedPct: contextStats.context.usedPct,
                      safeRemainingForReply: contextStats.context.safeRemainingForReply,
                      updatedAt: new Date().toISOString(),
                    }
                    : undefined,
                },
              });
            }
            await Promise.all([refreshTree(), refreshDiff(), refreshSnapshot(), refreshFingerprint(), refreshHistorySessions()]);
          }
        } catch {
          // Ignore polling failures.
        }
      })();
    }, 1200);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    accomplish,
    activeAgentId,
    activeHistorySessionId,
    aiBusy,
    aiTaskId,
    contextStats,
    refreshDiff,
    refreshFingerprint,
    refreshSnapshot,
    refreshTree,
  ]);

  useEffect(() => {
    if (!aiBusy) {
      setInterruptingAiTask(false);
    }
  }, [aiBusy]);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!activeAgentId) return;
      void accomplish
        .estimateContextWindow({
          prompt: goalPrompt,
          taskId: aiTaskId || undefined,
          agentId: activeAgentId,
          attachedFiles: promptAttachedFiles.length > 0 ? promptAttachedFiles : undefined,
        })
        .then((stats) => {
          if (cancelled) return;
          setContextStats(stats);
        })
        .catch(() => {
          if (cancelled) return;
          setContextStats(null);
        });
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [accomplish, activeAgentId, aiTaskId, goalPrompt, promptAttachedFiles]);

  useEffect(() => {
    if (!activeHistorySessionId) return;
    const timeout = setTimeout(() => {
      void accomplish.updateBuildTaskHistorySession({
        sessionId: activeHistorySessionId,
        messages: aiMessages,
        latestSnapshot: snapshot || undefined,
        latestDiff: diff,
        latestFingerprint: workspaceFingerprint,
        runtimeLogs: logs,
        workspaceRelativePath: workspaceRelativePath || '.',
        selectedPresetId: selectedPresetId || null,
        lifecycleStatus: aiBusy ? 'active' : undefined,
      }).catch(() => {
        // Ignore background history persistence errors.
      });
    }, 4000);
    return () => clearTimeout(timeout);
  }, [
    accomplish,
    activeHistorySessionId,
    aiBusy,
    aiMessages,
    diff,
    logs,
    selectedPresetId,
    snapshot,
    workspaceFingerprint,
    workspaceRelativePath,
  ]);

  useEffect(() => {
    if (!activeHistorySessionId) return;
    const trimmedGoalPrompt = goalPrompt.trim();
    if (!trimmedGoalPrompt) return;
    const timeout = setTimeout(() => {
      void accomplish.updateBuildTaskHistorySession({
        sessionId: activeHistorySessionId,
        goalPrompt: trimmedGoalPrompt,
        workspaceRelativePath: workspaceRelativePath || '.',
        selectedPresetId: selectedPresetId || null,
      }).catch(() => {
        // Ignore background history persistence errors.
      });
    }, 260);
    return () => clearTimeout(timeout);
  }, [accomplish, activeHistorySessionId, goalPrompt, selectedPresetId, workspaceRelativePath]);

  // AI-first automatic repair loop when runtime errors are detected.
  useEffect(() => {
    if (!autoRepairEnabled || autoRepairBusy || !snapshot || !activeAgentId) return;
    if (buildDiffEnforcementMode === 'approval' && pendingDiffBaselineId && (diff?.files || []).length > 0) return;
    if (!snapshot.runtime.suggestedRepairPrompt || !snapshot.runtime.autoRepairRequestedAt) return;

    const fingerprint = `${snapshot.runtime.autoRepairRequestedAt}:${snapshot.runtime.lastError || ''}`;
    if (!fingerprint || fingerprint === lastRepairFingerprint) return;

    setLastRepairFingerprint(fingerprint);
    setAutoRepairBusy(true);

    void (async () => {
      try {
        setAiMessages((current) => {
          const attemptNumber = getNextAutoRepairAttemptNumber(current);
          const attemptTimestamp = new Date().toISOString();
          const attemptMessage: TaskMessage = {
            id: `local-auto-repair-attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'system',
            timestamp: attemptTimestamp,
            content: [
              `**AI Repair Attempt ${attemptNumber}**`,
              `- Time: ${new Date(attemptTimestamp).toLocaleString()}`,
              `- Trigger: ${snapshot.runtime.lastError || 'Runtime error detected'}`,
            ].join('\n'),
          };
          return [...current, attemptMessage];
        });

        if (buildDiffEnforcementMode !== 'auto-apply' && !pendingDiffBaselineId) {
          const baseline = await accomplish.captureBuildWorkspaceBaseline({
            agentId: activeAgentId,
            relativePath: workspaceRelativePath,
          });
          setPendingDiffBaselineId(baseline.baselineId);
          setSelectedDiffFilePath(null);
        }
        const task = await accomplish.startTask({
          prompt: snapshot.runtime.suggestedRepairPrompt || 'Diagnose and fix runtime failure in this workspace.',
          agentId: activeAgentId,
          workingDirectory: snapshot.workspaceRoot,
        });
        setAiTaskId(task.id);
        setAiMessages((current) => mergeIncomingWithLocalBuildGoalMessages(current, task.messages || []));
        setAiBusy(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setAutoRepairBusy(false);
      }
    })();
  }, [
    accomplish,
    activeAgentId,
    autoRepairBusy,
    autoRepairEnabled,
    buildDiffEnforcementMode,
    diff?.files,
    lastRepairFingerprint,
    pendingDiffBaselineId,
    snapshot,
    workspaceRelativePath,
  ]);

  const handleSelectPreset = useCallback(async (presetId: string | null) => {
    if (!activeAgentId) return;
    const targetPreset = presetId ? presets.find((preset) => preset.id === presetId) || null : null;
    setSelectedPresetId(presetId);
    try {
      const nextActive = presetId || null;
      await accomplish.setActiveBuildPreset({ agentId: activeAgentId, presetId: nextActive });
      setActivePresetId(nextActive || undefined);
      const targetWorkspace = canonicalizeWorkspaceRelativePath(targetPreset?.workspaceRelativePath);
      const currentWorkspace = canonicalizeWorkspaceRelativePath(workspaceRelativePath);
      if (targetPreset && targetWorkspace !== currentWorkspace) {
        setPresetWorkspaceConfirmDialog({
          presetId: targetPreset.id,
          presetName: targetPreset.name,
          presetWorkspaceRelativePath: targetWorkspace,
          currentWorkspaceRelativePath: currentWorkspace,
        });
      } else {
        setPresetWorkspaceConfirmDialog(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, presets, workspaceRelativePath]);

  const savePreset = useCallback(async () => {
    if (!activeAgentId) return;
    const profileId = presetActiveEnvProfileId || presetEnvProfiles[0]?.id;
    const startEntries = parsedPresetStartEntries.entries;
    if (parsedPresetStartEntries.issues.some((issue) => !issue.startsWith('Using legacy'))) {
      setError('Fix the start command validation issues before saving the preset.');
      return;
    }
    const envProfiles = presetEnvProfiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, variables: parseEnvVarsText(presetEnvEditorText) }
        : profile
    );

    const saved = await accomplish.upsertBuildPreset({
      id: selectedPresetId || undefined,
      agentId: activeAgentId,
      name: presetNameInput || `Preset ${presets.length + 1}`,
      workspaceRelativePath: workspaceRelativePath || '.',
      commands: {
        startCommand: startEntries[0]?.command || undefined,
        startEntries: startEntries.length > 0 ? startEntries : undefined,
        buildCommand: presetBuildCommandInput || undefined,
        runCommand: presetRunCommandInput || undefined,
      },
      envProfiles,
      activeEnvProfileId: profileId,
    });

    await handleSelectPreset(saved.id);
    await refreshPresets(saved.id);
  }, [
    accomplish,
    activeAgentId,
    handleSelectPreset,
    presetActiveEnvProfileId,
    presetBuildCommandInput,
    presetEnvEditorText,
    presetEnvProfiles,
    presetNameInput,
    parsedPresetStartEntries.entries,
    parsedPresetStartEntries.issues,
    presetRunCommandInput,
    presets.length,
    refreshPresets,
    selectedPresetId,
    workspaceRelativePath,
  ]);

  const createPresetFromCurrent = useCallback(async () => {
    if (!activeAgentId) return;
    const base = presetNameInput.trim() || `Preset ${presets.length + 1}`;
    const activeProfileId = presetActiveEnvProfileId || presetEnvProfiles[0]?.id;
    const startEntries = parsedPresetStartEntries.entries;
    if (parsedPresetStartEntries.issues.some((issue) => !issue.startsWith('Using legacy'))) {
      setError('Fix the start command validation issues before creating the preset.');
      return;
    }
    const envProfiles = presetEnvProfiles.map((profile, index) => ({
      ...profile,
      variables: (profile.id === activeProfileId || (!activeProfileId && index === 0))
        ? parseEnvVarsText(presetEnvEditorText)
        : profile.variables,
    }));
    const created = await accomplish.upsertBuildPreset({
      agentId: activeAgentId,
      name: base,
      workspaceRelativePath: workspaceRelativePath || '.',
      commands: {
        startCommand: startEntries[0]?.command || undefined,
        startEntries: startEntries.length > 0 ? startEntries : undefined,
        buildCommand: presetBuildCommandInput || undefined,
        runCommand: presetRunCommandInput || undefined,
      },
      envProfiles,
      activeEnvProfileId: activeProfileId || envProfiles[0]?.id,
    });
    await handleSelectPreset(created.id);
    await refreshPresets(created.id);
  }, [
    accomplish,
    activeAgentId,
    handleSelectPreset,
    presetBuildCommandInput,
    presetEnvEditorText,
    presetEnvProfiles,
    presetActiveEnvProfileId,
    presetNameInput,
    parsedPresetStartEntries.entries,
    parsedPresetStartEntries.issues,
    presetRunCommandInput,
    presets.length,
    refreshPresets,
    workspaceRelativePath,
  ]);

  const deleteCurrentPreset = useCallback(async () => {
    if (!activeAgentId || !selectedPresetId) return;
    await accomplish.deleteBuildPreset({ agentId: activeAgentId, presetId: selectedPresetId });
    await accomplish.setActiveBuildPreset({ agentId: activeAgentId, presetId: null });
    setSelectedPresetId(null);
    setActivePresetId(undefined);
    await refreshPresets(null);
  }, [accomplish, activeAgentId, refreshPresets, selectedPresetId]);

  const addEnvProfile = useCallback(() => {
    const profile = createDefaultEnvProfile();
    setPresetEnvProfiles((current) => [...current, profile]);
    setPresetActiveEnvProfileId(profile.id);
    setPresetEnvEditorText('');
  }, []);

  const removeEnvProfile = useCallback(() => {
    if (!presetActiveEnvProfileId) return;
    setPresetEnvProfiles((current) => {
      const next = current.filter((entry) => entry.id !== presetActiveEnvProfileId);
      const fallback = next[0];
      setPresetActiveEnvProfileId(fallback?.id);
      setPresetEnvEditorText(envVarsToText(fallback?.variables || {}));
      return next.length > 0 ? next : [createDefaultEnvProfile()];
    });
  }, [presetActiveEnvProfileId]);

  const switchEnvProfile = useCallback((profileId: string) => {
    const currentProfile = presetEnvProfiles.find((entry) => entry.id === presetActiveEnvProfileId);
    const currentVars = parseEnvVarsText(presetEnvEditorText);

    const nextProfiles = presetEnvProfiles.map((entry) =>
      entry.id === presetActiveEnvProfileId
        ? { ...entry, variables: currentVars }
        : entry
    );
    setPresetEnvProfiles(nextProfiles);
    setPresetActiveEnvProfileId(profileId);

    const nextProfile = nextProfiles.find((entry) => entry.id === profileId);
    setPresetEnvEditorText(envVarsToText(nextProfile?.variables || {}));
  }, [presetActiveEnvProfileId, presetEnvEditorText, presetEnvProfiles]);

  const addPresetStartEntry = useCallback(() => {
    setPresetStartEntriesInput((current) => [
      ...current,
      createEditableBuildStartEntry({ role: current.some((entry) => entry.role === 'preview') ? 'worker' : 'preview' }),
    ]);
  }, []);

  const updatePresetStartEntry = useCallback((id: string, patch: Partial<EditableBuildStartEntry>) => {
    setPresetStartEntriesInput((current) => current.map((entry) => (
      entry.id === id ? { ...entry, ...patch } : entry
    )));
  }, []);

  const setPresetStartEntryRole = useCallback((id: string, role: 'preview' | 'worker') => {
    setPresetStartEntriesInput((current) => current.map((entry) => {
      if (role === 'preview') {
        if (entry.id === id) return { ...entry, role: 'preview' };
        if (entry.role === 'preview') return { ...entry, role: 'worker' };
      }
      if (entry.id === id) return { ...entry, role };
      return entry;
    }));
  }, []);

  const removePresetStartEntry = useCallback((id: string) => {
    setPresetStartEntriesInput((current) => {
      const next = current.filter((entry) => entry.id !== id);
      if (next.length === 0) {
        return [];
      }
      if (!next.some((entry) => entry.role === 'preview')) {
        return next.map((entry, index) => (index === 0 ? { ...entry, role: 'preview' } : entry));
      }
      return next;
    });
  }, []);

  const movePresetStartEntry = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setPresetStartEntriesInput((current) => {
      const sourceIndex = current.findIndex((entry) => entry.id === draggedId);
      const targetIndex = current.findIndex((entry) => entry.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      const next = [...current];
      const [dragged] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, dragged);
      return next;
    });
  }, []);

  const runRuntimeAction = useCallback(async (action: 'start' | 'stop' | 'restart' | 'build' | 'run-once') => {
    if (!activeAgentId) return;
    setBusyAction(action);
    setError(null);
    try {
      const startCommandOverride = selectedPreset?.commands.startCommand || undefined;
      const startEntriesOverride = (selectedPreset?.commands.startEntries || []).length > 0
        ? selectedPreset?.commands.startEntries
        : undefined;
      const buildCommandOverride = selectedPreset?.commands.buildCommand || undefined;
      const runCommandOverride = selectedPreset?.commands.runCommand || undefined;

      if (action === 'start') {
        const next = await accomplish.startBuildRuntime({
          agentId: activeAgentId,
          workspaceRelativePath,
          autoRestart,
          mode: 'dev',
          commandOverride: startCommandOverride,
          startEntries: startEntriesOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot((current) => (areBuildSnapshotsEquivalent(current, next) ? current : next));
      } else if (action === 'stop') {
        const next = await accomplish.stopBuildRuntime({ agentId: activeAgentId });
        setSnapshot((current) => (areBuildSnapshotsEquivalent(current, next) ? current : next));
      } else if (action === 'restart') {
        const next = await accomplish.restartBuildRuntime({ agentId: activeAgentId });
        setSnapshot((current) => (areBuildSnapshotsEquivalent(current, next) ? current : next));
      } else if (action === 'build') {
        const result = await accomplish.runBuildCommand({
          agentId: activeAgentId,
          workspaceRelativePath,
          commandOverride: buildCommandOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot((current) => (areBuildSnapshotsEquivalent(current, result.snapshot) ? current : result.snapshot));
      } else if (action === 'run-once') {
        const result = await accomplish.runStartCommandOnce({
          agentId: activeAgentId,
          workspaceRelativePath,
          commandOverride: runCommandOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot((current) => (areBuildSnapshotsEquivalent(current, result.snapshot) ? current : result.snapshot));
      }
      await Promise.all([refreshSnapshot(), refreshDiff(), refreshFingerprint()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }, [
    accomplish,
    activeAgentId,
    autoRestart,
    effectiveEnvOverrides,
    refreshDiff,
    refreshFingerprint,
    refreshSnapshot,
    selectedPreset,
    workspaceRelativePath,
  ]);

  const interruptBuildTask = useCallback(async () => {
    if (!aiTaskId) return;
    setInterruptingAiTask(true);
    setError(null);
    try {
      await accomplish.interruptTask(aiTaskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInterruptingAiTask(false);
    }
  }, [accomplish, aiTaskId]);

  const handleSelectFile = useCallback(async (node: BuildFileTreeNode) => {
    if (!activeAgentId || node.type !== 'file') return;
    try {
      const nextTabKey = getBuildEditorTabKey(node.relativePath, workspaceRelativePath || '.');
      setCenterPanelView('editor');
      setActiveEditorTabKey(nextTabKey);
      if (editorTabs.some((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === nextTabKey)) {
        return;
      }
      const result = await accomplish.readBuildWorkspaceFile({
        agentId: activeAgentId,
        relativePath: node.relativePath,
        workspaceRelativePath: workspaceRelativePath || '.',
      });
      setEditorTabs((current) => {
        if (current.some((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === nextTabKey)) {
          return current;
        }
        return [...current, { node, workspaceRelativePath: workspaceRelativePath || '.', content: result.content, dirty: false }];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, editorTabs, workspaceRelativePath]);

  const closeWorkspaceTreeContextMenu = useCallback(() => {
    setWorkspaceTreeContextMenu(null);
  }, []);

  const updateEditorTabsForWorkspaceMove = useCallback((
    fromPath: string,
    fromWorkspaceRelativePath: string,
    toPath: string,
    toWorkspaceRelativePath: string,
  ) => {
    const normalizedSourceWorkspace = normalizeFsPath(fromWorkspaceRelativePath || '.') || '.';
    const normalizedTargetWorkspace = normalizeFsPath(toWorkspaceRelativePath || '.') || '.';
    setEditorTabs((current) => current.map((entry) => {
      if (canonicalizeWorkspaceRelativePath(entry.workspaceRelativePath) !== normalizedSourceWorkspace) {
        return entry;
      }
      if (!pathMatchesOrDescendsFrom(entry.node.relativePath, fromPath)) {
        return entry;
      }
      const renamedPath = replacePathPrefix(entry.node.relativePath, fromPath, toPath);
      return {
        ...entry,
        workspaceRelativePath: normalizedTargetWorkspace,
        node: {
          ...entry.node,
          relativePath: renamedPath,
          name: getBuildEditorTabLabel(renamedPath),
        },
      };
    }));
    setActiveEditorTabKey((currentKey) => {
      if (!currentKey) return currentKey;
      const sourceKey = getBuildEditorTabKey(fromPath, normalizedSourceWorkspace);
      if (currentKey === sourceKey) {
        return getBuildEditorTabKey(toPath, normalizedTargetWorkspace);
      }
      const prefix = `${normalizedSourceWorkspace}::${normalizeFsPath(fromPath)}/`;
      if (currentKey.startsWith(prefix)) {
        const sourcePath = currentKey.slice(normalizedSourceWorkspace.length + 2);
        return getBuildEditorTabKey(replacePathPrefix(sourcePath, fromPath, toPath), normalizedTargetWorkspace);
      }
      return currentKey;
    });
    setLastWorkspaceDirectoryPath((current) => (
      current && pathMatchesOrDescendsFrom(current, fromPath)
        ? replacePathPrefix(current, fromPath, toPath)
        : current
    ));
    setPendingWorkspaceCreateParentPath((current) => (
      current && pathMatchesOrDescendsFrom(current, fromPath)
        ? replacePathPrefix(current, fromPath, toPath)
        : current
    ));
  }, []);

  const updateEditorTabsForWorkspaceRename = useCallback((fromPath: string, toPath: string, targetWorkspaceRelativePath: string) => {
    updateEditorTabsForWorkspaceMove(fromPath, targetWorkspaceRelativePath, toPath, targetWorkspaceRelativePath);
  }, [updateEditorTabsForWorkspaceMove]);

  const removeEditorTabsForWorkspaceEntry = useCallback((targetPath: string, targetWorkspaceRelativePath: string) => {
    const normalizedWorkspace = normalizeFsPath(targetWorkspaceRelativePath || '.') || '.';
    setEditorTabs((current) => {
      const next = current.filter((entry) => {
        if (canonicalizeWorkspaceRelativePath(entry.workspaceRelativePath) !== normalizedWorkspace) {
          return true;
        }
        return !pathMatchesOrDescendsFrom(entry.node.relativePath, targetPath);
      });
      setActiveEditorTabKey((currentKey) => {
        if (!currentKey) return currentKey;
        const activeEntry = current.find((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === currentKey);
        if (!activeEntry) return currentKey;
        if (canonicalizeWorkspaceRelativePath(activeEntry.workspaceRelativePath) !== normalizedWorkspace) {
          return currentKey;
        }
        if (!pathMatchesOrDescendsFrom(activeEntry.node.relativePath, targetPath)) {
          return currentKey;
        }
        return next[0] ? getBuildEditorTabKey(next[0].node.relativePath, next[0].workspaceRelativePath) : null;
      });
      return next;
    });
    setLastWorkspaceDirectoryPath((current) => (
      current && pathMatchesOrDescendsFrom(current, targetPath)
        ? workspaceTree?.relativePath || null
        : current
    ));
    setPendingWorkspaceCreateParentPath((current) => (
      current && pathMatchesOrDescendsFrom(current, targetPath)
        ? workspaceTree?.relativePath || null
        : current
    ));
  }, [workspaceTree?.relativePath]);

  const handleWorkspaceTreeContextMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>, node: BuildFileTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'directory') {
      setLastWorkspaceDirectoryPath(node.relativePath);
    }
    setWorkspaceTreeContextMenu({
      node,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const beginWorkspaceRename = useCallback((node: BuildFileTreeNode) => {
    setPendingWorkspaceRenamePath(node.relativePath);
    setPendingWorkspaceRenameName(node.name);
    closeWorkspaceTreeContextMenu();
  }, [closeWorkspaceTreeContextMenu]);

  const cancelWorkspaceRename = useCallback(() => {
    setPendingWorkspaceRenamePath(null);
    setPendingWorkspaceRenameName('');
  }, []);

  const commitWorkspaceRename = useCallback(async () => {
    if (!activeAgentId || !pendingWorkspaceRenamePath) return;
    const nextName = pendingWorkspaceRenameName.trim();
    if (!nextName) {
      cancelWorkspaceRename();
      return;
    }
    if (nextName === getBuildEditorTabLabel(pendingWorkspaceRenamePath)) {
      cancelWorkspaceRename();
      return;
    }

    const currentNode = findTreeNodeByPath(workspaceTree, pendingWorkspaceRenamePath);
    const parentPath = getParentRelativePath(pendingWorkspaceRenamePath);
    const parentNode = parentPath === '.'
      ? workspaceTree
      : findTreeNodeByPath(workspaceTree, parentPath);
    const siblingNameConflict = parentNode?.children?.some((child) => (
      child.relativePath !== pendingWorkspaceRenamePath
      && child.name.localeCompare(nextName, undefined, { sensitivity: 'accent' }) === 0
    ));

    if (currentNode && siblingNameConflict) {
      window.alert(
        currentNode.type === 'directory'
          ? 'You already have a folder with the same name'
          : 'You already have a file with the same name'
      );
      cancelWorkspaceRename();
      return;
    }

    try {
      const result = await accomplish.renameBuildWorkspaceEntry({
        agentId: activeAgentId,
        relativePath: pendingWorkspaceRenamePath,
        nextName,
        workspaceRelativePath: workspaceRelativePath || '.',
      });
      updateEditorTabsForWorkspaceRename(pendingWorkspaceRenamePath, result.renamedPath, workspaceRelativePath || '.');
      cancelWorkspaceRename();
      await Promise.all([refreshTree(), refreshDiff(), refreshFingerprint()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Path already exists')) {
        window.alert(
          currentNode?.type === 'directory'
            ? 'You already have a folder with the same name'
            : 'You already have a file with the same name'
        );
        cancelWorkspaceRename();
        return;
      }
      setError(message);
    }
  }, [
    accomplish,
    activeAgentId,
    cancelWorkspaceRename,
    pendingWorkspaceRenameName,
    pendingWorkspaceRenamePath,
    refreshDiff,
    refreshFingerprint,
    refreshTree,
    updateEditorTabsForWorkspaceRename,
    workspaceTree,
    workspaceRelativePath,
  ]);

  const copyWorkspaceEntryPath = useCallback(async (node: BuildFileTreeNode, mode: 'cut' | 'copy') => {
    setWorkspaceTreeClipboardEntry({
      mode,
      relativePath: node.relativePath,
      workspaceRelativePath: workspaceRelativePath || '.',
      type: node.type,
    });

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(node.relativePath);
      }
    } catch {
      // Internal Build Mode paste works without system clipboard access.
    } finally {
      closeWorkspaceTreeContextMenu();
    }
  }, [closeWorkspaceTreeContextMenu, workspaceRelativePath]);

  const pasteWorkspaceEntryIntoNode = useCallback(async (node: BuildFileTreeNode) => {
    if (!activeAgentId || !workspaceTreeClipboardEntry) return;
    const destinationDirectoryRelativePath = node.type === 'directory'
      ? node.relativePath
      : getParentRelativePath(node.relativePath);

    try {
      const result = await accomplish.pasteBuildWorkspaceEntry({
        agentId: activeAgentId,
        sourceRelativePath: workspaceTreeClipboardEntry.relativePath,
        destinationDirectoryRelativePath,
        mode: workspaceTreeClipboardEntry.mode,
        sourceWorkspaceRelativePath: workspaceTreeClipboardEntry.workspaceRelativePath,
        destinationWorkspaceRelativePath: workspaceRelativePath || '.',
      });
      if (workspaceTreeClipboardEntry.mode === 'cut') {
        updateEditorTabsForWorkspaceMove(
          workspaceTreeClipboardEntry.relativePath,
          workspaceTreeClipboardEntry.workspaceRelativePath,
          result.pastedPath,
          workspaceRelativePath || '.',
        );
        setWorkspaceTreeClipboardEntry(null);
      }
      if (node.type === 'directory') {
        setLastWorkspaceDirectoryPath(node.relativePath);
      } else {
        setLastWorkspaceDirectoryPath(destinationDirectoryRelativePath);
      }
      closeWorkspaceTreeContextMenu();
      await Promise.all([refreshTree(), refreshDiff(), refreshFingerprint()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    accomplish,
    activeAgentId,
    closeWorkspaceTreeContextMenu,
    refreshDiff,
    refreshFingerprint,
    refreshTree,
    updateEditorTabsForWorkspaceMove,
    workspaceRelativePath,
    workspaceTreeClipboardEntry,
  ]);

  const revealWorkspaceEntryInExplorer = useCallback(async (node: BuildFileTreeNode) => {
    if (!activeAgentId) return;
    try {
      const result = await accomplish.revealBuildWorkspacePath({
        agentId: activeAgentId,
        relativePath: node.relativePath,
      });
      if (!result.ok) {
        setError(result.error || 'Failed to reveal workspace entry.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      closeWorkspaceTreeContextMenu();
    }
  }, [accomplish, activeAgentId, closeWorkspaceTreeContextMenu]);

  const deleteWorkspaceEntryFromTree = useCallback(async (node: BuildFileTreeNode) => {
    if (!activeAgentId) return;
    const label = node.type === 'directory' ? 'folder' : 'file';
    if (!window.confirm(`Delete this ${label}?\n\n${node.relativePath}\n\nThis cannot be undone.`)) {
      closeWorkspaceTreeContextMenu();
      return;
    }
    try {
      await accomplish.deleteBuildWorkspaceEntry({
        agentId: activeAgentId,
        relativePath: node.relativePath,
        workspaceRelativePath: workspaceRelativePath || '.',
      });
      removeEditorTabsForWorkspaceEntry(node.relativePath, workspaceRelativePath || '.');
      if (workspaceTreeClipboardEntry && workspaceTreeClipboardEntry.relativePath === node.relativePath) {
        setWorkspaceTreeClipboardEntry(null);
      }
      cancelWorkspaceRename();
      closeWorkspaceTreeContextMenu();
      await Promise.all([refreshTree(), refreshDiff(), refreshFingerprint()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    accomplish,
    activeAgentId,
    cancelWorkspaceRename,
    closeWorkspaceTreeContextMenu,
    refreshDiff,
    refreshFingerprint,
    refreshTree,
    removeEditorTabsForWorkspaceEntry,
    workspaceRelativePath,
    workspaceTreeClipboardEntry,
  ]);

  const cancelWorkspaceCreate = useCallback(() => {
    setPendingWorkspaceCreateType(null);
    setPendingWorkspaceCreateName('');
    setPendingWorkspaceCreateParentPath(null);
  }, []);

  const commitWorkspaceCreate = useCallback(async () => {
    if (!activeAgentId || !pendingWorkspaceCreateType || !workspaceTree) return;
    const requestedName = pendingWorkspaceCreateName.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    const targetParentPath = pendingWorkspaceCreateParentPath || workspaceTree.relativePath;
    const scopedParentPath = toWorkspaceScopedRelativePath(targetParentPath, workspaceRelativePath || '.');
    const requestedPath = [scopedParentPath, requestedName].filter(Boolean).join('/');
    if (!requestedPath) {
      cancelWorkspaceCreate();
      return;
    }

    try {
      if (pendingWorkspaceCreateType === 'folder') {
        await accomplish.createBuildWorkspaceFolder({
          agentId: activeAgentId,
          relativePath: requestedPath,
          workspaceRelativePath: workspaceRelativePath || '.',
        });
      } else {
        await accomplish.createBuildWorkspaceFile({
          agentId: activeAgentId,
          relativePath: requestedPath,
          workspaceRelativePath: workspaceRelativePath || '.',
        });
      }

      cancelWorkspaceCreate();
      await refreshTree();

      if (pendingWorkspaceCreateType === 'file') {
        const normalizedFilePath = normalizeFsPath(targetParentPath) === '.'
          ? normalizeFsPath(requestedName)
          : normalizeFsPath(`${targetParentPath}/${requestedName}`);
        await handleSelectFile({
          name: getBuildEditorTabLabel(requestedName),
          relativePath: normalizedFilePath,
          type: 'file',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    accomplish,
    activeAgentId,
    cancelWorkspaceCreate,
    handleSelectFile,
    pendingWorkspaceCreateName,
    pendingWorkspaceCreateParentPath,
    pendingWorkspaceCreateType,
    refreshTree,
    workspaceTree,
    workspaceRelativePath,
  ]);

  const saveSelectedFile = useCallback(async () => {
    if (!activeAgentId || !activeEditorTab || activeEditorTab.node.type !== 'file') return;
    if (!activeEditorTabIsFromCurrentWorkspace) {
      setError('This file belongs to another workspace path. Switch the Project & Workspace path to that workspace before saving.');
      return;
    }
    try {
      await accomplish.writeBuildWorkspaceFile({
        agentId: activeAgentId,
        relativePath: activeEditorTab.node.relativePath,
        content: activeEditorTab.content,
        workspaceRelativePath: activeEditorTab.workspaceRelativePath,
      });
      setEditorTabs((current) => current.map((entry) => (
        entry.node.relativePath === activeEditorTab.node.relativePath
          ? { ...entry, dirty: false }
          : entry
      )));
      await Promise.all([refreshDiff(), refreshFingerprint()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, activeEditorTab, activeEditorTabIsFromCurrentWorkspace, refreshDiff, refreshFingerprint]);

  const closeEditorTab = useCallback((tabKey: string) => {
    setEditorTabs((current) => {
      const closingTab = current.find((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === tabKey);
      if (closingTab?.dirty && !window.confirm(`Close ${getBuildEditorTabLabel(closingTab.node.relativePath)} without saving changes?`)) {
        return current;
      }
      const next = current.filter((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) !== tabKey);
      setActiveEditorTabKey((currentKey) => {
        if (currentKey !== tabKey) return currentKey;
        const closingIndex = current.findIndex((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === tabKey);
        const fallback = next[Math.max(0, Math.min(closingIndex, next.length - 1))];
        return fallback ? getBuildEditorTabKey(fallback.node.relativePath, fallback.workspaceRelativePath) : null;
      });
      if (activeEditorTabKey === tabKey && current.length <= 1) {
        setCenterPanelView('preview');
      }
      return next;
    });
  }, [activeEditorTabKey]);

  const closeAllEditorTabs = useCallback(() => {
    const dirtyTabs = editorTabs.filter((entry) => entry.dirty);
    if (dirtyTabs.length > 0 && !window.confirm(`Close all files without saving changes to ${dirtyTabs.length} file${dirtyTabs.length === 1 ? '' : 's'}?`)) {
      return;
    }
    setEditorTabs([]);
    setActiveEditorTabKey(null);
    setCenterPanelView('preview');
  }, [editorTabs]);

  const activateBuildTerminalSession = useCallback(async (sessionId: string) => {
    if (!activeAgentId) return;
    const requestId = ++terminalSnapshotRequestIdRef.current;
    try {
      const next = await accomplish.setBuildTerminalActiveSession({ agentId: activeAgentId, sessionId });
      if (requestId !== terminalSnapshotRequestIdRef.current) {
        return;
      }
      setTerminalSnapshot((current) => (areBuildTerminalSnapshotsEquivalent(current, next) ? current : next));
      setTerminalPaneSessionIds((current) => (current.includes(sessionId) ? current : [sessionId]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId]);

  const createBuildTerminalTab = useCallback(async (splitFromSessionId?: string) => {
    const next = await ensureBuildTerminalSession(splitFromSessionId);
    if (!next?.activeSessionId) return;
    if (splitFromSessionId) {
      setTerminalPaneSessionIds((current) => {
        const base = current.length > 0 ? current.filter((id) => id !== next.activeSessionId) : [splitFromSessionId];
        const withoutSource = base.filter((id) => id !== splitFromSessionId);
        return [splitFromSessionId, ...withoutSource, next.activeSessionId].filter((id): id is string => Boolean(id));
      });
      return;
    }
    setTerminalPaneSessionIds([next.activeSessionId]);
  }, [ensureBuildTerminalSession]);

  const clearActiveBuildTerminal = useCallback(async () => {
    if (!activeAgentId || !activeTerminalSession) return;
    try {
      await accomplish.clearBuildTerminalSession({
        agentId: activeAgentId,
        sessionId: activeTerminalSession.id,
      });
      await refreshTerminalSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, activeTerminalSession, refreshTerminalSnapshot]);

  const interruptActiveBuildTerminal = useCallback(async () => {
    if (!activeAgentId || !activeTerminalSession) return;
    try {
      await accomplish.interruptBuildTerminalSession({
        agentId: activeAgentId,
        sessionId: activeTerminalSession.id,
      });
      await refreshTerminalSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, activeTerminalSession, refreshTerminalSnapshot]);

  const closeActiveBuildTerminal = useCallback(async () => {
    if (!activeAgentId || !activeTerminalSession) return;
    const requestId = ++terminalSnapshotRequestIdRef.current;
    try {
      const next = await accomplish.closeBuildTerminalSession({
        agentId: activeAgentId,
        sessionId: activeTerminalSession.id,
      });
      if (requestId !== terminalSnapshotRequestIdRef.current) {
        return;
      }
      setTerminalSnapshot((current) => (areBuildTerminalSnapshotsEquivalent(current, next) ? current : next));
      setTerminalPaneSessionIds((current) => current.filter((sessionId) => sessionId !== activeTerminalSession.id));
      if (next.sessions.length === 0) {
        await createBuildTerminalTab();
      } else if (!terminalPaneSessionIds.some((sessionId) => sessionId !== activeTerminalSession.id)) {
        const fallbackSessionId = next.activeSessionId || next.sessions[0]?.id || null;
        if (fallbackSessionId) {
          setTerminalPaneSessionIds([fallbackSessionId]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, activeTerminalSession, createBuildTerminalTab, terminalPaneSessionIds]);

  const resolvePendingDiffBaseline = useCallback(async (decision: 'approve' | 'reject') => {
    if (!activeAgentId || !pendingDiffBaselineId) return;
    setResolvingDiffDecision(decision);
    setError(null);
    try {
      const result = await accomplish.resolveBuildWorkspaceBaseline({
        agentId: activeAgentId,
        baselineId: pendingDiffBaselineId,
        decision,
      });
      if (!result.ok) {
        throw new Error(result.message || 'Failed to resolve pending diff baseline.');
      }
      setPendingDiffBaselineId(null);
      setSelectedDiffFilePath(null);
      await Promise.all([refreshTree(), refreshDiff(), refreshSnapshot(), refreshFingerprint()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingDiffDecision(null);
    }
  }, [
    accomplish,
    activeAgentId,
    pendingDiffBaselineId,
    refreshDiff,
    refreshFingerprint,
    refreshSnapshot,
    refreshTree,
  ]);

  const syncGoalPromptState = useCallback((value: string, options?: { immediate?: boolean }) => {
    goalPromptDraftRef.current = value;
    const nextValue = options?.immediate ? value : goalPromptDraftRef.current;
    startTransition(() => {
      setGoalPrompt(nextValue);
    });
  }, []);

  const runAiGoal = useCallback(async (promptOverride?: string) => {
    const currentPromptValue = promptOverride ?? goalPromptDraftRef.current ?? goalPrompt;
    if (!activeAgentId || !snapshot || !currentPromptValue.trim()) return;
    if (buildDiffEnforcementMode === 'approval' && pendingDiffBaselineId && (diff?.needsApproval || (diff?.files || []).length > 0)) {
      setError('Resolve pending proposed changes first (Approve or Reject) before starting a new AI task.');
      return;
    }

    setError(null);
    setAiBusy(true);
    try {
      const userGoalPrompt = currentPromptValue.trim();
      syncGoalPromptState(userGoalPrompt, { immediate: true });
      const localGoalMessage: TaskMessage = {
        id: `local-build-goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'user',
        content: userGoalPrompt,
        timestamp: new Date().toISOString(),
      };
      const optimisticMessages = [...aiMessagesRef.current, localGoalMessage];
      setAiMessages(optimisticMessages);
      window.requestAnimationFrame(() => {
        scrollAssistantMessagesToBottom('auto');
      });

      if (buildDiffEnforcementMode !== 'auto-apply') {
        if (pendingDiffBaselineId) {
          try {
            await accomplish.resolveBuildWorkspaceBaseline({
              agentId: activeAgentId,
              baselineId: pendingDiffBaselineId,
              decision: 'approve',
            });
          } catch {
            // Best effort cleanup of old baseline before creating a new one.
          }
        }
        const baseline = await accomplish.captureBuildWorkspaceBaseline({
          agentId: activeAgentId,
          relativePath: workspaceRelativePath,
        });
        setPendingDiffBaselineId(baseline.baselineId);
        setSelectedDiffFilePath(null);
      } else if (pendingDiffBaselineId) {
        try {
          await accomplish.resolveBuildWorkspaceBaseline({
            agentId: activeAgentId,
            baselineId: pendingDiffBaselineId,
            decision: 'approve',
          });
        } catch {
          // Ignore baseline cleanup failure in auto-apply mode.
        }
        setPendingDiffBaselineId(null);
      }

      let sessionId = activeHistorySessionId;
      if (!sessionId) {
        const created = await accomplish.createBuildTaskHistorySession({
          agentId: activeAgentId,
          titleSourcePrompt: userGoalPrompt,
          goalPrompt: userGoalPrompt,
          workspaceRelativePath: workspaceRelativePath || '.',
          selectedPresetId: selectedPresetId || null,
        });
        sessionId = created.id;
        setActiveHistorySessionId(created.id);
      }

      const compiledPrompt = [
        'Build Mode goal:',
        userGoalPrompt,
        '',
        `Workspace: ${snapshot.workspaceRoot}`,
        `Project type: ${snapshot.detection.projectType}`,
        `Preset: ${selectedPreset?.name || 'none'}`,
        `Env profile: ${activeEnvProfile?.name || 'none'}`,
        'Process: plan, apply file edits, run checks, and summarize final diff.',
      ].join('\n');

      let task: Task;
      if (activeHistorySessionToken && activeHistoryRunTaskId) {
        task = await accomplish.resumeSession(
          activeHistorySessionToken,
          compiledPrompt,
          activeHistoryRunTaskId,
          promptAttachedFiles.length > 0 ? promptAttachedFiles : undefined,
        );
      } else {
        task = await accomplish.startTask({
          prompt: compiledPrompt,
          agentId: activeAgentId,
          workingDirectory: snapshot.workspaceRoot,
          attachedFiles: promptAttachedFiles.length > 0 ? promptAttachedFiles : undefined,
        });
      }

      setAiTaskId(task.id);
      setGoalPrompt('');
      goalPromptDraftRef.current = '';
      setPromptComposerResetKey((current) => current + 1);
      setActiveHistoryRunTaskId(task.id);
      setActiveHistorySessionToken(task.sessionId || activeHistorySessionToken);

      if (sessionId) {
        await accomplish.updateBuildTaskHistorySession({
          sessionId,
          goalPrompt: userGoalPrompt,
          workspaceRelativePath: workspaceRelativePath || '.',
          selectedPresetId: selectedPresetId || null,
          messages: optimisticMessages,
          lifecycleStatus: mapTaskStatusToLifecycle(task.status),
          activeRun: {
            id: task.id,
            taskId: task.id,
            sessionId: task.sessionId,
            status: task.status,
            startedAt: task.startedAt || task.createdAt || new Date().toISOString(),
          },
          latestSnapshot: snapshot,
          latestDiff: diff,
          latestFingerprint: workspaceFingerprint,
          runtimeLogs: logs,
        });
      }
    } catch (err) {
      setAiBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    accomplish,
    activeAgentId,
    buildDiffEnforcementMode,
    activeEnvProfile,
    activeHistoryRunTaskId,
    activeHistorySessionId,
    activeHistorySessionToken,
    diff,
    goalPrompt,
    logs,
    selectedPreset,
    selectedPresetId,
    syncGoalPromptState,
    snapshot,
    workspaceFingerprint,
    workspaceRelativePath,
    pendingDiffBaselineId,
    promptAttachedFiles,
  ]);

  useEffect(() => {
    runAiGoalActionRef.current = (value: string) => {
      void runAiGoal(value);
    };
  }, [runAiGoal]);

  useEffect(() => {
    interruptBuildTaskActionRef.current = () => {
      void interruptBuildTask();
    };
  }, [interruptBuildTask]);

  const handleRunPrompt = useCallback((value: string) => {
    runAiGoalActionRef.current(value);
  }, []);

  const handleStopPrompt = useCallback(() => {
    interruptBuildTaskActionRef.current();
  }, []);

  const pluginSlashCommands = usePluginSlashCommands();

  const buildSlashCommands = useMemo<SlashCommandDefinition[]>(() => {
    const runtimeStatus = snapshot?.runtime.status ?? 'stopped';
    return createAppSlashCommands({
      navigate,
      pathname: location.pathname,
      context: 'build',
      search: location.search,
      modeSwitchTarget: 'chat',
      pluginCommands: pluginSlashCommands,
      taskStop: { visible: aiBusy },
      buildHistoryOpen: { visible: true },
      buildHistoryNew: { visible: true },
      buildRuntimeStart: {
        visible: busyAction === null && runtimeStatus !== 'running' && runtimeStatus !== 'starting',
      },
      buildRuntimeStop: {
        visible: busyAction === null && runtimeStatus !== 'stopped',
      },
      buildRuntimeRestart: {
        visible: busyAction === null,
      },
      buildRuntimeBuild: {
        visible: busyAction === null,
      },
      buildRuntimeOpenPreview: {
        visible: Boolean(snapshot?.runtime.previewUrl),
      },
      subagentsRefresh: { visible: Boolean(subagentParentTaskId) },
    });
  }, [aiBusy, busyAction, location.pathname, location.search, navigate, pluginSlashCommands, snapshot?.runtime.previewUrl, snapshot?.runtime.status, subagentParentTaskId]);

  const exportZip = useCallback(async () => {
    if (!activeAgentId) return;
    setBusyAction('zip');
    try {
      const normalizedRelativePath = canonicalizeWorkspaceRelativePath(workspaceRelativePath);
      const workspaceLeaf = normalizedRelativePath === '.'
        ? `${activeAgentId}-workspace`
        : normalizedRelativePath.replace(/\/+$/g, '').split('/').filter(Boolean).pop() || `${activeAgentId}-workspace`;
      await accomplish.exportBuildWorkspaceZip({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        suggestedName: `${workspaceLeaf}-workspace.zip`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const openWorkspaceInExplorer = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const result = await accomplish.openBuildWorkspacePath({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath || '.',
      });
      if (!result.ok) {
        setError(result.error || 'Failed to open workspace path.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const selectWorkspaceFolder = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      let root = agentWorkspaceRoot;
      if (!root) {
        try {
          const rootResult = await accomplish.getBuildWorkspaceRoot({ agentId: activeAgentId });
          root = rootResult.workspaceRoot;
          setAgentWorkspaceRoot(root);
        } catch {
          root = null;
        }
      }

      const hasSelectedFolder = canonicalizeWorkspaceRelativePath(workspaceRelativePath) !== '.';
      let initialPath: string | undefined;

      if (!hasSelectedFolder) {
        // No explicit folder selected: always start at the agent workspace root.
        initialPath = root || snapshot?.workspaceRoot || undefined;
      } else {
        initialPath = snapshot?.workspaceRoot || undefined;
        if (!initialPath) {
          try {
            const currentSnapshot = await accomplish.getBuildRuntimeSnapshot({
              agentId: activeAgentId,
              workspaceRelativePath: workspaceRelativePath || '.',
            });
            initialPath = currentSnapshot.workspaceRoot;
          } catch {
            initialPath = root || undefined;
          }
        }
      }

      const selectedFolder = await accomplish.selectFolder(initialPath);
      if (!selectedFolder) return;

      if (!root) {
        const rootResult = await accomplish.getBuildWorkspaceRoot({ agentId: activeAgentId });
        root = rootResult.workspaceRoot;
        setAgentWorkspaceRoot(root);
      }

      const relative = toWorkspaceRelativePath(root, selectedFolder);
      if (!relative) {
        setError(`Selected folder must be inside this agent workspace: ${root}`);
        return;
      }

      attemptWorkspacePathChange(relative, 'Change workspace path');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, agentWorkspaceRoot, attemptWorkspacePathChange, snapshot?.workspaceRoot, workspaceRelativePath]);

  const handleRenameHistorySession = useCallback(async (session: BuildTaskSessionListItem) => {
    const nextTitle = window.prompt('Rename task session', session.title);
    if (!nextTitle || !nextTitle.trim()) return;
    try {
      await accomplish.renameBuildTaskHistorySession({ sessionId: session.id, title: nextTitle.trim() });
      await refreshHistorySessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, refreshHistorySessions]);

  const handleToggleArchiveHistorySession = useCallback(async (session: BuildTaskSessionListItem) => {
    try {
      await accomplish.archiveBuildTaskHistorySession({
        sessionId: session.id,
        archived: session.lifecycleStatus !== 'archived',
      });
      if (session.lifecycleStatus !== 'archived' && activeHistorySessionId === session.id) {
        setActiveHistorySessionId(null);
        setActiveHistoryRunTaskId(null);
        setActiveHistorySessionToken(null);
      }
      await refreshHistorySessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeHistorySessionId, refreshHistorySessions]);

  const handleTogglePinHistorySession = useCallback(async (session: BuildTaskSessionListItem) => {
    try {
      await accomplish.setBuildTaskHistorySessionPinned({
        sessionId: session.id,
        pinned: session.pinned !== true,
      });
      await refreshHistorySessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, refreshHistorySessions]);

  const handleDeleteHistorySession = useCallback(async (session: BuildTaskSessionListItem) => {
    if (!window.confirm(`Delete session "${session.title}"? This cannot be undone.`)) return;
    try {
      await accomplish.deleteBuildTaskHistorySession({ sessionId: session.id });
      if (activeHistorySessionId === session.id) {
        setActiveHistorySessionId(null);
        setActiveHistoryRunTaskId(null);
        setActiveHistorySessionToken(null);
      }
      await refreshHistorySessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeHistorySessionId, refreshHistorySessions]);

  const handleStartNewHistorySession = useCallback(() => {
    setActiveHistorySessionId(null);
    setActiveHistoryRunTaskId(null);
    setActiveHistorySessionToken(null);
    setAiTaskId(null);
    setAiBusy(false);
    setAiMessages([]);
    setGoalPrompt('');
    goalPromptDraftRef.current = '';
    setPromptComposerResetKey((current) => current + 1);
    setPromptAttachedFiles([]);
  }, []);

  const handleSelectPromptFiles = useCallback(async () => {
    try {
      const files = await accomplish.selectFiles();
      if (!Array.isArray(files) || files.length === 0) return;
      setPromptAttachedFiles((current) => {
        const deduped = new Set(current);
        for (const filePath of files) {
          if (typeof filePath === 'string' && filePath.trim()) {
            deduped.add(filePath);
          }
        }
        return Array.from(deduped);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish]);

  const removePromptAttachedFile = useCallback((filePath: string) => {
    setPromptAttachedFiles((current) => current.filter((entry) => entry !== filePath));
  }, []);

  const currentTaskPreviewText = useMemo(() => {
    const active = historySessions.find((entry) => entry.id === activeHistorySessionId);
    if (active?.title) return active.title;
    const fallback = goalPrompt.trim();
    if (fallback) return fallback;
    return 'No active task';
  }, [activeHistorySessionId, goalPrompt, historySessions]);

  const statusBadgeClass = snapshot?.runtime.status === 'running'
    ? 'bg-emerald-500/10 text-emerald-700'
    : snapshot?.runtime.status === 'starting'
      ? 'bg-amber-500/10 text-amber-700'
      : snapshot?.runtime.status === 'error'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground';

  const previewCrashSummary = useMemo(() => {
    if (!snapshot) return '';
    if (snapshot.runtime.lastError?.trim()) return snapshot.runtime.lastError.trim();
    if (snapshot.runtime.healthMessage?.trim()) return snapshot.runtime.healthMessage.trim();
    if (snapshot.runtime.lastExitCode !== null && snapshot.runtime.lastExitCode !== undefined) {
      return `Process exited with code ${snapshot.runtime.lastExitCode}.`;
    }
    if (snapshot.runtime.lastExitSignal) {
      return `Process exited due to signal ${snapshot.runtime.lastExitSignal}.`;
    }
    return 'See runtime logs for details.';
  }, [snapshot]);

  const previewStartingLabel = useMemo(() => {
    const projectType = String(snapshot?.detection.projectType || '').toLowerCase();
    if (projectType.includes('next')) {
      return 'Starting Next.js server...';
    }
    return 'Starting runtime...';
  }, [snapshot?.detection.projectType]);

  const assistantProseClasses = useMemo(() => cn(
    'text-xs prose prose-sm max-w-none',
    'prose-headings:text-foreground',
    'prose-p:text-foreground prose-p:my-1.5',
    'prose-strong:text-foreground prose-strong:font-semibold',
    'prose-em:text-foreground',
    'prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px]',
    'prose-pre:bg-muted prose-pre:text-foreground prose-pre:p-2 prose-pre:rounded-lg prose-pre:my-2',
    'prose-ul:text-foreground prose-ol:text-foreground',
    'prose-li:text-foreground prose-li:my-0.5',
    'prose-a:text-primary prose-a:underline',
    'prose-blockquote:text-muted-foreground prose-blockquote:border-l-4 prose-blockquote:border-border prose-blockquote:pl-3',
    'prose-hr:border-border',
  ), []);

  const localhostPreviewUrl = useMemo(() => resolveLocalhostPreviewUrl(snapshot), [snapshot]);

  const isIframePreviewReady = Boolean(
    snapshot
    && snapshot.detection.previewStrategy === 'iframe'
    && snapshot.runtime.previewUrl
    && snapshot.runtime.status === 'running'
  );

  const openPreviewInBrowser = useCallback(async () => {
    if (!localhostPreviewUrl) {
      setError('No local runtime preview URL is available yet.');
      return;
    }
    try {
      await accomplish.openExternal(localhostPreviewUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, localhostPreviewUrl]);

  useEffect(() => {
    const handleTaskStop = () => {
      handleStopPrompt();
    };
    const handleBuildHistoryOpen = () => {
      setHistoryDropdownOpen(true);
    };
    const handleBuildHistoryNew = () => {
      handleStartNewHistorySession();
    };
    const handleBuildRuntimeStart = () => {
      void runRuntimeAction('start');
    };
    const handleBuildRuntimeStop = () => {
      void runRuntimeAction('stop');
    };
    const handleBuildRuntimeRestart = () => {
      void runRuntimeAction('restart');
    };
    const handleBuildRuntimeBuild = () => {
      void runRuntimeAction('build');
    };
    const handleBuildRuntimeOpenPreview = () => {
      void openPreviewInBrowser();
    };
    const handleSubagentsRefresh = () => {
      void refreshSubagentRuns(true);
    };

    window.addEventListener(APP_COMMAND_EVENTS.taskStop, handleTaskStop);
    window.addEventListener(APP_COMMAND_EVENTS.buildHistoryOpen, handleBuildHistoryOpen);
    window.addEventListener(APP_COMMAND_EVENTS.buildHistoryNew, handleBuildHistoryNew);
    window.addEventListener(APP_COMMAND_EVENTS.buildRuntimeStart, handleBuildRuntimeStart);
    window.addEventListener(APP_COMMAND_EVENTS.buildRuntimeStop, handleBuildRuntimeStop);
    window.addEventListener(APP_COMMAND_EVENTS.buildRuntimeRestart, handleBuildRuntimeRestart);
    window.addEventListener(APP_COMMAND_EVENTS.buildRuntimeBuild, handleBuildRuntimeBuild);
    window.addEventListener(APP_COMMAND_EVENTS.buildRuntimeOpenPreview, handleBuildRuntimeOpenPreview);
    window.addEventListener(APP_COMMAND_EVENTS.subagentsRefresh, handleSubagentsRefresh);

    return () => {
      window.removeEventListener(APP_COMMAND_EVENTS.taskStop, handleTaskStop);
      window.removeEventListener(APP_COMMAND_EVENTS.buildHistoryOpen, handleBuildHistoryOpen);
      window.removeEventListener(APP_COMMAND_EVENTS.buildHistoryNew, handleBuildHistoryNew);
      window.removeEventListener(APP_COMMAND_EVENTS.buildRuntimeStart, handleBuildRuntimeStart);
      window.removeEventListener(APP_COMMAND_EVENTS.buildRuntimeStop, handleBuildRuntimeStop);
      window.removeEventListener(APP_COMMAND_EVENTS.buildRuntimeRestart, handleBuildRuntimeRestart);
      window.removeEventListener(APP_COMMAND_EVENTS.buildRuntimeBuild, handleBuildRuntimeBuild);
      window.removeEventListener(APP_COMMAND_EVENTS.buildRuntimeOpenPreview, handleBuildRuntimeOpenPreview);
      window.removeEventListener(APP_COMMAND_EVENTS.subagentsRefresh, handleSubagentsRefresh);
    };
  }, [handleStartNewHistorySession, handleStopPrompt, openPreviewInBrowser, refreshSubagentRuns, runRuntimeAction]);

  const handleCopyAssistantMessage = useCallback(async (messageId: string, content: string) => {
    try {
      const contentElement = assistantMessageContentRefs.current[messageId];
      const html = contentElement?.innerHTML || '';
      const plainText = contentElement?.innerText || content || '';
      if (html && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setCopiedAssistantMessageId(messageId);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedAssistantMessageId(null);
        copyResetTimeoutRef.current = null;
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const toggleToolMessageExpanded = useCallback((messageId: string) => {
    setExpandedToolMessageIds((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  }, []);

  const handleAssistantMessageContentRef = useCallback((messageId: string, element: HTMLDivElement | null) => {
    assistantMessageContentRefs.current[messageId] = element;
  }, []);

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, []);

  return (
    <TooltipProvider delayDuration={250}>
    <div ref={buildPageRef} className="h-full flex flex-col bg-background">
      <Dialog
        open={Boolean(workspacePathBlockedDialog)}
        onOpenChange={(open) => {
          if (!open && !workspacePathBlockedBusy) setWorkspacePathBlockedDialog(null);
        }}
      >
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Stop runtime before changing workspace</DialogTitle>
            <DialogDescription>
              The current Build runtime is still active. Stop it before changing the workspace path.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Action:</span>{' '}
              {workspacePathBlockedDialog?.sourceLabel || 'Change workspace path'}
            </div>
            <div>
              <span className="font-medium text-foreground">Current workspace:</span>{' '}
              {workspaceRelativePath || '.'}
            </div>
            <div>
              <span className="font-medium text-foreground">Requested workspace:</span>{' '}
              {workspacePathBlockedDialog?.requestedPath || '.'}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWorkspacePathBlockedDialog(null)}
              disabled={workspacePathBlockedBusy}
            >
              Close
            </Button>
            <Button
              onClick={async () => {
                if (!activeAgentId || !workspacePathBlockedDialog?.requestedPath) return;
                setWorkspacePathBlockedBusy(true);
                try {
                  const nextSnapshot = await accomplish.stopBuildRuntime({ agentId: activeAgentId });
                  setSnapshot((current) => (areBuildSnapshotsEquivalent(current, nextSnapshot) ? current : nextSnapshot));
                  applyWorkspacePathAndPreset(workspacePathBlockedDialog.requestedPath);
                  setWorkspacePathBlockedDialog(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setWorkspacePathBlockedBusy(false);
                }
              }}
              disabled={workspacePathBlockedBusy}
              title="Stop the current runtime and switch to the requested workspace path."
            >
              {workspacePathBlockedBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
              Stop runtime and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(presetWorkspaceConfirmDialog)}
        onOpenChange={(open) => {
          if (!open) setPresetWorkspaceConfirmDialog(null);
        }}
      >
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Switch workspace for this preset?</DialogTitle>
            <DialogDescription>
              This preset was created for a different workspace path. If you keep the current workspace, Build Mode will switch to No preset instead. If you want saved commands for this workspace, create another preset specifically for it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Preset:</span>{' '}
              {presetWorkspaceConfirmDialog?.presetName || 'Preset'}
            </div>
            <div>
              <span className="font-medium text-foreground">Current workspace:</span>{' '}
              {presetWorkspaceConfirmDialog?.currentWorkspaceRelativePath || '.'}
            </div>
            <div>
              <span className="font-medium text-foreground">Preset workspace:</span>{' '}
              {presetWorkspaceConfirmDialog?.presetWorkspaceRelativePath || '.'}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                if (!activeAgentId) {
                  setPresetWorkspaceConfirmDialog(null);
                  return;
                }
                try {
                  await accomplish.setActiveBuildPreset({ agentId: activeAgentId, presetId: null });
                  setSelectedPresetId(null);
                  setActivePresetId(undefined);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setPresetWorkspaceConfirmDialog(null);
                }
              }}
            >
              Keep current workspace
            </Button>
            <Button
              onClick={() => {
                if (presetWorkspaceConfirmDialog?.presetWorkspaceRelativePath) {
                  attemptWorkspacePathChange(
                    presetWorkspaceConfirmDialog.presetWorkspaceRelativePath,
                    'Switch workspace for preset'
                  );
                }
                setPresetWorkspaceConfirmDialog(null);
              }}
            >
              Switch workspace too
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-4 py-3">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ModeSwitch />
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Wrench className="h-3.5 w-3.5" />
              Agent: {activeAgent?.name || activeAgentId}
            </div>
            {modelBadgeLabel ? (
              <div
                title={modelBadgeLabel}
                className="inline-flex max-w-[320px] items-center gap-1.5 truncate rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
              >
                <Code className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Model</span>
              </div>
            ) : null}
            <div className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              Preset: {selectedPreset?.name || 'None'}
            </div>
            <div className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', statusBadgeClass)}>
              {snapshot?.runtime.status === 'running' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {formatRuntimeStatus(snapshot?.runtime.status ?? 'stopped')}
            </div>
            {snapshot?.runtime.port ? (
              <div className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                Port {snapshot.runtime.port}
              </div>
            ) : null}
            {snapshot?.runtime.buildStatus && snapshot.runtime.buildStatus !== 'unknown' ? (
              <div className={cn(
                'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs',
                snapshot.runtime.buildStatus === 'success' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 text-destructive'
              )}>
                Build {snapshot.runtime.buildStatus}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    'h-8 gap-1.5 px-2 text-[11px]',
                    terminalSectionHidden || runtimeLogsSectionHidden
                      ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : ''
                  )}
                  title={hiddenBuildSections.length > 0
                    ? `Closed sections: ${hiddenBuildSections.join(', ')}`
                    : 'Show or hide collapsible Build Mode sections.'}
                >
                  Sections
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-52 p-1.5">
                <div className="space-y-1">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                    onClick={() => setTerminalSectionHidden((current) => !current)}
                    title="Toggle the terminal section."
                  >
                    <span>Terminal</span>
                    {terminalSectionHidden ? (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                    onClick={() => setRuntimeLogsSectionHidden((current) => !current)}
                    title="Toggle the runtime logs section."
                  >
                    <span>Runtime Logs</span>
                    {runtimeLogsSectionHidden ? (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={presetDropdownOpen} onOpenChange={setPresetDropdownOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 max-w-[220px] gap-1.5 px-2 text-[11px]"
                  title="Build presets save workspace-specific commands, environment profiles, and related build settings. If you choose a preset that belongs to another workspace, Build Mode can switch to that workspace path after confirmation."
                >
                  <span className="truncate">{selectedPreset?.name || 'No preset'}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[320px] p-1.5">
                <div className="space-y-1">
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent',
                      !selectedPresetId ? 'bg-accent/50 text-foreground' : 'text-foreground'
                    )}
                    onClick={() => {
                      setPresetDropdownOpen(false);
                      void handleSelectPreset(null);
                    }}
                    title="Use the current workspace without a preset."
                  >
                    <span className="font-medium">No preset</span>
                    <span className="truncate text-[10px] text-muted-foreground">Current workspace only</span>
                  </button>
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent',
                        selectedPresetId === preset.id ? 'bg-accent/50 text-foreground' : 'text-foreground'
                      )}
                      onClick={() => {
                        setPresetDropdownOpen(false);
                        void handleSelectPreset(preset.id);
                      }}
                      title={`${preset.name} — ${preset.workspaceRelativePath || '.'}`}
                    >
                      <span className="min-w-0 truncate font-medium">{preset.name}</span>
                      <span className="max-w-[150px] truncate text-[10px] text-muted-foreground">
                        {preset.workspaceRelativePath || '.'}
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <label className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRestart}
                onChange={(event) => setAutoRestart(event.target.checked)}
              />
              Auto-restart
            </label>
            <label className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRepairEnabled}
                onChange={(event) => setAutoRepairEnabled(event.target.checked)}
              />
              Auto-repair with AI
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runRuntimeAction('start')}
              disabled={busyAction !== null}
              title="Start the current project runtime (dev/server process)."
            >
              <Play className="h-4 w-4 mr-1.5" />
              Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runRuntimeAction('stop')}
              disabled={busyAction !== null}
              title="Stop the currently running project runtime."
            >
              <Square className="h-4 w-4 mr-1.5" />
              Stop
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runRuntimeAction('restart')}
              disabled={busyAction !== null}
              title="Restart the project runtime using current settings."
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Restart
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runRuntimeAction('build')}
              disabled={busyAction !== null}
              title="Run the project's build command once."
            >
              <Wrench className="h-4 w-4 mr-1.5" />
              Build
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-3 py-3">
        <div className="flex h-full w-full flex-col gap-3">
          {error ? (
            <Card className="p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </Card>
          ) : null}

          <div
            className={cn(
              'grid flex-1 min-h-0 grid-cols-1 gap-3',
              leftPanelCollapsed
                ? 'xl:grid-cols-[44px_minmax(0,1fr)_420px]'
                : 'xl:grid-cols-[280px_minmax(0,1fr)_420px]'
            )}
          >
            {leftPanelCollapsed ? (
              <Card className="min-h-0 flex items-start justify-center p-2">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  title="Expand project preset and workspace panel."
                  onClick={() => setLeftPanelCollapsed(false)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Card>
            ) : (
            <Card className="min-h-0 flex flex-col p-3 gap-1">
              <div className="flex items-start justify-between">
                <div className="text-sm font-medium">Project & Workspace</div>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  title="Collapse this panel to the left."
                  onClick={() => setLeftPanelCollapsed(true)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
              <div>
                <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span>Workspace path</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                        aria-label="Show workspace path help"
                      >
                        i
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                      Select a folder inside this agent's workspace root. The selected folder becomes the active build workspace.
                      Runtime commands run from this folder.
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex items-center gap-2">
                  {!workspaceFolderChosen ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => void selectWorkspaceFolder()}
                      title="Select active workspace folder."
                    >
                      <Folder className="mr-1.5 h-3.5 w-3.5" />
                      Select folder
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void selectWorkspaceFolder()}
                    className="h-8 min-w-0 flex-1 truncate rounded-md border border-input bg-background px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/40"
                    title="Select active workspace folder"
                  >
                    {workspaceFolderName}
                  </button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => void openWorkspaceInExplorer()}
                    title="Open current workspace in file explorer."
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => void exportZip()}
                    title="Download the current workspace as a ZIP file."
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="my-1 truncate text-xs leading-none text-muted-foreground" title={snapshot?.workspaceRoot || ''}>
                {snapshot?.workspaceRoot || 'Loading workspace...'}
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60 p-1">
                <div className="mb-1 flex flex-wrap items-center gap-1 border-b border-border/50 px-1 pb-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Create a new file in this workspace."
                    onClick={() => {
                      setPendingWorkspaceCreateType('file');
                      setPendingWorkspaceCreateName('');
                      setPendingWorkspaceCreateParentPath(lastWorkspaceDirectoryPath || workspaceTree?.relativePath || null);
                    }}
                  >
                    <FilePlus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Create a new folder in this workspace."
                    onClick={() => {
                      setPendingWorkspaceCreateType('folder');
                      setPendingWorkspaceCreateName('');
                      setPendingWorkspaceCreateParentPath(lastWorkspaceDirectoryPath || workspaceTree?.relativePath || null);
                    }}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Refresh the workspace file tree."
                    onClick={() => void refreshTree()}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Collapse all folders in the workspace tree."
                    onClick={() => setCollapseWorkspaceTreeToken((current) => current + 1)}
                  >
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {workspaceTreeClipboardEntry ? (
                  <div
                    className="mb-1 flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground"
                    title={`${workspaceTreeClipboardEntry.mode === 'cut' ? 'Cut' : 'Copy'} ready: ${workspaceTreeClipboardEntry.relativePath}\nWorkspace: ${workspaceTreeClipboardEntry.workspaceRelativePath || '.'}`}
                  >
                    {workspaceTreeClipboardEntry.mode === 'cut' ? (
                      <Scissors className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="shrink-0 font-medium text-foreground">
                      {workspaceTreeClipboardEntry.mode === 'cut' ? 'Cut ready' : 'Copy ready'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{workspaceTreeClipboardEntry.relativePath}</span>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => setWorkspaceTreeClipboardEntry(null)}
                      title="Clear copied/cut workspace item"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                {workspaceTree ? (
                  <TreeNode
                    node={workspaceTree}
                    selectedPath={activeEditorTab && activeEditorTabIsFromCurrentWorkspace ? activeEditorTab.node.relativePath : null}
                    onSelect={handleSelectFile}
                    collapseToken={collapseWorkspaceTreeToken}
                    pendingCreateType={pendingWorkspaceCreateType}
                    pendingCreateName={pendingWorkspaceCreateName}
                    pendingCreateParentPath={pendingWorkspaceCreateParentPath}
                    onPendingCreateNameChange={setPendingWorkspaceCreateName}
                    onCommitPendingCreate={() => void commitWorkspaceCreate()}
                    onCancelPendingCreate={cancelWorkspaceCreate}
                    onDirectoryInteract={(node) => setLastWorkspaceDirectoryPath(node.relativePath)}
                    pendingCreateInputRef={pendingWorkspaceCreateInputRef}
                    pendingRenamePath={pendingWorkspaceRenamePath}
                    pendingRenameName={pendingWorkspaceRenameName}
                    onPendingRenameNameChange={setPendingWorkspaceRenameName}
                    onCommitPendingRename={() => void commitWorkspaceRename()}
                    onCancelPendingRename={cancelWorkspaceRename}
                    pendingRenameInputRef={pendingWorkspaceRenameInputRef}
                    onContextMenu={handleWorkspaceTreeContextMenu}
                    clipboardEntry={workspaceTreeClipboardEntry}
                    currentWorkspaceRelativePath={workspaceRelativePath || '.'}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading tree...
                  </div>
                )}
              </div>
              <div className="mt-1 space-y-2 rounded-md border border-border/60 px-2 pt-2 pb-1 max-h-[320px] overflow-y-auto">
                <div className="text-xs font-semibold text-muted-foreground">Project Preset</div>
                <BuildPresetInputWithHelp
                  value={presetNameInput}
                  onChange={(event) => setPresetNameInput(event.target.value)}
                  placeholder="Preset name"
                  className="h-8 text-xs"
                  helpTitle="Preset name"
                  helpDescription="Give this preset a short label so you can reuse this command and environment setup later."
                />
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    Start commands override <span className="text-muted-foreground/80">(optional)</span>
                  </div>
                  <div className="space-y-1">
                    {presetStartEntriesInput.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
                        No start override entries. Build Mode will use the detected default runtime start command for this workspace, such as <span className="font-mono">npm run dev</span> at the workspace root.
                      </div>
                    ) : null}
                    {presetStartEntriesInput.map((entry) => (
                      <div
                        key={entry.id}
                        draggable
                        onDragStart={() => setDraggingPresetStartEntryId(entry.id)}
                        onDragEnd={() => setDraggingPresetStartEntryId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (!draggingPresetStartEntryId) return;
                          movePresetStartEntry(draggingPresetStartEntryId, entry.id);
                          setDraggingPresetStartEntryId(null);
                        }}
                        className={cn(
                          'grid grid-cols-[20px_88px_minmax(0,1fr)] gap-2 rounded-md border border-border/50 bg-background/70 px-2 py-1.5',
                          draggingPresetStartEntryId === entry.id ? 'opacity-60' : ''
                        )}
                      >
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Drag to reorder start entries."
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-[11px]"
                          value={entry.role}
                          onChange={(event) => setPresetStartEntryRole(entry.id, event.target.value === 'worker' ? 'worker' : 'preview')}
                          title={entry.role === 'preview'
                            ? 'Preview: this process is treated as the main runtime and owns the preview/port.'
                            : 'Worker: this process runs alongside the preview process and is supervised with it, but does not own the preview/port.'}
                        >
                          <option value="preview">Preview</option>
                          <option value="worker">Worker</option>
                        </select>
                        <Input
                          value={entry.workspaceRelativePath}
                          onChange={(event) => updatePresetStartEntry(entry.id, { workspaceRelativePath: event.target.value })}
                          placeholder="folder"
                          className="h-8 text-[11px] font-mono"
                          title="Optional folder relative to the selected workspace path."
                        />
                        <div className="col-span-3 grid grid-cols-[minmax(0,1fr)_28px] gap-2">
                          <Input
                            value={entry.command}
                            onChange={(event) => updatePresetStartEntry(entry.id, { command: event.target.value })}
                            placeholder="npm run dev"
                            className="h-8 text-[11px] font-mono"
                            title={entry.workspaceRelativePath.trim()
                              ? 'Start command for this process.'
                              : 'Start command for this process. If you are using the workspace root folder, you usually do not need to add npm run dev here because Build Mode already uses the detected root start command by default.'}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removePresetStartEntry(entry.id)}
                            title="Remove this start entry."
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={addPresetStartEntry}
                        title="Add another start entry."
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Add start entry
                      </Button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                            aria-label="Show start commands help"
                          >
                            i
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                          Optional dev/runtime start entries. Use one row per process. Choose one Preview entry to own the preview/port. Use Worker for supporting processes. Folder is optional and runs relative to the selected workspace root.
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1 text-[10px] leading-relaxed text-muted-foreground">
                      <div>Choose one <span className="font-mono">Preview</span> entry. All others should usually be <span className="font-mono">Worker</span>.</div>
                      <div>Folder is optional and is relative to the selected workspace path.</div>
                      <div><span className="font-medium text-foreground/80">Example:</span> Preview, folder <span className="font-mono">web</span>, command <span className="font-mono">npm run dev</span></div>
                      <div><span className="font-medium text-foreground/80">Example:</span> Worker, folder <span className="font-mono">api</span>, command <span className="font-mono">npm run dev</span></div>
                    </div>
                    {parsedPresetStartEntries.issues.length > 0 ? (
                      <div className="space-y-1">
                        {parsedPresetStartEntries.issues.map((issue, index) => (
                          <div
                            key={`${issue}-${index}`}
                            className={cn(
                              'text-[10px] leading-relaxed',
                              issue.startsWith('Using legacy')
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-destructive'
                            )}
                          >
                            {issue}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <BuildPresetInputWithHelp
                  value={presetBuildCommandInput}
                  onChange={(event) => setPresetBuildCommandInput(event.target.value)}
                  placeholder="Build command override (optional)"
                  className="h-8 text-xs font-mono"
                  helpTitle="Build command override"
                  helpDescription="Optional one-shot build command used by the Build button. Example values are framework build commands such as npm run build."
                  optional
                />
                <BuildPresetInputWithHelp
                  value={presetRunCommandInput}
                  onChange={(event) => setPresetRunCommandInput(event.target.value)}
                  placeholder="Run command override (optional)"
                  className="h-8 text-xs font-mono"
                  helpTitle="Run command override"
                  helpDescription="Optional production or one-shot run command used by Run once. Use this when you want to launch the app differently from the dev start command."
                  optional
                />
                <div className="flex items-center gap-2">
                  <BuildPresetFieldHelp
                    helpTitle="Environment profile"
                    helpDescription="Choose which environment profile you are editing. Each profile can hold a different set of environment variables for this preset."
                  >
                    <select
                      className="h-8 w-full flex-1 rounded-md border border-input bg-background px-2 text-xs"
                      value={presetActiveEnvProfileId || ''}
                      onChange={(event) => switchEnvProfile(event.target.value)}
                    >
                      {presetEnvProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </BuildPresetFieldHelp>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={addEnvProfile} title="Add environment profile">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={removeEnvProfile} title="Remove environment profile">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <BuildPresetInputWithHelp
                  value={presetEnvProfiles.find((entry) => entry.id === presetActiveEnvProfileId)?.name || ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPresetEnvProfiles((current) =>
                      current.map((entry) =>
                        entry.id === presetActiveEnvProfileId
                          ? { ...entry, name: value || entry.name }
                          : entry
                      )
                    );
                  }}
                  placeholder="Env profile name"
                  className="h-8 text-xs"
                  helpTitle="Environment profile name"
                  helpDescription="Rename the selected environment profile so you can tell different variable sets apart, such as development, staging, or production."
                />
                <BuildPresetFieldHelp
                  helpTitle="Environment variables"
                  helpDescription="Enter one environment variable per line in KEY=VALUE format. These values are applied when this preset runs."
                >
                  <Textarea
                    value={presetEnvEditorText}
                    onChange={(event) => setPresetEnvEditorText(event.target.value)}
                    placeholder="Environment variables (KEY=VALUE per line)"
                    className="min-h-[96px] text-[11px] font-mono"
                  />
                </BuildPresetFieldHelp>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => void savePreset()} title="Save changes to this project preset.">
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => void createPresetFromCurrent()}
                    title="Create a new preset from the current command and environment values."
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => void deleteCurrentPreset()}
                    disabled={!selectedPresetId}
                    title="Delete the selected preset."
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
            )}

            <div ref={centerColumnRef} className="min-h-0 flex flex-col gap-0">
              <Card className="min-h-0 flex flex-1 flex-col gap-1 px-1.5 pt-2 pb-1.5">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn(
                        'h-7 rounded-md px-2 text-[11px] transition-all',
                        centerPanelView === 'preview'
                          ? 'bg-background text-foreground shadow-sm ring-1 ring-border/70'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                      )}
                      onClick={() => setCenterPanelView('preview')}
                      title="Show runtime preview."
                    >
                      Runtime Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn(
                        'h-7 rounded-md px-2 text-[11px] transition-all',
                        centerPanelView === 'editor'
                          ? 'bg-background text-foreground shadow-sm ring-1 ring-border/70'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                      )}
                      onClick={() => setCenterPanelView('editor')}
                      title="Show file editor."
                    >
                      File Editor
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">
                      {snapshot?.detection.projectType || 'unknown'} · {snapshot?.detection.previewStrategy || 'logs-only'}
                    </div>
                    <span
                      className="inline-flex"
                      title={localhostPreviewUrl
                        ? `Open runtime in external browser (${localhostPreviewUrl}).`
                        : 'Button is disabled until a preview URL/port is available.'}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        disabled={!localhostPreviewUrl}
                        onClick={() => void openPreviewInBrowser()}
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Open in browser
                      </Button>
                    </span>
                  </div>
                </div>
                <div className="my-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-0.5">
                  <div className="flex items-start justify-between">
                    <div className="text-xs font-medium text-muted-foreground">Build Fingerprint</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setBuildFingerprintCollapsed((current) => !current)}
                        title={buildFingerprintCollapsed ? 'Expand build fingerprint details.' : 'Collapse build fingerprint details.'}
                      >
                        {buildFingerprintCollapsed ? 'Expand' : 'Collapse'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void refreshFingerprint(true)}
                        disabled={fingerprintBusy}
                        title="Recalculate and refresh project fingerprint details."
                      >
                        {fingerprintBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  {!buildFingerprintCollapsed ? (
                    <div className="grid grid-cols-1 gap-0.5 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-2">
                      <div className="truncate" title={workspaceFingerprint?.workspaceRoot || snapshot?.workspaceRoot || ''}>
                        Workspace: {workspaceFingerprint?.workspaceRoot || snapshot?.workspaceRoot || 'N/A'}
                      </div>
                      <div>
                        Package: {workspaceFingerprint?.packageName
                          ? `${workspaceFingerprint.packageName}${workspaceFingerprint.packageVersion ? `@${workspaceFingerprint.packageVersion}` : ''}`
                          : 'N/A'}
                      </div>
                      <div>
                        Git: {workspaceFingerprint?.git.available
                          ? `${workspaceFingerprint.git.branch || 'detached'} · ${workspaceFingerprint.git.shortCommit || workspaceFingerprint.git.commit || 'unknown'}${workspaceFingerprint.git.dirty ? ' · dirty' : ' · clean'}`
                          : 'Not detected'}
                      </div>
                      <div>
                        Next build: {workspaceFingerprint?.next.buildId
                          ? workspaceFingerprint.next.buildId
                          : workspaceFingerprint?.next.isNextProject
                            ? 'No .next/BUILD_ID yet'
                            : 'Not a Next project'}
                      </div>
                      <div className="sm:col-span-2">
                        Runtime command: {snapshot?.runtime.activeCommand || 'N/A'}
                      </div>
                      <div className="sm:col-span-2">
                        Refreshed: {formatTimestamp(workspaceFingerprint?.generatedAt)}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-background">
                  {centerPanelView === 'editor' ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden border-b border-border/60 bg-muted/20 px-2 pt-1">
                        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-1">
                        {editorTabs.length === 0 ? (
                          <div className="px-1 py-2 text-xs text-muted-foreground">
                            No files open. Click a file in Project & Workspace to open it here.
                          </div>
                        ) : editorTabs.map((tab) => {
                          const tabKey = getBuildEditorTabKey(tab.node.relativePath, tab.workspaceRelativePath);
                          const isActiveTab = activeEditorTabKey === tabKey;
                          const isFromCurrentWorkspace = canonicalizeWorkspaceRelativePath(tab.workspaceRelativePath) === normalizedCurrentWorkspacePath;
                          return (
                            <div
                              key={tabKey}
                              className={cn(
                                'relative flex items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-xs',
                                isActiveTab && isFromCurrentWorkspace ? 'border-border bg-background text-foreground' : null,
                                isActiveTab && !isFromCurrentWorkspace ? 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200' : null,
                                !isActiveTab && isFromCurrentWorkspace ? 'border-transparent bg-muted/30 text-muted-foreground' : null,
                                !isActiveTab && !isFromCurrentWorkspace ? 'border-transparent bg-amber-100/80 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200' : null,
                              )}
                            >
                              {isActiveTab ? (
                                <span
                                  className={cn(
                                    'absolute inset-x-0 top-0 h-0.5 rounded-t-md',
                                    isFromCurrentWorkspace ? 'bg-primary' : 'bg-amber-500'
                                  )}
                                />
                              ) : null}
                              <button
                                type="button"
                                className="flex min-w-0 items-center gap-1"
                                onClick={() => {
                                  setActiveEditorTabKey(tabKey);
                                  setCenterPanelView('editor');
                                }}
                                title={`${tab.node.relativePath}\nWorkspace: ${tab.workspaceRelativePath || '.'}`}
                              >
                                {renderBuildEditorTabIcon(tab.node.relativePath, isActiveTab)}
                                <span className="max-w-[160px] truncate">{getBuildEditorTabLabel(tab.node.relativePath)}</span>
                                {tab.dirty ? <span className="text-primary">●</span> : null}
                                {!isFromCurrentWorkspace ? <span className="text-amber-600 dark:text-amber-300">●</span> : null}
                              </button>
                              <button
                                type="button"
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  closeEditorTab(tabKey);
                                }}
                                title="Close file tab"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                        </div>
                        {editorTabs.length > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 shrink-0 border border-border/50 bg-background/90 px-2 text-[11px] backdrop-blur-sm"
                            onClick={() => closeAllEditorTabs()}
                            title="Close all open files."
                          >
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Close all
                          </Button>
                        ) : null}
                      </div>
                      {activeEditorTab ? (
                        <div className="flex min-h-0 flex-1 flex-col">
                          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-background px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="min-w-0 truncate text-xs font-medium text-muted-foreground" title={activeEditorTab.node.relativePath}>
                                {activeEditorTab.node.relativePath}
                              </div>
                              {!activeEditorTabIsFromCurrentWorkspace ? (
                                <span className="shrink-0 rounded-full border border-amber-300/70 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
                                  Other workspace: {activeEditorTab.workspaceRelativePath || '.'}
                                </span>
                              ) : null}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => void saveSelectedFile()}
                              disabled={!activeEditorTab.dirty || !activeEditorTabIsFromCurrentWorkspace}
                              title="Save the current file editor content to disk."
                            >
                              <Save className="mr-1.5 h-3.5 w-3.5" />
                              Save file
                            </Button>
                          </div>
                          <div className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-scroller]:min-h-full [&_.cm-gutters]:h-full">
                            <CodeMirror
                              value={activeEditorTab.content}
                              onChange={(value) => {
                                setEditorTabs((current) => current.map((entry) => (
                                  entry.node.relativePath === activeEditorTab.node.relativePath
                                    ? { ...entry, content: value, dirty: true }
                                    : entry
                                )));
                              }}
                              className="h-full"
                              style={{ height: '100%' }}
                              height="100%"
                              basicSetup={{
                                lineNumbers: true,
                                highlightActiveLine: true,
                                highlightSelectionMatches: true,
                                foldGutter: true,
                                autocompletion: true,
                                syntaxHighlighting: true,
                              }}
                              extensions={selectedFileEditorExtensions}
                              theme={resolvedTheme === 'dark' ? oneDark : 'light'}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                          Select a file tab to edit it.
                        </div>
                      )}
                    </div>
                  ) : isIframePreviewReady ? (
                    <iframe title="Build Preview" src={snapshot?.runtime.previewUrl ?? ''} className="h-full w-full" />
                  ) : (
                    <>
                      {snapshot?.runtime.status === 'stopped' ? (
                        <div className="h-full flex flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground gap-2">
                          <TerminalIcon className="h-6 w-6" />
                          <div className="font-medium text-foreground">Runtime stopped</div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void runRuntimeAction('start')}
                            disabled={busyAction !== null}
                            title="Start runtime"
                          >
                            <Play className="h-4 w-4 mr-1.5" />
                            Start
                          </Button>
                        </div>
                      ) : null}

                      {snapshot?.runtime.status === 'starting' ? (
                        <div className="h-full flex flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground gap-2">
                          <Loader2 className="h-6 w-6 animate-spin" />
                          <div className="font-medium text-foreground">{previewStartingLabel}</div>
                        </div>
                      ) : null}

                      {snapshot?.runtime.status === 'error' ? (
                        <div className="h-full flex flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground gap-2">
                          <AlertCircle className="h-6 w-6 text-destructive" />
                          <div className="font-medium text-foreground">Runtime crashed</div>
                          <div className="max-w-[80%] text-xs text-muted-foreground break-words">
                            {previewCrashSummary}
                          </div>
                        </div>
                      ) : null}

                      {snapshot?.runtime.status === 'running' && !isIframePreviewReady ? (
                        <div className="h-full flex flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground gap-2">
                          <TerminalIcon className="h-6 w-6" />
                          <div className="font-medium text-foreground">Runtime running</div>
                          <div>
                            {snapshot.runtime.previewUrl
                              ? `Endpoint: ${snapshot.runtime.previewUrl}`
                              : 'Runtime has no embeddable HTTP preview for this project type.'}
                          </div>
                          {snapshot.detection.previewStrategy === 'external-window' ? (
                            <div className="text-xs text-muted-foreground">
                              Desktop runtime launches in a separate native window.
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </Card>

              {!terminalSectionHidden || !runtimeLogsSectionHidden ? (
                <>
                  <div
                    className="flex h-3 shrink-0 cursor-row-resize select-none touch-none items-center justify-center"
                    onMouseDown={handleBuildCenterPanelResizeStart}
                    title="Drag to resize Runtime Preview and Terminal/Runtime Logs."
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize runtime preview and lower panels"
                  >
                    <div className="h-px w-full rounded-full bg-border/70" />
                  </div>
                  <div
                    className={cn(
                      'grid min-h-0 gap-3',
                      !terminalSectionHidden && !runtimeLogsSectionHidden
                        ? 'xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
                        : 'grid-cols-1'
                    )}
                    style={{ height: `${buildLowerPanelHeight}px` }}
                  >
                  {!terminalSectionHidden ? (
                    <Card className="h-full min-h-0 overflow-hidden rounded-xl p-0">
                      <div className="flex h-full min-h-0">
                        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                            {terminalPaneSessions.length > 0 ? (
                              <div className="flex min-h-0 flex-1 flex-row overflow-hidden bg-[#0b1220]">
                                {terminalPaneSessions.map((session, index) => (
                                  <div
                                    key={session.id}
                                    className={cn(
                                      'flex min-h-0 min-w-0 flex-1 flex-col',
                                      index > 0 ? 'border-l border-border/60' : ''
                                    )}
                                  >
                                    <BuildTerminalPane
                                      accomplish={accomplish}
                                      agentId={activeAgentId || null}
                                      session={session}
                                      layoutHeightToken={buildLowerPanelHeight}
                                      isActive={session.id === activeTerminalSession?.id}
                                      onActivate={() => void activateBuildTerminalSession(session.id)}
                                      onNewTerminal={() => createBuildTerminalTab()}
                                      onSplitTerminal={() => createBuildTerminalTab(session.id)}
                                      onClearTerminal={() => clearActiveBuildTerminal()}
                                      onInterruptTerminal={() => interruptActiveBuildTerminal()}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
                                <Button size="sm" variant="outline" onClick={() => void createBuildTerminalTab()}>
                                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                                  New terminal
                                </Button>
                              </div>
                            )}
                          </div>

                          <div className="flex w-[160px] min-w-[160px] shrink-0 flex-col border-l border-border/60 bg-muted/20">
                            <div className="flex items-center justify-between border-b border-border/60 pl-2 pr-3 py-1">
                              <span className="text-[11px] font-medium text-muted-foreground">Terminals</span>
                              <div className="flex items-center">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="New terminal (Ctrl/Cmd+Shift+T)"
                                  onClick={() => void createBuildTerminalTab()}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="Split terminal (Ctrl/Cmd+Shift+D)"
                                  onClick={() => void createBuildTerminalTab(activeTerminalSession?.id)}
                                  disabled={!activeTerminalSession}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="Clear terminal (Ctrl/Cmd+L)"
                                  onClick={() => void clearActiveBuildTerminal()}
                                  disabled={!activeTerminalSession}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 ml-1 border border-dashed border-muted-foreground/30 hover:border-amber-400/60 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                                  title="Hide terminal section"
                                  onClick={() => setTerminalSectionHidden(true)}
                                >
                                  <PanelBottomClose className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
                              <TooltipProvider delayDuration={400}>
                                {(terminalSnapshot?.sessions || []).map((session) => {
                                  const isActive = session.id === terminalSnapshot?.activeSessionId;
                                  return (
                                    <Tooltip key={session.id}>
                                      <TooltipTrigger asChild>
                                        <div
                                          className={cn(
                                            'group/term flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer transition-colors',
                                            isActive
                                              ? 'bg-accent/50 text-foreground'
                                              : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
                                          )}
                                          onClick={() => void activateBuildTerminalSession(session.id)}
                                        >
                                          <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
                                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                                          {isActive ? (
                                            <button
                                              type="button"
                                              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover/term:opacity-100"
                                              title="Close active terminal"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void closeActiveBuildTerminal();
                                              }}
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          ) : null}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="w-max max-w-[280px]">
                                        <div className="mb-1 text-[11px] font-semibold">{session.title}</div>
                                        <div className="space-y-0.5 text-[10px] text-muted-foreground">
                                          <div><span className="text-foreground/70">Shell:</span> {session.shellLabel}</div>
                                          <div><span className="text-foreground/70">CWD:</span> {session.cwd}</div>
                                          {session.workspaceRelativePath ? (
                                            <div><span className="text-foreground/70">Workspace:</span> {session.workspaceRelativePath}</div>
                                          ) : null}
                                          {session.pid != null ? (
                                            <div><span className="text-foreground/70">PID:</span> {session.pid}</div>
                                          ) : null}
                                          <div><span className="text-foreground/70">Status:</span> {session.running ? 'Running' : 'Exited'}</div>
                                          <div><span className="text-foreground/70">Created:</span> {new Date(session.createdAt).toLocaleString()}</div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })}
                              </TooltipProvider>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ) : null}

                  {!runtimeLogsSectionHidden ? (
                    <Card className="h-full min-h-0 gap-0 rounded-xl p-0 flex flex-col">
                      <div className="flex items-center justify-between border-b border-border/60 px-2 py-1">
                        <div className="text-[11px] font-medium text-muted-foreground">Runtime Logs</div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            title="Export the currently shown runtime logs."
                            onClick={exportRuntimeLogs}
                            disabled={logs.length === 0}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            title="Clear the runtime log panel for this session."
                            onClick={() => {
                              void accomplish.clearBuildRuntimeLogs({ agentId: activeAgentId });
                              setLogs([]);
                              setLogCursor(0);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 ml-1 border border-dashed border-muted-foreground/30 hover:border-amber-400/60 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                            title="Hide runtime logs section"
                            onClick={() => setRuntimeLogsSectionHidden(true)}
                          >
                            <PanelBottomClose className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-hidden bg-background font-mono text-[11px] leading-tight">
                        {logs.length === 0 ? (
                          <div className="px-2 pb-2 pt-1 text-muted-foreground">No logs yet.</div>
                        ) : (
                          <Virtuoso
                            className="h-full"
                            data={logs}
                            computeItemKey={(index, entry) => entry.seq ?? index}
                            followOutput="smooth"
                            increaseViewportBy={{ top: 300, bottom: 500 }}
                            itemContent={(index, entry) => (
                              <div className={cn('px-2', index === 0 ? 'pt-1' : 'pt-0.5', index === logs.length - 1 ? 'pb-2' : 'pb-0.5')}>
                                <BuildRuntimeLogRow entry={entry} />
                              </div>
                            )}
                          />
                        )}
                      </div>
                    </Card>
                  ) : null}
                  </div>
                </>
              ) : null}
            </div>

            <Card className="min-h-0 flex flex-col p-3 gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">AI Build Operator</div>
                  {activeEditorTab ? (
                    <span
                      className="inline-flex max-w-[260px] items-center truncate rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                      title={`Editing: ${activeEditorTab.node.relativePath}`}
                    >
                      File editor open
                    </span>
                  ) : null}
                </div>
                <div ref={historyRowRef} className="relative">
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
                    <div className="min-w-0 truncate text-xs text-muted-foreground" title={currentTaskPreviewText}>
                      {currentTaskPreviewText}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="New task"
                        onClick={() => {
                          handleStartNewHistorySession();
                          setHistoryDropdownOpen(false);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Task history"
                        onClick={() => setHistoryDropdownOpen((current) => !current)}
                      >
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant={historyArchivedOnly ? 'outline' : 'ghost'}
                        className="h-7 w-7"
                        title="Archived"
                        onClick={() => setHistoryArchivedOnly((current) => !current)}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {historyDropdownOpen ? (
                    <div
                      ref={historyDropdownRef}
                      className="absolute right-0 top-[calc(100%+6px)] z-50 w-[380px] rounded-xl border bg-popover p-2 text-popover-foreground shadow-md outline-none"
                    >
                      <div className="relative mb-2">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                        <Input
                          value={historyQuery}
                          onChange={(event) => setHistoryQuery(event.target.value)}
                          placeholder="Search tasks..."
                          className="h-8 pl-7 text-xs"
                        />
                      </div>
                      <div className="max-h-72 overflow-auto space-y-1 pr-1">
                        {visibleHistorySessions.length === 0 ? (
                          <div className="px-1 py-1 text-[11px] text-muted-foreground">
                            {historyBusy ? 'Loading tasks…' : 'No tasks found.'}
                          </div>
                        ) : visibleHistorySessions.map((session) => {
                          const isActiveSession = activeHistorySessionId === session.id;
                          const isArchived = session.lifecycleStatus === 'archived';
                          return (
                            <div
                              key={session.id}
                              className={cn(
                                'flex items-center gap-1 rounded-md border px-1.5 py-1',
                                isActiveSession ? 'border-primary/40 bg-primary/10' : 'border-border/50 bg-background/70'
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  void restoreHistorySession(session.id);
                                  setHistoryDropdownOpen(false);
                                }}
                                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                                title={session.titleSourcePrompt}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium">
                                    {session.pinned ? '★ ' : ''}{session.title}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {formatSessionStatus(session.lifecycleStatus)} · {formatAgeShort(session.lastActivityAt)}
                                    {session.tokenTotal ? ` · ${formatTokensShort(session.tokenTotal)} tok` : ''}
                                  </div>
                                </div>
                              </button>
                              <div className="flex items-center gap-0.5">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={cn('h-6 w-6', session.pinned ? 'text-amber-500' : '')}
                                  title={session.pinned ? 'Unpin session' : 'Pin session'}
                                  onClick={() => void handleTogglePinHistorySession(session)}
                                >
                                  <Star className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="Rename session"
                                  onClick={() => void handleRenameHistorySession(session)}
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title={isArchived ? 'Reopen session' : 'Archive session'}
                                  onClick={() => void handleToggleArchiveHistorySession(session)}
                                >
                                  {isArchived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-destructive hover:text-destructive"
                                  title="Delete session"
                                  onClick={() => void handleDeleteHistorySession(session)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {subagentParentTaskId ? (
                <div className="rounded-md border border-border/60 bg-muted/10 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-foreground">Subagents</div>
                      <div className="text-[11px] text-muted-foreground">
                        {subagentRunsLoading ? 'Refreshing…' : `${subagentRuns.length} tracked`}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title={subagentsCollapsed ? 'Expand subagents' : 'Collapse subagents'}
                      onClick={() => setSubagentsCollapsed((current) => !current)}
                    >
                      {subagentsCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  {subagentRuns.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground">
                      No child agents have been spawned for this task yet.
                    </div>
                  ) : subagentsCollapsed ? (
                    <div
                      className="overflow-y-auto pr-1"
                      style={{ maxHeight: `${BUILD_SUBAGENTS_PANEL_MAX_HEIGHT}px` }}
                    >
                      <div className="space-y-1">
                        {subagentRuns.map((run) => (
                          <div key={run.runId} className="flex items-start justify-between gap-2 rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-[11px]">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {run.label || run.childAgentId}
                              </div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {run.task || 'No task summary available.'}
                              </div>
                            </div>
                            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', getSubagentRunStatusClasses(run.status, run.resultStatus))}>
                              {formatSubagentRunStatus(run.status, run.resultStatus)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="overflow-y-auto pr-1"
                      style={{ maxHeight: `${BUILD_SUBAGENTS_PANEL_MAX_HEIGHT}px` }}
                    >
                      <BuildSubagentTreeList
                        nodes={subagentTree}
                        stoppingSubagentRunId={stoppingSubagentRunId}
                        onOpen={(run) => void loadSubagentDetail(run)}
                        onStop={(runId) => void stopSubagentRun(runId)}
                        onCloseSession={(runId) => void closeSubagentRun(runId)}
                      />
                    </div>
                  )}
                </div>
              ) : null}

              <div className="relative min-h-0 flex-1">
                <div className="h-full min-h-0 overflow-hidden rounded-md border border-border/60">
                  {assistantMessages.length === 0 ? (
                    <div className="flex h-full items-start p-2 text-xs text-muted-foreground">No AI reasoning yet.</div>
                  ) : (
                    <Virtuoso
                      ref={assistantMessagesVirtuosoRef}
                      className="h-full"
                      data={assistantMessages}
                      defaultItemHeight={168}
                      computeItemKey={(_index, message) => message.id}
                      increaseViewportBy={{ top: 220, bottom: 320 }}
                      followOutput={(isAtBottom) => {
                        if (!aiBusy) return false;
                        return isAtBottom ? 'auto' : false;
                      }}
                      atBottomStateChange={(isAtBottom) => {
                        assistantNearBottomRef.current = isAtBottom;
                        setAssistantNearBottom(isAtBottom);
                      }}
                      itemContent={(index, message) => (
                        <div className={cn('px-2', index === 0 ? 'pt-2' : 'pt-0.5', index === assistantMessages.length - 1 ? 'pb-2' : 'pb-1.5')}>
                          <BuildAssistantMessageItem
                            message={message}
                            copied={copiedAssistantMessageId === message.id}
                            expandedToolMessage={Boolean(expandedToolMessageIds[message.id])}
                            proseClasses={assistantProseClasses}
                            onCopy={(messageId, content) => {
                              void handleCopyAssistantMessage(messageId, content);
                            }}
                            onToggleToolMessage={toggleToolMessageExpanded}
                            onContentRef={handleAssistantMessageContentRef}
                          />
                        </div>
                      )}
                    />
                  )}
                </div>
                {!assistantNearBottom && assistantMessages.length > 0 ? (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute bottom-3 left-1/2 z-10 h-8 w-8 -translate-x-1/2 rounded-full shadow-md"
                    title="Jump to latest AI messages"
                    onClick={() => scrollAssistantMessagesToBottom('smooth')}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>

              <BuildPromptComposer
                resetKey={promptComposerResetKey}
                initialValue={goalPrompt}
                attachedFiles={promptAttachedFiles}
                aiBusy={aiBusy}
                interruptingAiTask={interruptingAiTask}
                autoRepairBusy={autoRepairBusy}
                contextStats={contextStats}
                onDraftChange={syncGoalPromptState}
                onRun={handleRunPrompt}
                onStop={handleStopPrompt}
                onAttachFiles={() => {
                  void handleSelectPromptFiles();
                }}
                onRemoveFile={removePromptAttachedFile}
                slashCommands={buildSlashCommands}
              />

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-muted-foreground">Proposed Changes / Diff</div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(
                      'h-6 w-6',
                      diffCollapsed ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300' : null
                    )}
                    title={diffCollapsed ? 'Expand proposed changes' : 'Collapse proposed changes'}
                    onClick={() => setDiffCollapsed((current) => !current)}
                  >
                    {diffCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <div className="rounded-md border border-border/60 p-2 text-xs">
                  {diffCollapsed ? (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{diff?.summary || 'No diff summary available.'}</span>
                      <span className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 uppercase tracking-wide">
                        Mode: {diff?.mode || 'none'}
                      </span>
                      <span className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5">
                        Files: {diff?.files?.length || 0}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 whitespace-pre-wrap text-muted-foreground">{diff?.summary || 'No diff summary available.'}</div>
                      {diffEmptyReason ? (
                        <div className="mb-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
                          {diffEmptyReason}
                        </div>
                      ) : null}
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 uppercase tracking-wide text-muted-foreground">
                          Mode: {diff?.mode || 'none'}
                        </span>
                        <span className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-muted-foreground">
                          Safety: {buildDiffEnforcementMode}
                        </span>
                        {buildDiffEnforcementMode === 'approval'
                          && pendingDiffBaselineId
                          && diff?.mode === 'synthetic'
                          && (diff?.files?.length || 0) > 0 ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              disabled={resolvingDiffDecision !== null}
                              onClick={() => void resolvePendingDiffBaseline('approve')}
                              title="Approve pending AI changes and keep them."
                            >
                              {resolvingDiffDecision === 'approve' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              disabled={resolvingDiffDecision !== null}
                              onClick={() => void resolvePendingDiffBaseline('reject')}
                              title="Reject pending AI changes and restore baseline files."
                            >
                              {resolvingDiffDecision === 'reject' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                              Reject
                            </Button>
                          </>
                        ) : null}
                      </div>
                      <pre className="max-h-36 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">{diff?.patch || 'No patch available.'}</pre>
                      {(diff?.files?.length || 0) > 0 ? (
                        <div className="mt-2 grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-[220px_1fr]">
                          <div className="max-h-52 overflow-auto rounded-md border border-border/60 bg-muted/20 p-1">
                            {diff?.files?.map((file) => {
                              const selected = selectedDiffFile?.relativePath === file.relativePath;
                              return (
                                <button
                                  key={file.relativePath}
                                  type="button"
                                  onClick={() => setSelectedDiffFilePath(file.relativePath)}
                                  className={cn(
                                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px]',
                                    selected ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/50 text-muted-foreground'
                                  )}
                                  title={file.relativePath}
                                >
                                  <span className="truncate">{file.relativePath}</span>
                                  <span className="shrink-0 uppercase">{file.changeType}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-2">
                            <div className="min-h-0">
                              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Before</div>
                              <pre className="max-h-52 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-[11px] leading-relaxed">
                                {selectedDiffFile?.beforeContent || '(new file)'}
                              </pre>
                            </div>
                            <div className="min-h-0">
                              <div className="mb-1 text-[11px] font-medium text-muted-foreground">After</div>
                              <pre className="max-h-52 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-[11px] leading-relaxed">
                                {selectedDiffFile?.afterContent || '(deleted file)'}
                              </pre>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

            </Card>
          </div>

        </div>
      </div>
      <Dialog open={Boolean(subagentDetailRun)} onOpenChange={(open) => {
        if (!open && !subagentDetailSending) {
          setSubagentDetailRun(null);
          setSubagentDetailTask(null);
          setSubagentDetailPrompt('');
          setSubagentDetailModelOverride('');
        }
      }}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {subagentDetailRun ? `Subagent: ${subagentDetailRun.label || subagentDetailRun.childAgentId}` : 'Subagent'}
            </DialogTitle>
            <DialogDescription>
              {subagentDetailRun
                ? `Child agent ${subagentDetailRun.childAgentId} · ${formatSubagentRunStatus(subagentDetailRun.status, subagentDetailRun.resultStatus)} · ${formatSubagentModeLabel(subagentDetailRun).toLowerCase()}`
                : 'Tracked child agent session'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
            <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
              {subagentDetailRun?.task || 'No task summary available.'}
            </div>
            {subagentDetailRun ? (
              <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                <div>Child session key: {subagentDetailRun.childSessionKey}</div>
                {subagentDetailRun.sessionId ? <div>Session id: {subagentDetailRun.sessionId}</div> : null}
                {typeof subagentDetailRun.reuseCount === 'number' ? <div>Session reuse count: {subagentDetailRun.reuseCount}</div> : null}
                {subagentDetailRun.closedAt ? <div>Closed at: {new Date(subagentDetailRun.closedAt).toLocaleString()}</div> : null}
                {subagentDetailRun.archivedAt ? <div>Archived at: {new Date(subagentDetailRun.archivedAt).toLocaleString()}</div> : null}
              </div>
            ) : null}
            {subagentDetailRun?.inheritedContext || subagentDetailRun?.executionPolicy ? (
              <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                <div className="font-medium text-foreground">Inherited context</div>
                {subagentDetailRun.inheritedContext?.workingDirectory ? <div>Working directory: {subagentDetailRun.inheritedContext.workingDirectory}</div> : null}
                {Array.isArray(subagentDetailRun.inheritedContext?.attachedFiles) && subagentDetailRun.inheritedContext?.attachedFiles?.length ? (
                  <div>Attached files: {subagentDetailRun.inheritedContext.attachedFiles.length}</div>
                ) : (
                  <div>Attached files: none</div>
                )}
                <div>Privacy mode: {subagentDetailRun.inheritedContext?.privacyMode || 'normal'}</div>
                {subagentDetailRun.executionPolicy ? (
                  <>
                    <div className="mt-2 font-medium text-foreground">Execution policy</div>
                    <div>Inherited from parent agent: {subagentDetailRun.executionPolicy.inheritedFromAgentId}</div>
                    <div>Default mode: {subagentDetailRun.executionPolicy.mode}</div>
                    <div>Max children: {subagentDetailRun.executionPolicy.maxChildren}</div>
                    <div>Max depth: {subagentDetailRun.executionPolicy.maxDepth}</div>
                    <div>Timeout: {Math.round(subagentDetailRun.executionPolicy.runTimeoutMs / 1000)}s</div>
                    <div>Auto relay completions: {subagentDetailRun.executionPolicy.autoRelayCompletions ? 'on' : 'off'}</div>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="max-h-[420px] overflow-y-auto rounded-md border border-border/60 bg-background/70 p-3">
              {subagentDetailLoading ? (
                <div className="text-xs text-muted-foreground">Loading transcript…</div>
              ) : !subagentDetailTask || subagentDetailTask.messages.length === 0 ? (
                <div className="text-xs text-muted-foreground">No transcript available yet.</div>
              ) : (
                <div className="space-y-3">
                  {subagentDetailTask.messages.map((message) => (
                    <div key={message.id} className="rounded-md border border-border/50 bg-background px-3 py-2">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {formatBuildAssistantPanelMessageType(message)}
                      </div>
                      <div className={assistantProseClasses}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content || ''}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Send follow-up to child session</label>
                <Textarea
                  value={subagentDetailPrompt}
                  onChange={(event) => setSubagentDetailPrompt(event.target.value)}
                  placeholder="Ask the child agent to continue or refine its work..."
                  className="min-h-[88px]"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground">Model override for next child turns</label>
                <select
                  value={subagentDetailModelOverride}
                  onChange={(event) => setSubagentDetailModelOverride(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={subagentDetailSending || availableSubagentModelOptions.length === 0}
                >
                  <option value="">Keep current child model</option>
                  {modelProviders
                    .filter((provider) => availableSubagentModelOptions.some((entry) => entry.providerId === String(provider.id)))
                    .map((provider) => (
                      <optgroup key={provider.id} label={provider.name}>
                        {availableSubagentModelOptions
                          .filter((entry) => entry.providerId === String(provider.id))
                          .map((entry) => (
                            <option key={entry.value} value={entry.value}>
                              {entry.displayName}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                </select>
                <div className="text-[11px] text-muted-foreground">
                  {subagentDetailRun?.model
                    ? `Current child model: ${subagentDetailRun.model.provider}:${subagentDetailRun.model.model}`
                    : 'No explicit child model override is currently set.'}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {availableSubagentModelOptions.length === 0
                    ? 'No selectable models are available here yet. Add an API key or local provider first.'
                    : 'Only models with a configured API key or local runtime are listed.'}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSubagentDetailRun(null);
                setSubagentDetailTask(null);
                setSubagentDetailPrompt('');
                setSubagentDetailModelOverride('');
              }}
              disabled={subagentDetailSending || subagentDetailMutating}
            >
              Close
            </Button>
            <Button
              variant="outline"
              onClick={() => subagentDetailRun && void stopSubagentRun(subagentDetailRun.runId)}
              disabled={subagentDetailSending || subagentDetailMutating || !subagentDetailRun || !(subagentDetailRun.status === 'running' || subagentDetailRun.status === 'accepted')}
            >
              Stop
            </Button>
            <Button
              variant="outline"
              onClick={() => void closeSubagentDetailSession()}
              disabled={subagentDetailSending || subagentDetailMutating || !subagentDetailRun}
            >
              {subagentDetailMutating ? 'Working…' : 'Close session'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void archiveSubagentDetail()}
              disabled={subagentDetailSending || subagentDetailMutating || !subagentDetailRun}
            >
              {subagentDetailMutating ? 'Working…' : 'Archive'}
            </Button>
            <Button
              onClick={() => void sendSubagentFollowUp()}
              disabled={!subagentDetailPrompt.trim() || subagentDetailSending || subagentDetailMutating || !subagentDetailTask}
            >
              {subagentDetailSending ? 'Sending…' : 'Send follow-up'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {workspaceTreeContextMenu ? (
        <div
          ref={workspaceTreeContextMenuRef}
          className="fixed z-[90] min-w-[220px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{
            left: Math.max(8, Math.min(workspaceTreeContextMenu.x, window.innerWidth - 240)),
            top: Math.max(8, Math.min(workspaceTreeContextMenu.y, window.innerHeight - 240)),
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => void revealWorkspaceEntryInExplorer(workspaceTreeContextMenu.node)}
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            Reveal in file explorer
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => void copyWorkspaceEntryPath(workspaceTreeContextMenu.node, 'cut')}
          >
            <Scissors className="h-4 w-4 text-muted-foreground" />
            Cut
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => void copyWorkspaceEntryPath(workspaceTreeContextMenu.node, 'copy')}
          >
            <Copy className="h-4 w-4 text-muted-foreground" />
            Copy
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!workspaceTreeClipboardEntry}
            onClick={() => void pasteWorkspaceEntryIntoNode(workspaceTreeContextMenu.node)}
          >
            <Clipboard className="h-4 w-4 text-muted-foreground" />
            Paste
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={workspaceTreeContextMenu.node.relativePath === workspaceTree?.relativePath}
            onClick={() => beginWorkspaceRename(workspaceTreeContextMenu.node)}
          >
            <Edit3 className="h-4 w-4 text-muted-foreground" />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={workspaceTreeContextMenu.node.relativePath === workspaceTree?.relativePath}
            onClick={() => void deleteWorkspaceEntryFromTree(workspaceTreeContextMenu.node)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      ) : null}
      {buildHoverTooltip ? (() => {
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const tooltipHalfWidth = 160;
        const clampedLeft = Math.min(
          Math.max(buildHoverTooltip.x, tooltipHalfWidth + 12),
          viewportWidth - tooltipHalfWidth - 12
        );
        const showBelow = buildHoverTooltip.y < 120;

        return (
          <div
            className="pointer-events-none fixed z-[90] max-w-xs rounded-md border border-border/70 bg-popover px-2 py-1.5 text-[11px] leading-relaxed text-popover-foreground shadow-md whitespace-pre-line"
            style={{
              left: clampedLeft,
              top: showBelow ? (buildHoverTooltip.y + 18) : Math.max(12, buildHoverTooltip.y - 12),
              transform: showBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
            }}
          >
            {buildHoverTooltip.content}
          </div>
        );
      })() : null}
    </div>
    </TooltipProvider>
  );
}
