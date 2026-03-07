'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  BuildTaskSession,
  BuildTaskSessionListItem,
  BuildWorkspaceFingerprint,
  BuildWorkspaceDiff,
  ContextWindowEstimateResponse,
  SelectedModel,
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
  Star,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';
import { getAccomplish } from '@/lib/accomplish';
import ModeSwitch from '@/components/layout/ModeSwitch';
import ContextWindowIndicator from '@/components/chat/ContextWindowIndicator';
import { useTheme } from '@/contexts/ThemeContext';

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

const BUILD_EDITOR_LAYOUT_STORAGE_PREFIX = 'opendeskmate:build-editor-layout:v1';

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
  return `${normalizeFsPath(workspaceRelativePath || '.') || '.'}::${normalizeFsPath(relativePath || '')}`;
}

function toWorkspaceScopedRelativePath(fullRelativePath: string, workspaceRelativePath: string): string {
  const normalizedFullPath = normalizeFsPath(fullRelativePath || '.') || '.';
  const normalizedWorkspacePath = normalizeFsPath(workspaceRelativePath || '.') || '.';

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
    message.type === 'user'
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
    && normalizeFsPath(clipboardEntry.workspaceRelativePath || '.') === normalizeFsPath(currentWorkspaceRelativePath || '.');
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
          title={isDir ? `Toggle folder: ${node.relativePath}` : `Open file: ${node.relativePath}`}
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

export default function BuildPage() {
  const accomplish = getAccomplish();
  const { resolvedTheme } = useTheme();
  const { activeAgentId, agents, loadAgents } = useAgentStore();
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);

  const [workspaceRelativePath, setWorkspaceRelativePath] = useState('.');
  const [agentWorkspaceRoot, setAgentWorkspaceRoot] = useState<string | null>(null);
  const [presets, setPresets] = useState<BuildProjectPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | undefined>(undefined);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [presetStartCommandInput, setPresetStartCommandInput] = useState('');
  const [presetBuildCommandInput, setPresetBuildCommandInput] = useState('');
  const [presetRunCommandInput, setPresetRunCommandInput] = useState('');
  const [presetEnvProfiles, setPresetEnvProfiles] = useState<BuildEnvProfile[]>([createDefaultEnvProfile()]);
  const [presetActiveEnvProfileId, setPresetActiveEnvProfileId] = useState<string | undefined>(undefined);
  const [presetEnvEditorText, setPresetEnvEditorText] = useState('');
  const [snapshot, setSnapshot] = useState<BuildSessionSnapshot | null>(null);
  const [globalSelectedModel, setGlobalSelectedModel] = useState<SelectedModel | null>(null);
  const [logs, setLogs] = useState<BuildLogEntry[]>([]);
  const [logCursor, setLogCursor] = useState(0);
  const [workspaceTree, setWorkspaceTree] = useState<BuildFileTreeNode | null>(null);
  const [editorTabs, setEditorTabs] = useState<BuildEditorTab[]>([]);
  const [activeEditorTabKey, setActiveEditorTabKey] = useState<string | null>(null);
  const [centerPanelView, setCenterPanelView] = useState<'preview' | 'editor'>('preview');
  const [diff, setDiff] = useState<BuildWorkspaceDiff | null>(null);
  const [buildDiffEnforcementMode, setBuildDiffEnforcementMode] = useState<BuildDiffEnforcementMode>('preview-only');
  const [pendingDiffBaselineId, setPendingDiffBaselineId] = useState<string | null>(null);
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<string | null>(null);
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
  const [aiTaskId, setAiTaskId] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<TaskMessage[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
  const [expandedToolMessageIds, setExpandedToolMessageIds] = useState<Record<string, boolean>>({});
  const [assistantNearBottom, setAssistantNearBottom] = useState(true);
  const [autoRestart, setAutoRestart] = useState(true);
  const [autoRepairEnabled, setAutoRepairEnabled] = useState(true);
  const [autoRepairBusy, setAutoRepairBusy] = useState(false);
  const [lastRepairFingerprint, setLastRepairFingerprint] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [buildFingerprintCollapsed, setBuildFingerprintCollapsed] = useState(false);
  const [runtimeLogsCollapsed, setRuntimeLogsCollapsed] = useState(false);

  const [pendingWorkspaceCreateType, setPendingWorkspaceCreateType] = useState<'file' | 'folder' | null>(null);
  const [pendingWorkspaceCreateName, setPendingWorkspaceCreateName] = useState('');
  const [pendingWorkspaceCreateParentPath, setPendingWorkspaceCreateParentPath] = useState<string | null>(null);
  const [pendingWorkspaceRenamePath, setPendingWorkspaceRenamePath] = useState<string | null>(null);
  const [pendingWorkspaceRenameName, setPendingWorkspaceRenameName] = useState('');
  const [workspaceTreeContextMenu, setWorkspaceTreeContextMenu] = useState<WorkspaceTreeContextMenuState | null>(null);
  const [workspaceTreeClipboardEntry, setWorkspaceTreeClipboardEntry] = useState<WorkspaceTreeClipboardEntry | null>(null);
  const [lastWorkspaceDirectoryPath, setLastWorkspaceDirectoryPath] = useState<string | null>(null);
  const [collapseWorkspaceTreeToken, setCollapseWorkspaceTreeToken] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const logsRef = useRef<HTMLDivElement | null>(null);
  const assistantMessagesRef = useRef<HTMLDivElement | null>(null);
  const assistantMessageContentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const restoringHistoryRef = useRef(false);
  const pendingHistoryRestoreScrollRef = useRef(false);
  const historyRowRef = useRef<HTMLDivElement | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const assistantNearBottomRef = useRef(true);
  const assistantScrollRafRef = useRef<number | null>(null);
  const restoringEditorLayoutRef = useRef(false);
  const pendingWorkspaceCreateInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkspaceRenameInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceTreeContextMenuRef = useRef<HTMLDivElement | null>(null);

  const isAssistantPanelNearBottom = useCallback((element: HTMLDivElement): boolean => {
    const thresholdPx = 72;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    return remaining <= thresholdPx;
  }, []);

  const handleAssistantMessagesScroll = useCallback(() => {
    if (assistantScrollRafRef.current !== null) return;
    assistantScrollRafRef.current = window.requestAnimationFrame(() => {
      assistantScrollRafRef.current = null;
      const element = assistantMessagesRef.current;
      if (!element) return;
      const nearBottom = isAssistantPanelNearBottom(element);
      if (assistantNearBottomRef.current === nearBottom) return;
      assistantNearBottomRef.current = nearBottom;
      setAssistantNearBottom(nearBottom);
    });
  }, [isAssistantPanelNearBottom]);

  const scrollAssistantMessagesToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = assistantMessagesRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    assistantNearBottomRef.current = true;
    setAssistantNearBottom(true);
  }, []);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  );
  const workspaceFolderName = useMemo(() => {
    if (snapshot?.workspaceRoot) return pathLeaf(snapshot.workspaceRoot);
    return pathLeaf(workspaceRelativePath);
  }, [snapshot?.workspaceRoot, workspaceRelativePath]);
  const workspaceFolderChosen = useMemo(
    () => normalizeFsPath(workspaceRelativePath || '.') !== '.',
    [workspaceRelativePath]
  );
  const normalizedCurrentWorkspacePath = useMemo(
    () => normalizeFsPath(workspaceRelativePath || '.') || '.',
    [workspaceRelativePath]
  );
  const buildEditorLayoutStorageKey = useMemo(
    () => (activeAgentId ? getBuildEditorLayoutStorageKey(activeAgentId) : null),
    [activeAgentId]
  );
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
    () => (!activeEditorTab ? true : normalizeFsPath(activeEditorTab.workspaceRelativePath || '.') === normalizedCurrentWorkspacePath),
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

  const restoreHistorySession = useCallback(async (sessionId: string) => {
    try {
      const session = await accomplish.getBuildTaskHistorySession({ sessionId });
      if (!session) return;
      restoringHistoryRef.current = true;
      pendingHistoryRestoreScrollRef.current = true;
      const hasRecordedRuns = (session.runs?.length || 0) > 0;
      setActiveHistorySessionId(session.id);
      setGoalPrompt(hasRecordedRuns ? '' : (session.execution.goalPrompt || ''));
      setPromptAttachedFiles([]);
      setWorkspaceRelativePath(session.execution.workspaceRelativePath || '.');
      setSelectedPresetId(session.execution.selectedPresetId || null);
      setAiMessages(session.messages || []);
      setDiff(session.execution.latestDiff || null);
      setWorkspaceFingerprint(session.execution.latestFingerprint || null);
      setLogs(session.execution.runtimeLogs || []);
      if (session.execution.runtimeLogs.length > 0) {
        const maxSeq = session.execution.runtimeLogs.reduce((max, entry) => Math.max(max, entry.seq), 0);
        setLogCursor(maxSeq + 1);
      } else {
        setLogCursor(0);
      }
      if (session.execution.latestSnapshot) {
        setSnapshot(session.execution.latestSnapshot);
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
  }, [accomplish]);

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

      const fallbackPresetId = preferredPresetId || result.activePresetId || result.presets[0]?.id || null;
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
      setSnapshot(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const refreshTree = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const tree = await accomplish.getBuildWorkspaceTree({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        depth: 4,
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
        setLogs((current) => [...current, ...response.logs].slice(-1800));
        setLogCursor(response.nextCursor);
      }
    } catch {
      // Ignore transient log polling errors.
    }
  }, [accomplish, activeAgentId, logCursor]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    let cancelled = false;
    void accomplish.getSelectedModel()
      .then((selected) => {
        if (cancelled) return;
        setGlobalSelectedModel(selected ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setGlobalSelectedModel(null);
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
    setActiveHistorySessionId(null);
    setActiveHistoryRunTaskId(null);
    setActiveHistorySessionToken(null);
    setHistoryDropdownOpen(false);
    void refreshPresets(null);
    void refreshHistorySessions('');
    void accomplish.getBuildWorkspaceRoot({ agentId: activeAgentId })
      .then((result) => setAgentWorkspaceRoot(result.workspaceRoot))
      .catch(() => setAgentWorkspaceRoot(null));
  }, [activeAgentId, refreshPresets, refreshHistorySessions]);

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
    if (!selectedPreset) {
      setPresetNameInput('');
      setPresetStartCommandInput('');
      setPresetBuildCommandInput('');
      setPresetRunCommandInput('');
      const fallbackProfile = createDefaultEnvProfile();
      setPresetEnvProfiles([fallbackProfile]);
      setPresetActiveEnvProfileId(fallbackProfile.id);
      setPresetEnvEditorText('');
      return;
    }

    setPresetNameInput(selectedPreset.name);
    setPresetStartCommandInput(selectedPreset.commands.startCommand || '');
    setPresetBuildCommandInput(selectedPreset.commands.buildCommand || '');
    setPresetRunCommandInput(selectedPreset.commands.runCommand || '');

    const profiles = selectedPreset.envProfiles.length > 0 ? selectedPreset.envProfiles : [createDefaultEnvProfile()];
    setPresetEnvProfiles(profiles);
    const profileId = selectedPreset.activeEnvProfileId || profiles[0]?.id;
    setPresetActiveEnvProfileId(profileId);
    const profile = profiles.find((entry) => entry.id === profileId) || profiles[0];
    setPresetEnvEditorText(envVarsToText(profile?.variables || {}));

    if (selectedPreset.workspaceRelativePath) {
      setWorkspaceRelativePath((current) =>
        selectedPreset.workspaceRelativePath && selectedPreset.workspaceRelativePath !== current
          ? selectedPreset.workspaceRelativePath
          : current
      );
    }
  }, [selectedPreset]);

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
    return () => {
      clearInterval(runtimeInterval);
      clearInterval(logInterval);
    };
  }, [refreshSnapshot, refreshLogs]);

  useEffect(() => {
    if (!logsRef.current) return;
    logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => () => {
    if (assistantScrollRafRef.current !== null) {
      window.cancelAnimationFrame(assistantScrollRafRef.current);
      assistantScrollRafRef.current = null;
    }
  }, []);

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
    const element = assistantMessagesRef.current;
    if (!element) return;
    if (!aiBusy) return;
    if (!assistantNearBottom) return;
    element.scrollTop = element.scrollHeight;
  }, [aiMessages, aiBusy, assistantNearBottom]);

  useEffect(() => {
    if (!pendingHistoryRestoreScrollRef.current) return;
    scrollAssistantMessagesToBottom('auto');
    pendingHistoryRestoreScrollRef.current = false;
  }, [aiMessages, scrollAssistantMessagesToBottom]);

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
          if (!TERMINAL_TASK_STATES.has(task.status)) {
            void refreshDiff();
          }
          if (TERMINAL_TASK_STATES.has(task.status)) {
            setAiBusy(false);
            setAiTaskId(null);
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
    }, 450);

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
    }, 450);
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
    setSelectedPresetId(presetId);
    try {
      const nextActive = presetId || null;
      await accomplish.setActiveBuildPreset({ agentId: activeAgentId, presetId: nextActive });
      setActivePresetId(nextActive || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId]);

  const savePreset = useCallback(async () => {
    if (!activeAgentId) return;
    const profileId = presetActiveEnvProfileId || presetEnvProfiles[0]?.id;
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
        startCommand: presetStartCommandInput || undefined,
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
    presetRunCommandInput,
    presetStartCommandInput,
    presets.length,
    refreshPresets,
    selectedPresetId,
    workspaceRelativePath,
  ]);

  const createPresetFromCurrent = useCallback(async () => {
    if (!activeAgentId) return;
    const base = presetNameInput.trim() || `Preset ${presets.length + 1}`;
    const activeProfileId = presetActiveEnvProfileId || presetEnvProfiles[0]?.id;
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
        startCommand: presetStartCommandInput || undefined,
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
    presetRunCommandInput,
    presetStartCommandInput,
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

  const runRuntimeAction = useCallback(async (action: 'start' | 'stop' | 'restart' | 'build' | 'run-once') => {
    if (!activeAgentId) return;
    setBusyAction(action);
    setError(null);
    try {
      const startCommandOverride = selectedPreset?.commands.startCommand || undefined;
      const buildCommandOverride = selectedPreset?.commands.buildCommand || undefined;
      const runCommandOverride = selectedPreset?.commands.runCommand || undefined;

      if (action === 'start') {
        const next = await accomplish.startBuildRuntime({
          agentId: activeAgentId,
          workspaceRelativePath,
          autoRestart,
          mode: 'dev',
          commandOverride: startCommandOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot(next);
      } else if (action === 'stop') {
        setSnapshot(await accomplish.stopBuildRuntime({ agentId: activeAgentId }));
      } else if (action === 'restart') {
        setSnapshot(await accomplish.restartBuildRuntime({ agentId: activeAgentId }));
      } else if (action === 'build') {
        const result = await accomplish.runBuildCommand({
          agentId: activeAgentId,
          workspaceRelativePath,
          commandOverride: buildCommandOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot(result.snapshot);
      } else if (action === 'run-once') {
        const result = await accomplish.runStartCommandOnce({
          agentId: activeAgentId,
          workspaceRelativePath,
          commandOverride: runCommandOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot(result.snapshot);
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
      if ((normalizeFsPath(entry.workspaceRelativePath || '.') || '.') !== normalizedSourceWorkspace) {
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
        if ((normalizeFsPath(entry.workspaceRelativePath || '.') || '.') !== normalizedWorkspace) {
          return true;
        }
        return !pathMatchesOrDescendsFrom(entry.node.relativePath, targetPath);
      });
      setActiveEditorTabKey((currentKey) => {
        if (!currentKey) return currentKey;
        const activeEntry = current.find((entry) => getBuildEditorTabKey(entry.node.relativePath, entry.workspaceRelativePath) === currentKey);
        if (!activeEntry) return currentKey;
        if ((normalizeFsPath(activeEntry.workspaceRelativePath || '.') || '.') !== normalizedWorkspace) {
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

  const runAiGoal = useCallback(async () => {
    if (!activeAgentId || !snapshot || !goalPrompt.trim()) return;
    if (buildDiffEnforcementMode === 'approval' && pendingDiffBaselineId && (diff?.needsApproval || (diff?.files || []).length > 0)) {
      setError('Resolve pending proposed changes first (Approve or Reject) before starting a new AI task.');
      return;
    }

    setError(null);
    setAiBusy(true);
    try {
      const userGoalPrompt = goalPrompt.trim();
      const localGoalMessage: TaskMessage = {
        id: `local-build-goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'user',
        content: userGoalPrompt,
        timestamp: new Date().toISOString(),
      };
      setAiMessages((current) => [...current, localGoalMessage]);

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
      const mergedMessages = mergeIncomingWithLocalBuildGoalMessages(
        [...aiMessages, localGoalMessage],
        task.messages || [],
      );
      setAiMessages(mergedMessages);
      setGoalPrompt('');
      setActiveHistoryRunTaskId(task.id);
      setActiveHistorySessionToken(task.sessionId || activeHistorySessionToken);

      if (sessionId) {
        await accomplish.updateBuildTaskHistorySession({
          sessionId,
          goalPrompt: userGoalPrompt,
          workspaceRelativePath: workspaceRelativePath || '.',
          selectedPresetId: selectedPresetId || null,
          messages: mergedMessages,
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
    aiMessages,
    diff,
    goalPrompt,
    logs,
    selectedPreset,
    selectedPresetId,
    snapshot,
    workspaceFingerprint,
    workspaceRelativePath,
    pendingDiffBaselineId,
    promptAttachedFiles,
  ]);

  const exportZip = useCallback(async () => {
    if (!activeAgentId) return;
    setBusyAction('zip');
    try {
      const normalizedRelativePath = (workspaceRelativePath || '.').replace(/\\/g, '/').trim() || '.';
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

      const hasSelectedFolder = normalizeFsPath(workspaceRelativePath || '.') !== '.';
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

      setWorkspaceRelativePath(relative);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, agentWorkspaceRoot, snapshot?.workspaceRoot, workspaceRelativePath]);

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

  const assistantMessages = useMemo(() => collectAssistantMessages(aiMessages), [aiMessages]);
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

  const assistantMessageItems = useMemo(() => assistantMessages.map((message) => {
    const planItems = parsePlanItemsFromAssistantContent(message.content || '');
    const isUserPanelMessage = message.type === 'user' && !isBuildModeGoalPanelMessage(message);
    const isToolMessage = message.type === 'tool';
    const isExpandedToolMessage = Boolean(expandedToolMessageIds[message.id]);
    const toolPreview = isToolMessage ? getCollapsedToolMessageContent(message.content || '') : null;
    const renderedToolContent = isToolMessage && !isExpandedToolMessage && toolPreview
      ? toolPreview.preview
      : (message.content || '');
    const canExpandToolMessage = Boolean(isToolMessage && toolPreview?.truncated);
    return (
      <div
        key={message.id}
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
          <button
            type="button"
            className="rounded p-1 text-muted-foreground/80 opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            onClick={() => void handleCopyAssistantMessage(message.id, message.content || '')}
            title={copiedAssistantMessageId === message.id ? 'Copied' : 'Copy message'}
          >
            {copiedAssistantMessageId === message.id ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div
          ref={(element) => {
            assistantMessageContentRefs.current[message.id] = element;
          }}
        >
          {!planItems ? (
            <div className={assistantProseClasses}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {renderedToolContent}
              </ReactMarkdown>
              {canExpandToolMessage ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleToolMessageExpanded(message.id)}
                    className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {isExpandedToolMessage ? 'Show less' : 'Show full tool message'}
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
  }), [
    assistantMessages,
    assistantProseClasses,
    copiedAssistantMessageId,
    expandedToolMessageIds,
    handleCopyAssistantMessage,
    toggleToolMessageExpanded,
  ]);

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
  }, []);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-4 py-3">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <ModeSwitch />
            <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
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
            <div className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              Preset: {selectedPreset?.name || 'None'}
            </div>
            <div className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', statusBadgeClass)}>
              {snapshot?.runtime.status === 'running' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {formatRuntimeStatus(snapshot?.runtime.status ?? 'stopped')}
            </div>
            {snapshot?.runtime.port ? (
              <div className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                Port {snapshot.runtime.port}
              </div>
            ) : null}
            {snapshot?.runtime.buildStatus && snapshot.runtime.buildStatus !== 'unknown' ? (
              <div className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs',
                snapshot.runtime.buildStatus === 'success' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 text-destructive'
              )}>
                Build {snapshot.runtime.buildStatus}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={selectedPresetId || ''}
              onChange={(event) => {
                const value = event.target.value || null;
                void handleSelectPreset(value);
              }}
            >
              <option value="">No preset</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRestart}
                onChange={(event) => setAutoRestart(event.target.checked)}
              />
              Auto-restart
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
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
                <BuildPresetInputWithHelp
                  value={presetStartCommandInput}
                  onChange={(event) => setPresetStartCommandInput(event.target.value)}
                  placeholder="Start command override (optional)"
                  className="h-8 text-xs font-mono"
                  helpTitle="Start command override"
                  helpDescription="Optional dev/runtime start command. Use this when the detected default start command is not the one you want Build Mode to run."
                  optional
                />
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

            <div className="min-h-0 flex flex-col gap-3">
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
                          const isFromCurrentWorkspace = normalizeFsPath(tab.workspaceRelativePath || '.') === normalizedCurrentWorkspacePath;
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
                          <Terminal className="h-6 w-6" />
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
                          <Terminal className="h-6 w-6" />
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

              <Card className={cn('p-3', runtimeLogsCollapsed ? 'min-h-0' : 'h-48 min-h-[160px]')}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-medium">Runtime Logs</div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      title={runtimeLogsCollapsed ? 'Expand runtime logs.' : 'Collapse runtime logs.'}
                      onClick={() => setRuntimeLogsCollapsed((current) => !current)}
                    >
                      {runtimeLogsCollapsed ? 'Expand' : 'Collapse'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title="Clear the runtime log panel for this session."
                      onClick={() => {
                        void accomplish.clearBuildRuntimeLogs({ agentId: activeAgentId });
                        setLogs([]);
                        setLogCursor(0);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                {!runtimeLogsCollapsed ? (
                  <div ref={logsRef} className="h-[calc(100%-2rem)] overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] leading-relaxed">
                    {logs.length === 0 ? (
                      <div className="text-muted-foreground">No logs yet.</div>
                    ) : logs.map((entry) => (
                      <div key={entry.seq} className="whitespace-pre-wrap break-words">
                        <span className="text-muted-foreground">[{new Date(entry.at).toLocaleTimeString()}] {formatStream(entry.stream)}</span>{' '}
                        <span className={entry.stream === 'stderr' ? 'text-destructive' : ''}>{entry.line}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>
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

              <div className="relative min-h-0 flex-1">
                <div
                  ref={assistantMessagesRef}
                  onScroll={handleAssistantMessagesScroll}
                  className="h-full min-h-0 overflow-auto rounded-md border border-border/60 p-2 space-y-2"
                >
                  {assistantMessages.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No AI reasoning yet.</div>
                  ) : assistantMessageItems}
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

              <div className="space-y-2">
                <div className="relative">
                  <Textarea
                    value={goalPrompt}
                    onChange={(event) => setGoalPrompt(event.target.value)}
                    placeholder="Describe the software task at a high level. AI will plan, edit files, run checks, and iterate."
                    className="min-h-[88px] pb-10 text-sm bg-background dark:bg-input/15"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSelectPromptFiles()}
                    className="absolute bottom-2 left-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Attach files to this build prompt."
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  {promptAttachedFiles.length > 0 ? (
                    <span className="absolute bottom-1.5 left-8 rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                      {promptAttachedFiles.length}
                    </span>
                  ) : null}
                </div>
                {promptAttachedFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {promptAttachedFiles.map((filePath) => (
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
                          onClick={() => removePromptAttachedFile(filePath)}
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
                    onClick={() => void runAiGoal()}
                    disabled={aiBusy || !goalPrompt.trim()}
                    title={aiBusy ? 'AI is currently executing the active build task.' : 'Run an AI build task using your goal prompt.'}
                  >
                    {aiBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wrench className="h-4 w-4 mr-1.5" />}
                    {aiBusy ? 'AI Working' : 'Run AI Task'}
                  </Button>
                  <ContextWindowIndicator stats={contextStats} className="mb-0" />
                  {autoRepairBusy ? <span className="text-xs text-muted-foreground">Auto-repair queued…</span> : null}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Proposed Changes / Diff</div>
                <div className="rounded-md border border-border/60 p-2 text-xs">
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
                </div>
              </div>

            </Card>
          </div>

        </div>
      </div>
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
    </div>
  );
}
