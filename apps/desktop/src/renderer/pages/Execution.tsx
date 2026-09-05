'use client';

import { useEffect, useState, useRef, useMemo, useCallback, memo, forwardRef, useImperativeHandle, useLayoutEffect, type ChangeEvent, type CSSProperties, type PointerEvent, type ReactElement, type WheelEvent } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useTaskStore } from '../stores/taskStore';
import { useSavedPromptsStore } from '../stores/savedPromptsStore';
import { useAgentStore } from '../stores/agentStore';
import { getAccomplish } from '../lib/accomplish';
import { springs } from '../lib/animations';
import type {
  ContextWindowEstimateResponse,
  AgentAppearance,
  ProviderConfig,
  SelectedModel,
  SubagentRunRecord,
  SubagentRunTreeNode,
  Task,
  TaskMessage,
  UsageProject,
  UsageProjectWorkItem,
  UsageProjectWorkItemDocumentLink,
  UsageProjectWorkItemNote,
  UsageProjectWorkItemSourceLink,
  UserSkillSharingScope,
} from '@accomplish/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { XCircle, CornerDownLeft, ArrowLeft, CheckCircle2, AlertCircle, Terminal, Wrench, FileText, Search, Code, Brain, Clock, Square, Play, Download, Bug, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trash2, Check, Folder, FolderOpen, X, Bookmark, BookmarkCheck, Settings, User, Mic, Copy, Plus, Image, Sparkles, Shield, ZoomIn, ZoomOut, RotateCcw, Loader2, Eye, EyeOff, MoreHorizontal, Archive, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { StreamingText } from '../components/ui/streaming-text';
import { isWaitingForUser } from '../lib/waiting-detection';
import SavedPromptsDialog from '../components/layout/SavedPromptsDialog';
import ModeSwitch from '../components/layout/ModeSwitch';
import BuildRuntimeIndicator from '../components/layout/BuildRuntimeIndicator';
import ContextWindowIndicator from '../components/chat/ContextWindowIndicator';
import ContextInspector from '../components/chat/ContextInspector';
import AgentToolStateIndicator, { getToolActivityStepsFromActivity } from '../components/chat/AgentToolStateIndicator';
import ChatPostcardDialog, {
  type ChatPostcardActionPayload,
  type ChatPostcardDraft as ChatPostcardDialogDraft,
  type ChatPostcardTemplateId,
} from '../components/chat/ChatPostcardDialog';
import PromptNavigator, { createPromptPreview, type PromptNavigatorEntry } from '../components/chat/PromptNavigator';
import { UsageBudgetPill } from '../components/usage/UsageBudgetPill';
import { UsageProjectSelector } from '../components/usage/UsageProjectSelector';
import BuildProjectWorkPopup from '../components/build/BuildProjectWorkPopup';
import { useVoiceWakeTalkMode } from '../hooks/useVoiceWakeTalkMode';
import { useAttachmentStore } from '../stores/attachmentStore';
import InlineSlashCommandMenu from '../components/commands/InlineSlashCommandMenu';
import { filterSlashCommands, type SlashCommandDefinition } from '../lib/slash-commands';
import { APP_COMMAND_EVENTS, createAppSlashCommands } from '../lib/app-commands';
import { usePluginSlashCommands } from '../hooks/usePluginSlashCommands';
import {
  addPromptHistoryEntry,
  CHAT_PROMPT_HISTORY_STORAGE_KEY,
  readPromptHistory,
  shouldHandlePromptHistoryRecall,
} from '../lib/prompt-history';
import { normalizeMarkdownTables } from '../lib/markdown-tables';
import { buildWordFriendlyRtfWithRenderedIcons } from '../lib/rich-text-export';
import { BUILD_RECIPES } from '../lib/build-recipes';
import {
  readChatProjectWorkPopupSession,
  writeChatProjectWorkPopupSession,
} from '../lib/project-work-popup-session';
import {
  normalizeSelectedModel,
  SELECTED_MODEL_CHANGED_EVENT,
} from '../lib/selected-model-events';
import { registerPromptAttachmentTarget, registerPromptInsertionTarget } from '../lib/prompt-insertion';
import { useUsageProjectStore } from '../stores/usageProjectStore';
import { useFolderStore } from '../stores/folderStore';
import { AgentAvatarIcon } from '../components/layout/AgentAvatarPicker';
import { isAgentCharacterAvatar } from '@/lib/agent-character-gallery';
import ChatBackgroundSwitcher from '@/components/chat/ChatBackgroundSwitcher';
import {
  DEFAULT_CHAT_BACKGROUND_ID,
  getChatBackground,
  normalizeChatBackgroundId,
} from '@/lib/chat-backgrounds';
import { useTopBarControls } from '../stores/topBarControlsStore';
// Debug log entry type
interface DebugLogEntry {
  taskId: string;
  timestamp: string;
  type: string;
  message: string;
  data?: unknown;
}

type ProactiveSuggestion = {
  id: string;
  title: string;
  why: string;
  prompt: string;
  confirmation: string;
};

type AnswerSavePending = {
  mode: 'note' | 'rtf' | 'file-link' | 'source-link';
  messageId: string;
  content: string;
  html?: string;
  rtf?: string;
  filePath?: string;
  fileLabel?: string;
  fileKind?: UsageProjectWorkItemDocumentLink['kind'];
  sourceUrl?: string;
  sourceTitle?: string;
  sourceDescription?: string;
};

type AgentPresenceState =
  | 'Thinking'
  | 'Searching web'
  | 'Opening browser'
  | 'Reading files'
  | 'Writing files'
  | 'Running command'
  | 'Checking work'
  | 'Saving'
  | 'Waiting for permission'
  | 'Queued'
  | 'Recovering'
  | 'Working';

type AgentReactionMode = NonNullable<AgentAppearance['reactionMode']>;

type AssistantReaction = {
  id: string;
  label: string;
  tone?: 'success' | 'info' | 'warning';
};

type SavedNoteAsset = {
  id: string;
  title: string;
  detail?: string;
  timestamp?: string;
};

type ChatPostcardTemplate = ChatPostcardTemplateId;

type ChatPostcardDraft = {
  source: 'answer' | 'conversation';
  messageId?: string;
  title: string;
  content: string;
  summary: string;
  highlights: string[];
  agentName: string;
  agentRole?: string;
  projectName?: string;
  sources: string[];
  createdAt: string;
};

type ConversationMapExtraEntry = {
  id: string;
  taskId: string;
  messageId?: string;
  kind: 'note' | 'file' | 'postcard' | 'decision' | 'event';
  title: string;
  detail?: string;
  assetUrl?: string;
  assetLabel?: string;
  actionLabel?: string;
  timestamp: string;
  pinned?: boolean;
};

const CHAT_ANSWER_AVATAR_STORAGE_KEY = 'opendeskmate:chat-answer-agent-avatar-visible';
const CHAT_PROMPT_NAVIGATOR_STORAGE_KEY = 'opendeskmate:prompt-navigator:chat-visible';
const CHAT_CONVERSATION_EXTRAS_STORAGE_PREFIX = 'opendeskmate:conversation-map-extras:';
const ASSISTANT_LINK_PREVIEW_CACHE_MAX = 240;
const CHAT_NAVIGATOR_FULL_ASSET_SCAN_MESSAGE_LIMIT = 120;
const CHAT_NAVIGATOR_RECENT_ASSET_SCAN_LIMIT = 80;
const CHAT_NAVIGATOR_ACTIVITY_ENTRY_LIMIT = 300;
const CHAT_NAVIGATOR_FULL_TEXT_LIMIT = 1000;
const SUBAGENT_DETAIL_TRANSCRIPT_INITIAL_LIMIT = 80;
const SUBAGENT_DETAIL_TRANSCRIPT_INCREMENT = 80;

const assistantLinkPreviewCache = new Map<string, AssistantLinkPreviews>();
const EMPTY_SAVED_NOTE_ASSETS: SavedNoteAsset[] = [];

function hashForRenderVersion(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `${value.length}:${hash}`;
}

function createConversationMapFullText(content: string): string {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= CHAT_NAVIGATOR_FULL_TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, CHAT_NAVIGATOR_FULL_TEXT_LIMIT).trimEnd()}...`;
}

const CHAT_POSTCARD_TEMPLATE_LABELS: Record<ChatPostcardTemplate, string> = {
  'clean-summary': 'Clean summary',
  'client-update': 'Client update',
  'research-card': 'Research card',
  'decision-record': 'Decision record',
  'executive-brief': 'Executive brief',
  'editorial-cover': 'Editorial cover',
  'classic-postcard': 'Classic postcard',
  'metric-snapshot': 'Metric snapshot',
  'timeline-card': 'Timeline card',
  'quote-card': 'Quote card',
  'notebook-note': 'Notebook note',
  'announcement-card': 'Announcement card',
};

function readConversationMapExtras(taskId: string | undefined): ConversationMapExtraEntry[] {
  if (!taskId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${CHAT_CONVERSATION_EXTRAS_STORAGE_PREFIX}${taskId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): ConversationMapExtraEntry[] => {
      if (!entry || typeof entry !== 'object') return [];
      const source = entry as Partial<ConversationMapExtraEntry>;
      const id = typeof source.id === 'string' ? source.id : '';
      const title = typeof source.title === 'string' ? source.title : '';
      const timestamp = typeof source.timestamp === 'string' ? source.timestamp : '';
      const kind = source.kind;
      if (!id || !title || !timestamp || !kind) return [];
      if (!['note', 'file', 'postcard', 'decision', 'event'].includes(kind)) return [];
      return [{
        id,
        taskId,
        messageId: typeof source.messageId === 'string' ? source.messageId : undefined,
        kind,
        title,
        detail: typeof source.detail === 'string' ? source.detail : undefined,
        assetUrl: typeof source.assetUrl === 'string' ? source.assetUrl : undefined,
        assetLabel: typeof source.assetLabel === 'string' ? source.assetLabel : undefined,
        actionLabel: typeof source.actionLabel === 'string' ? source.actionLabel : undefined,
        timestamp,
        pinned: Boolean(source.pinned),
      }];
    });
  } catch {
    return [];
  }
}

function writeConversationMapExtras(taskId: string | undefined, entries: ConversationMapExtraEntry[]): void {
  if (!taskId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${CHAT_CONVERSATION_EXTRAS_STORAGE_PREFIX}${taskId}`,
      JSON.stringify(entries.slice(-120))
    );
  } catch {
    // Ignore localStorage failures.
  }
}

function readChatAnswerAvatarVisible(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CHAT_ANSWER_AVATAR_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function persistChatAnswerAvatarVisible(visible: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAT_ANSWER_AVATAR_STORAGE_KEY, visible ? 'on' : 'off');
  } catch {
    // Ignore preference persistence failures.
  }
}

function isPictureAvatar(avatar: string | undefined, imageDataUrl: string | undefined): boolean {
  return Boolean(imageDataUrl || isAgentCharacterAvatar(avatar));
}

function formatExecutionModelBadgeLabel(
  model: SelectedModel | null | undefined,
  modelProviders: ProviderConfig[]
): string {
  const selected = model as (SelectedModel & { id?: string }) | null | undefined;
  const modelFullId = (
    typeof selected?.model === 'string'
      ? selected.model
      : typeof selected?.id === 'string'
        ? selected.id
        : ''
  ).trim();
  if (!modelFullId) return '';

  const providerId = (selected?.provider || '').trim();
  const providerLabel =
    modelProviders.find((entry) => String(entry.id) === providerId)?.name || providerId;
  const knownModel = modelProviders
    .flatMap((entry) => entry.models)
    .find((entry) => entry.fullId === modelFullId);
  const shortModelName = knownModel
    ? knownModel.displayName
    : modelFullId.includes('/')
      ? modelFullId.slice(modelFullId.indexOf('/') + 1)
      : modelFullId;
  return providerLabel ? `${providerLabel}: ${shortModelName}` : shortModelName;
}

function TaskStatusBadge({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'queued':
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600">
          <Clock className="h-3 w-3" />
          Queued
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium">
          <span className="animate-shimmer bg-gradient-to-r from-primary via-primary/50 to-primary bg-[length:200%_100%] bg-clip-text text-transparent">
            Running
          </span>
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-600">
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <XCircle className="h-3 w-3" />
          Cancelled
        </span>
      );
    case 'interrupted':
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600">
          <Square className="h-3 w-3" />
          Stopped
        </span>
      );
    default:
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {status}
        </span>
      );
  }
}

// Typing dots indicator for thinking/processing states
const TypingDots = ({ className }: { className?: string }) => (
  <span className={cn('typing-dots', className)} aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
);

// Tool name to human-readable progress mapping
const TOOL_PROGRESS_MAP: Record<string, { label: string; icon: typeof FileText }> = {
  // Standard Claude Code tools
  Read: { label: 'Reading files', icon: FileText },
  Glob: { label: 'Finding files', icon: Search },
  Grep: { label: 'Searching code', icon: Search },
  Bash: { label: 'Running command', icon: Terminal },
  Write: { label: 'Writing file', icon: FileText },
  Edit: { label: 'Editing file', icon: FileText },
  Task: { label: 'Running agent', icon: Brain },
  WebFetch: { label: 'Fetching web page', icon: Search },
  WebSearch: { label: 'Searching web', icon: Search },
  // Dev Browser tools
  dev_browser_execute: { label: 'Executing browser action', icon: Terminal },
};

function createLocalTaskMessageId(): string {
  return `local_msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatMessageDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getAgentPresence(toolName: string | null, toolInput: unknown, status?: string, waitingForPermission?: boolean): {
  state: AgentPresenceState;
  label: string;
  detail?: string;
  icon: typeof FileText;
} {
  if (waitingForPermission) {
    return { state: 'Waiting for permission', label: 'Waiting for permission', detail: 'User action needed', icon: Shield };
  }
  if (status === 'queued') {
    return { state: 'Queued', label: 'Queued', detail: 'Waiting for the current task slot', icon: Clock };
  }
  if (!toolName) {
    return { state: 'Thinking', label: 'Thinking', icon: Brain };
  }

  const description = typeof toolInput === 'object' && toolInput && 'description' in toolInput
    ? String((toolInput as { description?: unknown }).description || '').trim()
    : '';
  const normalized = toolName.toLowerCase();
  if (normalized.includes('websearch') || normalized.includes('webfetch')) {
    return { state: 'Searching web', label: description || 'Searching web', detail: toolName, icon: Search };
  }
  if (normalized.includes('dev_browser') || normalized.includes('browser')) {
    return { state: 'Opening browser', label: description || 'Opening browser', detail: toolName, icon: Search };
  }
  if (normalized.includes('read') || normalized.includes('grep') || normalized.includes('glob')) {
    return { state: 'Reading files', label: description || TOOL_PROGRESS_MAP[toolName]?.label || 'Reading files', detail: toolName, icon: FileText };
  }
  if (normalized.includes('write') || normalized.includes('edit')) {
    return { state: 'Writing files', label: description || TOOL_PROGRESS_MAP[toolName]?.label || 'Writing files', detail: toolName, icon: FileText };
  }
  if (normalized.includes('bash') || normalized.includes('terminal') || normalized.includes('command')) {
    return { state: 'Running command', label: description || TOOL_PROGRESS_MAP[toolName]?.label || 'Running command', detail: toolName, icon: Terminal };
  }
  if (normalized.includes('check') || normalized.includes('test') || normalized.includes('lint')) {
    return { state: 'Checking work', label: description || 'Checking work', detail: toolName, icon: CheckCircle2 };
  }
  if (normalized.includes('save')) {
    return { state: 'Saving', label: description || 'Saving', detail: toolName, icon: Download };
  }
  if (normalized.includes('recover') || normalized.includes('resume')) {
    return { state: 'Recovering', label: description || 'Recovering', detail: toolName, icon: RotateCcw };
  }
  return { state: 'Working', label: description || TOOL_PROGRESS_MAP[toolName]?.label || 'Working', detail: toolName, icon: Wrench };
}

function wrapPostcardText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.length > 0) {
    const last = lines[lines.length - 1] || '';
    lines[lines.length - 1] = last.length > 3 ? `${last.replace(/[.,;:!?]?$/, '')}...` : last;
  }
  return lines;
}

function createPostcardPngDataUrl(draft: ChatPostcardDraft, template: ChatPostcardTemplate, accentColor: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create postcard canvas.');
  const accent = /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#58c8c0';

  const gradient = context.createLinearGradient(0, 0, 1200, 675);
  gradient.addColorStop(0, '#111827');
  gradient.addColorStop(0.62, '#172033');
  gradient.addColorStop(1, '#0f2f36');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1200, 675);
  context.fillStyle = `${accent}22`;
  context.fillRect(0, 0, 1200, 10);
  context.fillStyle = `${accent}1f`;
  context.beginPath();
  context.arc(1050, 90, 230, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#f8fafc';
  context.font = '700 42px Inter, Arial, sans-serif';
  const titleLines = wrapPostcardText(context, draft.title || CHAT_POSTCARD_TEMPLATE_LABELS[template], 980, 2);
  titleLines.forEach((line, index) => context.fillText(line, 72, 92 + index * 52));

  context.font = '600 20px Inter, Arial, sans-serif';
  context.fillStyle = accent;
  const subtitle = [
    CHAT_POSTCARD_TEMPLATE_LABELS[template],
    draft.agentName,
    draft.projectName,
  ].filter(Boolean).join(' • ');
  context.fillText(subtitle, 72, 205);

  context.font = '400 24px Inter, Arial, sans-serif';
  context.fillStyle = '#e5edf5';
  const bodyLines = wrapPostcardText(context, draft.summary, 1010, 11);
  bodyLines.forEach((line, index) => context.fillText(line, 72, 278 + index * 34));

  context.font = '600 18px Inter, Arial, sans-serif';
  context.fillStyle = '#a8b3c7';
  const footer = `${new Date(draft.createdAt).toLocaleString()}${draft.sources.length > 0 ? ` • ${draft.sources.length} source${draft.sources.length === 1 ? '' : 's'}` : ''}`;
  context.fillText(footer, 72, 620);

  context.fillStyle = accent;
  context.fillRect(72, 235, 84, 5);

  return canvas.toDataURL('image/png');
}

function cleanPostcardTitleText(value: string): string {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*/, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\s+#{1,6}\s*$/g, '')
    .replace(/\s+#{1,6}\s+/g, ' ')
    .replace(/^\s{0,3}>\s*/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createPostcardTitleFromContent(content: string, fallback = 'Conversation postcard'): string {
  const lines = normalizeMarkdownTables(String(content || ''))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  const candidate = heading || lines.find((line) => (
    !/^(?:-{3,}|\*{3,}|_{3,})$/.test(line) &&
    !/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line) &&
    !/^```|^~~~/.test(line)
  ));
  const cleaned = cleanPostcardTitleText(candidate || createPromptPreview(content));
  if (!cleaned) return fallback;
  return cleaned.length > 96 ? `${cleaned.slice(0, 93).trimEnd()}...` : cleaned;
}

async function capturePostcardPreviewDataUrl(element: HTMLElement | null | undefined): Promise<string | null> {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return null;
  const result = await getAccomplish().captureWindowRect({
    x: Math.max(0, Math.floor(rect.left)),
    y: Math.max(0, Math.floor(rect.top)),
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  });
  return result.dataUrl;
}

function toPostcardDialogDraft(draft: ChatPostcardDraft, template: ChatPostcardTemplate): ChatPostcardDialogDraft {
  const sourceLabel = draft.projectName?.trim() || draft.agentName || 'Open Deskmate';
  const sourceCount = draft.sources.length;
  return {
    templateId: template as ChatPostcardTemplateId,
    eyebrow: draft.source === 'conversation' ? 'Conversation postcard' : 'Answer postcard',
    title: createPostcardTitleFromContent(draft.title, 'Conversation postcard'),
    subtitle: [draft.agentName, draft.agentRole, draft.projectName].filter(Boolean).join(' / ') || 'Prepared from chat',
    summary: draft.summary,
    highlights: draft.highlights,
    statusLabel: CHAT_POSTCARD_TEMPLATE_LABELS[template],
    sourceLabel,
    dateLabel: new Date(draft.createdAt).toLocaleDateString(),
    footer: sourceCount > 0
      ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} included`
      : 'Generated by Open Deskmate',
  };
}

const IMAGE_LINK_EXTENSION_RE = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#/])/i;
const IMAGE_CDN_HOST_RE = /(^|\.)((upload\.wikimedia\.org)|(images\.unsplash\.com)|(i\.imgur\.com)|(lh3\.googleusercontent\.com)|(pbs\.twimg\.com)|(media\.licdn\.com)|(res\.cloudinary\.com))$/i;
const DOCUMENT_LINK_EXTENSION_RE = /\.(?:csv|doc|docm|docx|dot|dotm|dotx|key|md|numbers|odp|ods|odt|pages|pdf|ppt|pptm|pptx|rtf|txt|xls|xlsm|xlsx)(?:$|[?#/])/i;
const LOCAL_DOCUMENT_PATH_RE = /^(?:[a-zA-Z]:[\\/]|\\\\)[^<>:"|?*\n\r]+\.(?:csv|doc|docm|docx|dot|dotm|dotx|key|md|numbers|odp|ods|odt|pages|pdf|ppt|pptm|pptx|rtf|txt|xls|xlsm|xlsx)$/i;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPreviewableImageHref(value: string): boolean {
  const href = normalizePreviewHref(value);
  if (!href) return false;
  if (/^data:image\//i.test(href) || /^blob:/i.test(href)) return true;

  try {
    const parsed = new URL(href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const urlText = `${parsed.pathname}${parsed.search}`;
    if (IMAGE_LINK_EXTENSION_RE.test(urlText)) return true;
    return IMAGE_CDN_HOST_RE.test(parsed.hostname);
  } catch {
    const pathOnly = href.split(/[?#]/, 1)[0] || href;
    return IMAGE_LINK_EXTENSION_RE.test(pathOnly);
  }
}

function getWikimediaOriginalImageUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!/^upload\.wikimedia\.org$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const thumbIndex = parts.indexOf('thumb');
    if (thumbIndex < 0 || parts.length <= thumbIndex + 4) return null;
    const originalParts = [
      ...parts.slice(0, thumbIndex),
      ...parts.slice(thumbIndex + 1, -1),
    ];
    if (originalParts.length < 4) return null;
    parsed.pathname = `/${originalParts.join('/')}`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeImagePreviewUrl(value: string): string | null {
  const href = normalizePreviewHref(value);
  if (!href) return null;
  return getWikimediaOriginalImageUrl(href) ?? href;
}

function getImagePreviewLabel(value: string): string {
  try {
    const parsed = new URL(value);
    const fileName = parsed.pathname.split('/').filter(Boolean).pop();
    return fileName ? decodeURIComponent(fileName) : parsed.hostname;
  } catch {
    const fileName = value.split(/[\\/]/).filter(Boolean).pop();
    return fileName || 'Image preview';
  }
}

function clampImageZoom(value: number): number {
  return Math.min(6, Math.max(0.5, Math.round(value * 100) / 100));
}

type ImagePreviewItem = { url: string; label: string };

type ImagePreviewState = {
  images: ImagePreviewItem[];
  index: number;
};

type AssistantLinkPreviews = {
  imageLinks: ImagePreviewItem[];
  documentLinks: AssistantDocumentLink[];
  siteLinks: Array<{ url: string; host: string; faviconUrl: string }>;
};

type AssistantDocumentLink = {
  target: string;
  label: string;
  kind: 'web' | 'local';
};

function normalizePreviewHref(value: string): string | null {
  const cleaned = String(value || '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^[("'“”‘’]+/g, '')
    .replace(/[)"'“”‘’,.;!?]+$/g, '');
  return cleaned || null;
}

function getFaviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function fileUrlToLocalPath(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return null;
    const pathname = decodeURIComponent(parsed.pathname || '');
    if (parsed.hostname) {
      return `\\\\${parsed.hostname}${pathname.replace(/\//g, '\\')}`;
    }
    const withoutLeadingSlash = /^\/[a-zA-Z]:\//.test(pathname)
      ? pathname.slice(1)
      : pathname;
    return withoutLeadingSlash.replace(/\//g, '\\');
  } catch {
    return null;
  }
}

function normalizeDocumentTarget(value: string): Pick<AssistantDocumentLink, 'target' | 'kind'> | null {
  const href = normalizePreviewHref(value);
  if (!href) return null;
  const localFileUrl = fileUrlToLocalPath(href);
  if (localFileUrl) return { target: localFileUrl, kind: 'local' };
  if (isHttpUrl(href)) return { target: href, kind: 'web' };
  if (LOCAL_DOCUMENT_PATH_RE.test(href)) return { target: href, kind: 'local' };
  return null;
}

function isDocumentHref(value: string): boolean {
  const normalized = normalizeDocumentTarget(value);
  if (!normalized || isPreviewableImageHref(normalized.target)) return false;
  if (normalized.kind === 'local') return DOCUMENT_LINK_EXTENSION_RE.test(normalized.target);
  try {
    const parsed = new URL(normalized.target);
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const urlText = `${parsed.pathname}${parsed.search}`;
    if (DOCUMENT_LINK_EXTENSION_RE.test(urlText)) return true;
    if (hostname === 'docs.google.com') {
      return /^\/(?:document|spreadsheets|presentation|forms)\//i.test(parsed.pathname);
    }
    if (hostname === 'drive.google.com') {
      return /^\/(?:file|open)\//i.test(parsed.pathname) || parsed.searchParams.has('id');
    }
    if (hostname.endsWith('.sharepoint.com')) return true;
    if (hostname === 'onedrive.live.com' || hostname === 'office.com' || hostname.endsWith('.office.com')) return true;
    if (hostname === 'microsoft365.com' || hostname.endsWith('.microsoft365.com')) return true;
    if (hostname === 'dropbox.com' || hostname.endsWith('.dropbox.com')) return true;
  } catch {
    return false;
  }
  return false;
}

function getDocumentLinkLabel(value: string, label?: string): string {
  const cleanedLabel = label?.replace(/\s+/g, ' ').trim();
  if (cleanedLabel) return cleanedLabel;
  const normalized = normalizeDocumentTarget(value);
  if (!normalized) return 'Document';
  if (normalized.kind === 'local') {
    return normalized.target.split(/[\\/]/).filter(Boolean).pop() || 'Document';
  }
  try {
    const parsed = new URL(normalized.target);
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (hostname === 'docs.google.com') return 'Google document';
    if (hostname === 'drive.google.com') return 'Google Drive document';
    if (hostname.includes('sharepoint') || hostname.includes('office') || hostname.includes('microsoft365') || hostname.includes('onedrive')) {
      return 'Microsoft 365 document';
    }
    const fileName = parsed.pathname.split('/').filter(Boolean).pop();
    return fileName ? decodeURIComponent(fileName) : 'Document';
  } catch {
    return 'Document';
  }
}

function textFromMarkdownChildren(children: unknown): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    return children
      .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
      .join('');
  }
  return '';
}

function extractAssistantLinkPreviews(content: string): AssistantLinkPreviews {
  const cacheKey = String(content || '');
  const cached = assistantLinkPreviewCache.get(cacheKey);
  if (cached) {
    assistantLinkPreviewCache.delete(cacheKey);
    assistantLinkPreviewCache.set(cacheKey, cached);
    return cached;
  }
  const sourceWithoutCodeBlocks = String(content || '').replace(/```[\s\S]*?```/g, '');
  const source = sourceWithoutCodeBlocks.replace(/`[^`]*`/g, '');
  const imageLinks = new Map<string, { url: string; label: string }>();
  const documentLinks = new Map<string, AssistantDocumentLink>();
  const siteLinks = new Map<string, { url: string; host: string; faviconUrl: string }>();

  const addImage = (rawUrl: string, label?: string) => {
    const url = normalizeImagePreviewUrl(rawUrl);
    if (!url || !isPreviewableImageHref(url) || imageLinks.has(url)) return;
    imageLinks.set(url, {
      url,
      label: label?.trim() || getImagePreviewLabel(url),
    });
  };

  const addDocument = (rawUrl: string, label?: string) => {
    if (!isDocumentHref(rawUrl)) return;
    const normalized = normalizeDocumentTarget(rawUrl);
    if (!normalized || documentLinks.has(normalized.target)) return;
    documentLinks.set(normalized.target, {
      ...normalized,
      label: getDocumentLinkLabel(rawUrl, label),
    });
  };

  const addSite = (rawUrl: string) => {
    const url = normalizePreviewHref(rawUrl);
    if (!url || !isHttpUrl(url) || isPreviewableImageHref(url) || isDocumentHref(url)) return;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./i, '');
      if (!host || siteLinks.has(host)) return;
      siteLinks.set(host, {
        url,
        host,
        faviconUrl: getFaviconUrl(host),
      });
    } catch {
      // Ignore malformed URLs in generated text.
    }
  };

  const inlineCodePattern = /`([^`\n]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = inlineCodePattern.exec(sourceWithoutCodeBlocks)) !== null) {
    addDocument(match[1] || '');
  }

  const markdownImagePattern = /!\[([^\]]*)]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  while ((match = markdownImagePattern.exec(source)) !== null) {
    addImage(match[2] || '', match[1] || undefined);
  }

  const markdownLinkPattern = /(?<!!)\[([^\]]+)]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  while ((match = markdownLinkPattern.exec(source)) !== null) {
    const rawUrl = match[2] || '';
    if (isPreviewableImageHref(rawUrl)) {
      addImage(rawUrl, match[1] || undefined);
    } else if (isDocumentHref(rawUrl)) {
      addDocument(rawUrl, match[1] || undefined);
    } else {
      addSite(rawUrl);
    }
  }

  const bareUrlPattern = /https?:\/\/[^\s<>"'\]]+/g;
  while ((match = bareUrlPattern.exec(source)) !== null) {
    const rawUrl = match[0] || '';
    if (isPreviewableImageHref(rawUrl)) {
      addImage(rawUrl);
    } else if (isDocumentHref(rawUrl)) {
      addDocument(rawUrl);
    } else {
      addSite(rawUrl);
    }
  }

  const result = {
    imageLinks: Array.from(imageLinks.values()).slice(0, 8),
    documentLinks: Array.from(documentLinks.values()).slice(0, 8),
    siteLinks: Array.from(siteLinks.values()).slice(0, 10),
  };
  assistantLinkPreviewCache.set(cacheKey, result);
  while (assistantLinkPreviewCache.size > ASSISTANT_LINK_PREVIEW_CACHE_MAX) {
    const oldestKey = assistantLinkPreviewCache.keys().next().value;
    if (oldestKey === undefined) break;
    assistantLinkPreviewCache.delete(oldestKey);
  }
  return result;
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appendStyle(element: HTMLElement, style: string): void {
  const existing = element.getAttribute('style');
  element.setAttribute('style', existing ? `${existing}; ${style}` : style);
}

function escapeRtf(value: string): string {
  let result = '';
  for (const char of String(value || '')) {
    if (char === '\\') {
      result += '\\\\';
    } else if (char === '{') {
      result += '\\{';
    } else if (char === '}') {
      result += '\\}';
    } else if (char === '\n') {
      result += '\\line ';
    } else if (char === '\r') {
      // Ignore carriage returns; newlines are handled above.
    } else {
      const code = char.codePointAt(0) ?? 0;
      if (code > 127) {
        const signed = code > 32767 ? code - 65536 : code;
        result += `\\u${signed}?`;
      } else {
        result += char;
      }
    }
  }
  return result;
}

function getRtfInlineContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeRtf(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes).map(getRtfInlineContent).join('');

  switch (element.tagName) {
    case 'BR':
      return '\\line ';
    case 'STRONG':
    case 'B':
      return `{\\b ${children}\\b0}`;
    case 'EM':
    case 'I':
      return `{\\i ${children}\\i0}`;
    case 'CODE':
      return `{\\f1 ${children}\\f0}`;
    case 'A': {
      const href = element.getAttribute('href');
      return href ? `${children} (${escapeRtf(href)})` : children;
    }
    case 'IMG': {
      const alt = element.getAttribute('alt') || element.getAttribute('src') || 'image';
      return `[Image: ${escapeRtf(alt)}]`;
    }
    default:
      return children;
  }
}

function getRtfBlocksFromNodes(nodes: Node[]): string {
  return nodes.map((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      return text ? `\\pard\\plain\\fs22 ${escapeRtf(text)}\\par\n` : '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node as HTMLElement;
    const tagName = element.tagName;

    if (/^H[1-6]$/.test(tagName)) {
      const level = Number(tagName.slice(1));
      const fontSize = [0, 40, 32, 28, 24, 22, 20][level] || 24;
      return `\\pard\\plain\\s${level}\\outlinelevel${level - 1}\\b\\fs${fontSize} ${getRtfInlineContent(element)}\\b0\\par\n`;
    }

    if (tagName === 'TABLE') {
      return getRtfTable(element as HTMLTableElement);
    }

    if (tagName === 'UL' || tagName === 'OL') {
      return Array.from(element.children)
        .filter((child) => child.tagName === 'LI')
        .map((child, index) => {
          const marker = tagName === 'OL' ? `${index + 1}.` : '\\bullet';
          return `\\pard\\plain\\fi-240\\li480\\fs22 ${marker}\\tab ${getRtfInlineContent(child)}\\par\n`;
        })
        .join('');
    }

    if (tagName === 'PRE') {
      return `\\pard\\plain\\f1\\fs20 ${escapeRtf(element.textContent || '')}\\par\n`;
    }

    if (tagName === 'BLOCKQUOTE') {
      return `\\pard\\plain\\li360\\fs22\\i ${getRtfInlineContent(element)}\\i0\\par\n`;
    }

    if (tagName === 'P') {
      return `\\pard\\plain\\fs22 ${getRtfInlineContent(element)}\\par\n`;
    }

    const blockChildren = Array.from(element.childNodes);
    if (blockChildren.some((child) => child.nodeType === Node.ELEMENT_NODE && /^(H[1-6]|P|UL|OL|TABLE|PRE|BLOCKQUOTE|DIV)$/i.test((child as HTMLElement).tagName))) {
      return getRtfBlocksFromNodes(blockChildren);
    }

    const inline = getRtfInlineContent(element).trim();
    return inline ? `\\pard\\plain\\fs22 ${inline}\\par\n` : '';
  }).join('');
}

function getRtfTable(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  const maxCells = rows.reduce((max, row) => Math.max(max, row.cells.length), 1);
  const cellWidth = Math.floor(9000 / maxCells);

  return rows.map((row) => {
    const cells = Array.from(row.cells);
    const cellDefinitions = Array.from({ length: maxCells }, (_unused, index) => `\\cellx${(index + 1) * cellWidth}`).join('');
    const cellContents = cells.map((cell) => {
      const isHeader = cell.tagName === 'TH';
      const content = getRtfInlineContent(cell);
      return `\\pard\\intbl\\plain\\fs20 ${isHeader ? `\\b ${content}\\b0` : content}\\cell`;
    }).join('');
    return `\\trowd\\trgaph108\\trleft0${cellDefinitions}${cellContents}\\row\n`;
  }).join('');
}

function buildWordFriendlyClipboardRtf(source: HTMLElement | null, fallbackText: string): Promise<string> {
  return buildWordFriendlyRtfWithRenderedIcons(source, fallbackText);
}

function buildWordFriendlyClipboardHtml(source: HTMLElement | null, fallbackText: string): string {
  const cloned = source?.cloneNode(true) as HTMLElement | undefined;
  const bodyHtml = cloned?.innerHTML?.trim()
    || `<p>${escapeHtml(fallbackText).replace(/\r?\n/g, '<br />')}</p>`;

  const container = document.createElement('div');
  container.innerHTML = bodyHtml;

  container.querySelectorAll('table').forEach((element) => {
    const table = element as HTMLTableElement;
    table.setAttribute('border', '1');
    table.setAttribute('cellpadding', '0');
    table.setAttribute('cellspacing', '0');
    appendStyle(table, 'border-collapse:collapse;width:100%;margin:8px 0;font-family:Arial,sans-serif;font-size:11pt');
  });

  container.querySelectorAll('th').forEach((element) => {
    appendStyle(element as HTMLElement, 'border:1px solid #a8a8a8;background:#f1f3f5;padding:6px 8px;text-align:left;font-weight:bold;vertical-align:top');
  });

  container.querySelectorAll('td').forEach((element) => {
    appendStyle(element as HTMLElement, 'border:1px solid #a8a8a8;padding:6px 8px;vertical-align:top');
  });

  const headingStyles: Record<string, string> = {
    H1: 'mso-style-name:"Heading 1";mso-outline-level:1;font-family:Arial,sans-serif;font-size:20pt;font-weight:bold;margin:18px 0 10px 0;line-height:1.25;color:#111827',
    H2: 'mso-style-name:"Heading 2";mso-outline-level:2;font-family:Arial,sans-serif;font-size:16pt;font-weight:bold;margin:16px 0 8px 0;line-height:1.25;color:#111827',
    H3: 'mso-style-name:"Heading 3";mso-outline-level:3;font-family:Arial,sans-serif;font-size:14pt;font-weight:bold;margin:14px 0 7px 0;line-height:1.25;color:#111827',
    H4: 'mso-style-name:"Heading 4";mso-outline-level:4;font-family:Arial,sans-serif;font-size:12pt;font-weight:bold;margin:12px 0 6px 0;line-height:1.25;color:#111827',
    H5: 'mso-style-name:"Heading 5";mso-outline-level:5;font-family:Arial,sans-serif;font-size:11pt;font-weight:bold;margin:10px 0 5px 0;line-height:1.25;color:#111827',
    H6: 'mso-style-name:"Heading 6";mso-outline-level:6;font-family:Arial,sans-serif;font-size:10pt;font-weight:bold;margin:10px 0 5px 0;line-height:1.25;color:#111827',
  };

  container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((element) => {
    const heading = element as HTMLElement;
    const level = heading.tagName.slice(1);
    heading.classList.add(`MsoHeading${level}`);
    appendStyle(heading, headingStyles[heading.tagName] || headingStyles.H3);
  });

  container.querySelectorAll('p').forEach((element) => {
    appendStyle(element as HTMLElement, 'margin:0 0 8px 0');
  });

  container.querySelectorAll('ul,ol').forEach((element) => {
    appendStyle(element as HTMLElement, 'margin:0 0 8px 24px;padding:0');
  });

  container.querySelectorAll('pre').forEach((element) => {
    appendStyle(element as HTMLElement, 'white-space:pre-wrap;background:#f6f8fa;border:1px solid #d0d7de;padding:8px;font-family:Consolas,monospace;font-size:10pt');
  });

  container.querySelectorAll('code').forEach((element) => {
    appendStyle(element as HTMLElement, 'font-family:Consolas,monospace');
  });

  container.querySelectorAll('a').forEach((element) => {
    appendStyle(element as HTMLElement, 'color:#0563c1;text-decoration:underline');
  });

  return `<!doctype html><html><head><meta charset="utf-8"><style>
h1,.MsoHeading1{mso-style-name:"Heading 1";mso-style-priority:9;mso-outline-level:1}
h2,.MsoHeading2{mso-style-name:"Heading 2";mso-style-priority:9;mso-outline-level:2}
h3,.MsoHeading3{mso-style-name:"Heading 3";mso-style-priority:9;mso-outline-level:3}
h4,.MsoHeading4{mso-style-name:"Heading 4";mso-style-priority:9;mso-outline-level:4}
h5,.MsoHeading5{mso-style-name:"Heading 5";mso-style-priority:9;mso-outline-level:5}
h6,.MsoHeading6{mso-style-name:"Heading 6";mso-style-priority:9;mso-outline-level:6}
</style></head><body>${container.innerHTML}</body></html>`;
}

function sanitizeSuggestedFileBaseName(value: string, fallback = 'task-answer'): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function formatDateForFileBaseName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function defaultTaskAnswerFileBaseName(): string {
  return `task-answer_${formatDateForFileBaseName()}`;
}

function buildWorkItemNoteHtmlFragment(source: HTMLElement | null, fallbackText: string): string {
  const cloned = source?.cloneNode(true) as HTMLElement | undefined;
  const html = cloned?.innerHTML?.trim();
  if (html) return html;
  return `<p>${escapeHtml(fallbackText).replace(/\r?\n/g, '<br />')}</p>`;
}

function normalizeSkillIdCandidate(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  const collapsed = raw
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefixed = /^[a-z0-9]/.test(collapsed) ? collapsed : `skill-${collapsed}`;
  const cleaned = prefixed.replace(/[^a-z0-9-_]/g, '').slice(0, 64);
  return cleaned || 'skill';
}

function resolveUniqueSkillId(baseId: string, existingIds: Set<string>): string {
  const normalizedBase = normalizeSkillIdCandidate(baseId);
  if (!existingIds.has(normalizedBase)) return normalizedBase;
  for (let i = 2; i < 10_000; i += 1) {
    const suffix = `-${i}`;
    const head = normalizedBase.slice(0, Math.max(1, 64 - suffix.length));
    const candidate = `${head}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${normalizedBase.slice(0, 56)}-${Date.now().toString().slice(-7)}`;
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

function isActiveSubagentRun(run: Pick<SubagentRunRecord, 'status'>): boolean {
  return run.status === 'running' || run.status === 'accepted';
}

function formatSubagentShortDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatSubagentElapsed(run: Pick<SubagentRunRecord, 'createdAt' | 'updatedAt' | 'completedAt' | 'status'>): string {
  const started = Date.parse(run.createdAt);
  if (!Number.isFinite(started)) return 'n/a';
  const updated = Date.parse(run.updatedAt);
  const completed = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  const ended = Number.isFinite(completed)
    ? completed
    : isActiveSubagentRun(run)
      ? Date.now()
      : Number.isFinite(updated)
        ? updated
        : Date.now();
  return formatSubagentShortDuration(ended - started);
}

function formatSubagentUpdatedAge(value?: string): string {
  if (!value) return 'n/a';
  const updated = Date.parse(value);
  if (!Number.isFinite(updated)) return 'n/a';
  return `${formatSubagentShortDuration(Date.now() - updated)} ago`;
}

function compactSubagentActivitySummary(value: string): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= 420) return normalized;
  return `${normalized.slice(0, 420).trimEnd()}...`;
}

function getSubagentLatestProgressEvent(run: Pick<SubagentRunRecord, 'progressEvents'>): NonNullable<SubagentRunRecord['progressEvents']>[number] | null {
  const events = run.progressEvents || [];
  if (events.length === 0) return null;
  return events.reduce((latest, event) => {
    const latestTime = Date.parse(latest.timestamp);
    const eventTime = Date.parse(event.timestamp);
    if (!Number.isFinite(eventTime)) return latest;
    if (!Number.isFinite(latestTime) || eventTime >= latestTime) return event;
    return latest;
  }, events[0]);
}

function formatSubagentProgressEvent(run: Pick<SubagentRunRecord, 'progressEvents'>): string | null {
  const event = getSubagentLatestProgressEvent(run);
  if (!event) return null;
  const parts = [
    event.title || event.currentStep || event.type,
    typeof event.percentage === 'number' ? `${Math.round(event.percentage)}%` : null,
    typeof event.completedSteps === 'number' && typeof event.totalSteps === 'number'
      ? `${event.completedSteps}/${event.totalSteps}`
      : null,
    event.detail,
  ].filter(Boolean);
  return compactSubagentActivitySummary(parts.join(' · '));
}

function getSubagentRecoverySummary(run: Pick<SubagentRunRecord, 'recoveryHistory'>): string | null {
  const history = run.recoveryHistory || [];
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  return `${history.length} recovery ${history.length === 1 ? 'attempt' : 'attempts'} · ${latest.action} ${latest.status}`;
}

function getSubagentResultBundleSummary(run: Pick<SubagentRunRecord, 'resultBundle'>): string | null {
  const bundle = run.resultBundle;
  if (!bundle) return null;
  const itemCount = bundle.items?.length || 0;
  const missingCount = bundle.missingExpectedOutputIds?.length || 0;
  if (missingCount > 0) return `${itemCount} outputs · ${missingCount} missing`;
  return `${itemCount} outputs`;
}

function getSubagentBuildHandoffSummary(run: Pick<SubagentRunRecord, 'buildHandoff'>): string | null {
  const handoff = run.buildHandoff;
  if (!handoff) return null;
  const changedCount = handoff.changedFiles?.length ?? handoff.gitSummary?.changedFileCount ?? 0;
  const stats = handoff.gitSummary
    ? `+${handoff.gitSummary.totalAddedLines} -${handoff.gitSummary.totalDeletedLines}`
    : null;
  const mode = handoff.diffMode || (handoff.baselineId ? 'synthetic' : 'workspace');
  const generated = handoff.generatedAt ? ` · refreshed ${new Date(handoff.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  return `Build handoff: ${changedCount} file${changedCount === 1 ? '' : 's'}${stats ? ` · ${stats}` : ''} · ${mode}${generated}`;
}

function getSubagentInheritedToolsSummary(run: Pick<SubagentRunRecord, 'inheritedContext'>): string | null {
  const inherited = run.inheritedContext;
  const inheritedToolsets = inherited?.inheritedToolsetIds || inherited?.enabledToolsetIds || inherited?.toolsetIds || [];
  if (inheritedToolsets.length === 0 && inherited?.deferredToolDiscoveryEnabled !== true) return null;
  const toolText = inheritedToolsets.length > 0 ? inheritedToolsets.join(', ') : 'none';
  const discoveryText = inherited?.deferredToolDiscoveryEnabled ? ' · discovery on' : '';
  return `Tools inherited: ${toolText}${discoveryText}`;
}

function getSubagentSharedContextSummary(run: Pick<SubagentRunRecord, 'sharedContext'>): string | null {
  const context = run.sharedContext;
  if (!context) return null;
  const parts: string[] = [];
  const blockedSources = context.blockedSources || [];
  const blockedTools = context.blockedTools || [];
  const fallbacks = context.successfulFallbacks || [];
  const findings = context.confirmedFindings || [];
  if (blockedSources.length > 0) {
    const labels = blockedSources
      .slice(0, 3)
      .map((source) => source.domain || source.sourceUrl || source.failureKind || 'source')
      .filter(Boolean);
    parts.push(`Blocked sources: ${labels.join(', ')}${blockedSources.length > labels.length ? ` +${blockedSources.length - labels.length}` : ''}`);
  }
  if (blockedTools.length > 0) {
    parts.push(`Blocked tools: ${blockedTools.slice(0, 3).join(', ')}${blockedTools.length > 3 ? ` +${blockedTools.length - 3}` : ''}`);
  }
  if (fallbacks.length > 0) parts.push(`Fallbacks: ${fallbacks.slice(0, 2).join(', ')}`);
  if (findings.length > 0) parts.push(`${findings.length} shared finding${findings.length === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function getSubagentRunIndicators(run: SubagentRunRecord): Array<{ label: string; title: string; className: string }> {
  const latestProgress = getSubagentLatestProgressEvent(run);
  const heartbeatAt = Date.parse(run.supervisor?.heartbeatAt || run.supervisor?.lastCheckedAt || run.updatedAt);
  const latestProgressAt = latestProgress ? Date.parse(latestProgress.timestamp) : Number.NaN;
  const latestActivityAt = Math.max(
    Number.isFinite(heartbeatAt) ? heartbeatAt : 0,
    Number.isFinite(latestProgressAt) ? latestProgressAt : 0
  );
  const stale = isActiveSubagentRun(run) && latestActivityAt > 0 && Date.now() - latestActivityAt > 10 * 60_000;
  const stuck = Boolean(run.supervisor?.stallDetectedAt || run.supervisor?.stalledReason || latestProgress?.type === 'blocked');
  const recovering = Boolean((run.recoveryHistory || []).some((entry) => entry.status === 'planned' || entry.status === 'running'));
  const indicators: Array<{ label: string; title: string; className: string }> = [];
  if (stale) {
    indicators.push({
      label: 'Stale',
      title: `No heartbeat or progress for ${formatSubagentShortDuration(Date.now() - latestActivityAt)}`,
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    });
  }
  if (stuck) {
    indicators.push({
      label: 'Stuck',
      title: run.supervisor?.stalledReason || latestProgress?.detail || 'Supervisor marked this run as blocked',
      className: 'bg-destructive/10 text-destructive',
    });
  }
  if (recovering) {
    indicators.push({
      label: 'Recovering',
      title: getSubagentRecoverySummary(run) || 'Recovery is in progress',
      className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    });
  }
  if (run.replacesRunId) {
    indicators.push({
      label: `Replaces ${run.replacesRunId.slice(0, 8)}`,
      title: `Replacement for run ${run.replacesRunId}`,
      className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    });
  }
  if (run.replacedByRunId) {
    indicators.push({
      label: `Replaced by ${run.replacedByRunId.slice(0, 8)}`,
      title: `Superseded by run ${run.replacedByRunId}`,
      className: 'bg-muted text-muted-foreground',
    });
  }
  return indicators;
}

function canRequestSubagentRecovery(run: SubagentRunRecord): boolean {
  const latestProgress = getSubagentLatestProgressEvent(run);
  return isActiveSubagentRun(run) && Boolean(run.supervisor?.recoveryEligible || latestProgress?.recoverable || run.supervisor?.stallDetectedAt);
}

function getSubagentLatestActivitySummary(run: SubagentRunRecord & { childTaskSummary?: string; childTaskStatus?: string }): string | null {
  const finalReport = run.finalReport?.trim();
  if (finalReport) return compactSubagentActivitySummary(finalReport);
  const progressSummary = formatSubagentProgressEvent(run);
  if (progressSummary) return progressSummary;
  const childSummary = run.childTaskSummary?.trim();
  if (childSummary) return compactSubagentActivitySummary(childSummary);
  const lastPrompt = run.lastPrompt?.trim();
  if (lastPrompt && lastPrompt !== run.task.trim()) return `Latest prompt: ${lastPrompt}`;
  if (run.childTaskStatus) return `Child task ${run.childTaskStatus}`;
  return null;
}

type RelayedSubagentCompletionMeta = {
  childAgentId: string;
  label?: string;
};

function getRelayedSubagentCompletionMeta(message: Pick<TaskMessage, 'type' | 'content'>): RelayedSubagentCompletionMeta | null {
  const content = String(message.content || '').trim();
  if (
    message.type !== 'assistant'
    || !/\nStatus:\s*\S+/i.test(content)
    || !/\nSession:\s*\S+/i.test(content)
  ) {
    return null;
  }
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  const match = firstLine.match(/^Subagent\s+(.+?)\s+completed\./i);
  if (!match) return null;
  const rawChildLabel = match[1].trim();
  const labelledChild = rawChildLabel.match(/^(.*?)\s+\((.*?)\)$/);
  const childAgentId = (labelledChild?.[1] || rawChildLabel).trim();
  if (!childAgentId) return null;
  return {
    childAgentId,
    label: labelledChild?.[2]?.trim() || undefined,
  };
}

function isRelayedSubagentCompletionMessage(message: Pick<TaskMessage, 'type' | 'content'>): boolean {
  return Boolean(getRelayedSubagentCompletionMeta(message));
}

function compactSubagentTextSignature(value: string | undefined | null, maxInlineChars = 160): string {
  if (!value) return '';
  return value.length <= maxInlineChars ? value : hashForRenderVersion(value);
}

function buildSubagentPartSignature(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => part ?? '').join('\u001f');
}

function getSubagentProgressEventsSignature(events: SubagentRunRecord['progressEvents']): string {
  if (!events?.length) return '0';
  const recentEvents = events.slice(-8).map((event) => buildSubagentPartSignature([
    event.id,
    event.type,
    event.timestamp,
    event.status,
    event.toolName,
    event.messageId,
    event.percentage,
    event.currentStep,
    event.totalSteps,
    event.completedSteps,
    event.recoverable,
    event.domain,
    event.httpStatus,
    event.failureKind,
    compactSubagentTextSignature(event.title, 80),
    compactSubagentTextSignature(event.detail, 80),
    compactSubagentTextSignature(event.fallbackSuggested, 80),
  ]));
  return `${events.length}\u001e${recentEvents.join('\u001e')}`;
}

function getSubagentSupervisorSignature(supervisor: SubagentRunRecord['supervisor']): string {
  if (!supervisor) return '';
  return buildSubagentPartSignature([
    supervisor.state,
    supervisor.lastCheckedAt,
    supervisor.nextCheckAt,
    supervisor.heartbeatAt,
    supervisor.lastProgressAt,
    supervisor.lastMeaningfulProgressAt,
    supervisor.stallDetectedAt,
    supervisor.stalledReason,
    supervisor.staleReason,
    supervisor.stuckReason,
    supervisor.blockedReason,
    supervisor.repeatedToolName,
    supervisor.repeatedToolCount,
    supervisor.blockedSourceDomain,
    supervisor.blockedSourceUrl,
    supervisor.blockedHttpStatus,
    supervisor.blockedFailureKind,
    supervisor.blockedSourceCount,
    supervisor.recommendedAction,
    supervisor.recoveryEligible,
    supervisor.recoveryAttempts,
    compactSubagentTextSignature(supervisor.notes, 120),
  ]);
}

function getSubagentResultBundleSignature(bundle: SubagentRunRecord['resultBundle']): string {
  if (!bundle) return '';
  const itemSignature = (bundle.items || []).map((item) => buildSubagentPartSignature([
    item.id,
    item.kind,
    item.label,
    item.path,
    compactSubagentTextSignature(item.content, 120),
  ])).join('\u001e');
  return buildSubagentPartSignature([
    bundle.generatedAt,
    bundle.finalReportTruncated,
    compactSubagentTextSignature(bundle.summary, 160),
    compactSubagentTextSignature(bundle.partialReport, 160),
    compactSubagentTextSignature(bundle.finalReport, 160),
    bundle.missingExpectedOutputIds?.join(',') || '',
    bundle.items?.length || 0,
    itemSignature,
  ]);
}

function getSubagentRecoveryHistorySignature(history: SubagentRunRecord['recoveryHistory']): string {
  if (!history?.length) return '0';
  return history.map((entry) => buildSubagentPartSignature([
    entry.id,
    entry.action,
    entry.status,
    entry.startedAt,
    entry.completedAt,
    entry.replacementRunId,
    compactSubagentTextSignature(entry.reason, 100),
    compactSubagentTextSignature(entry.error, 100),
    compactSubagentTextSignature(entry.notes, 100),
  ])).join('\u001e');
}

function getSubagentInheritedContextSignature(context: SubagentRunRecord['inheritedContext']): string {
  if (!context) return '';
  return buildSubagentPartSignature([
    context.workingDirectory,
    context.privacyMode,
    context.buildMode,
    context.buildWorkspaceRelativePath,
    context.attachedFiles?.join(',') || '',
    context.toolsetIds?.join(',') || '',
    context.deferredToolDiscoveryEnabled,
    context.enabledToolsetIds?.join(',') || '',
    context.availableToolsetIds?.join(',') || '',
    context.inheritedToolsetIds?.join(',') || '',
  ]);
}

function getSubagentSharedContextSignature(context: SubagentRunRecord['sharedContext']): string {
  if (!context) return '';
  const blockedSources = (context.blockedSources || []).map((source) => buildSubagentPartSignature([
    source.domain,
    source.sourceUrl,
    source.httpStatus,
    source.failureKind,
    source.count,
    source.lastSeenAt,
    compactSubagentTextSignature(source.example, 80),
  ])).join('\u001e');
  return buildSubagentPartSignature([
    context.generatedAt,
    blockedSources,
    context.blockedTools?.join(',') || '',
    context.successfulFallbacks?.join(',') || '',
    context.confirmedFindings?.length || 0,
    context.openGaps?.length || 0,
  ]);
}

function getSubagentBuildHandoffSignature(handoff: SubagentRunRecord['buildHandoff']): string {
  if (!handoff) return '';
  const changedFiles = (handoff.changedFiles || []).slice(0, 80).map((file) => buildSubagentPartSignature([
    file.relativePath,
    file.changeType,
    file.addedLines,
    file.deletedLines,
    file.beforeTruncated,
    file.afterTruncated,
  ])).join('\u001e');
  return buildSubagentPartSignature([
    handoff.workspaceAgentId,
    handoff.workspaceRelativePath,
    handoff.baselineId,
    handoff.diffMode,
    handoff.diffAvailable,
    handoff.diffSummary,
    handoff.changedFiles?.length || 0,
    changedFiles,
    handoff.patchTruncated,
    compactSubagentTextSignature(handoff.patchExcerpt, 120),
    handoff.gitSummary?.branch,
    handoff.gitSummary?.dirty,
    handoff.gitSummary?.changedFileCount,
    handoff.gitSummary?.totalAddedLines,
    handoff.gitSummary?.totalDeletedLines,
    handoff.generatedAt,
  ]);
}

function getSubagentRunSignature(run: SubagentRunRecord & { childTaskStatus?: string; childTaskSummary?: string }): string {
  return buildSubagentPartSignature([
    run.runId,
    run.childTaskId,
    run.childSessionKey,
    run.sessionId,
    run.sessionState,
    run.parentTaskId,
    run.parentRunId,
    run.parentSessionKey,
    run.parentAgentId,
    run.childAgentId,
    run.persistentKey,
    run.label,
    compactSubagentTextSignature(run.task, 160),
    compactSubagentTextSignature(run.lastPrompt, 160),
    run.depth,
    run.mode,
    run.reuseCount,
    run.status,
    run.resultStatus,
    compactSubagentTextSignature(run.error, 160),
    compactSubagentTextSignature(run.finalReport, 160),
    run.finalReportTruncated,
    getSubagentProgressEventsSignature(run.progressEvents),
    getSubagentSupervisorSignature(run.supervisor),
    run.expectedOutputs?.length || 0,
    getSubagentResultBundleSignature(run.resultBundle),
    getSubagentRecoveryHistorySignature(run.recoveryHistory),
    run.replacesRunId,
    run.replacedByRunId,
    run.replacementReason,
    run.model?.provider,
    run.model?.model,
    run.executionPolicy?.mode,
    run.executionPolicy?.maxChildren,
    run.executionPolicy?.maxDepth,
    run.executionPolicy?.runTimeoutMs,
    run.executionPolicy?.autoRelayCompletions,
    getSubagentInheritedContextSignature(run.inheritedContext),
    getSubagentSharedContextSignature(run.sharedContext),
    getSubagentBuildHandoffSignature(run.buildHandoff),
    run.childTaskStatus,
    compactSubagentTextSignature(run.childTaskSummary, 160),
    run.createdAt,
    run.updatedAt,
    run.completedAt,
    run.lastResumedAt,
    run.archivedAt,
    run.closedAt,
  ]);
}

function preserveEquivalentSubagentRunReferences<T extends SubagentRunRecord>(current: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return current.length === 0 ? current : incoming;
  const currentById = new Map(current.map((run) => [run.runId, run]));
  let changed = incoming.length !== current.length;
  const next = incoming.map((run, index) => {
    const existing = currentById.get(run.runId);
    if (existing && getSubagentRunSignature(existing) === getSubagentRunSignature(run)) {
      if (current[index] !== existing) changed = true;
      return existing as T;
    }
    changed = true;
    return run;
  });
  return changed ? next : current;
}

function preserveEquivalentSubagentTreeReferences(current: SubagentRunTreeNode[], incoming: SubagentRunTreeNode[]): SubagentRunTreeNode[] {
  if (incoming.length === 0) return current.length === 0 ? current : incoming;
  const currentById = new Map(current.map((run) => [run.runId, run]));
  let changed = incoming.length !== current.length;
  const next = incoming.map((run, index) => {
    const existing = currentById.get(run.runId);
    const children = preserveEquivalentSubagentTreeReferences(existing?.children || [], run.children || []);
    const sameRun = existing && getSubagentRunSignature(existing) === getSubagentRunSignature(run);
    if (sameRun && children === existing.children) {
      if (current[index] !== existing) changed = true;
      return existing;
    }
    changed = true;
    return children === run.children ? run : { ...run, children };
  });
  return changed ? next : current;
}

function SubagentTreeList({
  nodes,
  level = 0,
  stoppingSubagentRunId,
  agentNames,
  onOpen,
  onInspect,
  onStop,
  onArchive,
  onRecover,
  onReplace,
}: {
  nodes: SubagentRunTreeNode[];
  level?: number;
  stoppingSubagentRunId: string | null;
  agentNames: Map<string, string>;
  onOpen: (run: SubagentRunRecord) => void;
  onInspect: (run: SubagentRunRecord) => void;
  onStop: (runId: string) => void;
  onArchive: (runId: string) => void;
  onRecover: (run: SubagentRunRecord) => void;
  onReplace: (run: SubagentRunRecord) => void;
}): ReactElement | null {
  if (nodes.length === 0) return null;
  return (
    <div className={cn('space-y-1.5', level > 0 ? 'ml-3 border-l border-border/50 pl-3 sm:ml-4' : '')}>
      {nodes.map((run) => {
        const stoppable = isActiveSubagentRun(run);
        const childAgentName = agentNames.get(run.childAgentId) || run.childAgentId;
        const activitySummary = getSubagentLatestActivitySummary(run);
        const progressSummary = formatSubagentProgressEvent(run);
        const recoverySummary = getSubagentRecoverySummary(run);
        const resultBundleSummary = getSubagentResultBundleSummary(run);
        const buildHandoffSummary = getSubagentBuildHandoffSummary(run);
        const inheritedToolsSummary = getSubagentInheritedToolsSummary(run);
        const sharedContextSummary = getSubagentSharedContextSummary(run);
        const indicators = getSubagentRunIndicators(run);
        const canRecover = canRequestSubagentRecovery(run);
        const canReplace = canRecover && !run.replacedByRunId;
        const relayEnabled = run.status === 'done' && run.executionPolicy?.autoRelayCompletions === true;
        return (
          <div key={run.runId} className="rounded-md border border-border/50 bg-card/70 px-2.5 py-2 shadow-sm backdrop-blur-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <div className="truncate text-xs font-semibold text-foreground" title={run.label || run.task}>
                    {run.label || run.childAgentId}
                  </div>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', getSubagentRunStatusClasses(run.status, run.resultStatus))}>
                    {formatSubagentRunStatus(run.status, run.resultStatus)}
                  </span>
                  {relayEnabled ? (
                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                      Relay enabled
                    </span>
                  ) : null}
                  {indicators.map((indicator) => (
                    <span
                      key={`${run.runId}-${indicator.label}`}
                      className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', indicator.className)}
                      title={indicator.title}
                    >
                      {indicator.label}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span className="truncate">Child: {childAgentName}</span>
                  {run.model ? <span className="truncate">{run.model.provider}:{run.model.model}</span> : null}
                  <span>{formatSubagentModeLabel(run)}</span>
                  <span>Elapsed {formatSubagentElapsed(run)}</span>
                  <span>Updated {formatSubagentUpdatedAge(run.updatedAt)}</span>
                </div>
                <div className="mt-1 truncate text-[10px] text-muted-foreground" title={run.task}>
                  Goal: {run.task}
                </div>
                {activitySummary ? (
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={activitySummary}>
                    Latest: {activitySummary}
                  </div>
                ) : null}
                {progressSummary && progressSummary !== activitySummary ? (
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={progressSummary}>
                    Progress: {progressSummary}
                  </div>
                ) : null}
                {recoverySummary || resultBundleSummary ? (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {recoverySummary ? <span className="truncate" title={recoverySummary}>{recoverySummary}</span> : null}
                    {resultBundleSummary ? <span className="truncate" title={resultBundleSummary}>Results: {resultBundleSummary}</span> : null}
                  </div>
                ) : null}
                {buildHandoffSummary ? (
                  <div
                    className="mt-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-200"
                    title={run.buildHandoff?.diffSummary || buildHandoffSummary}
                  >
                    {buildHandoffSummary}
                  </div>
                ) : null}
                {inheritedToolsSummary || sharedContextSummary ? (
                  <div
                    className="mt-1 space-y-0.5 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-800 dark:text-sky-200"
                    title={[inheritedToolsSummary, sharedContextSummary].filter(Boolean).join('\n')}
                  >
                    {inheritedToolsSummary ? <div className="truncate">{inheritedToolsSummary}</div> : null}
                    {sharedContextSummary ? <div className="truncate">{sharedContextSummary}</div> : null}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
                {canRecover ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-6 w-6"
                    onClick={() => onRecover(run)}
                    title="Ask subagent to recover"
                    aria-label="Ask subagent to recover"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {canReplace ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-6 w-6"
                    onClick={() => onReplace(run)}
                    title="Ask subagent to prepare replacement handoff"
                    aria-label="Ask subagent to prepare replacement handoff"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => onOpen(run)}
                  title="Open subagent transcript"
                  aria-label="Open subagent transcript"
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => onInspect(run)}
                  title="Inspect in Subagents"
                  aria-label="Inspect in Subagents"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                {stoppable ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-6 w-6"
                    onClick={() => onStop(run.runId)}
                    disabled={stoppingSubagentRunId === run.runId}
                    title="Cancel child run"
                    aria-label="Cancel child run"
                  >
                    {stoppingSubagentRunId === run.runId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => onArchive(run.runId)}
                  title="Archive subagent run"
                  aria-label="Archive subagent run"
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {run.children.length > 0 ? (
              <div className="mt-2">
                <SubagentTreeList
                  nodes={run.children}
                  level={level + 1}
                  stoppingSubagentRunId={stoppingSubagentRunId}
                  agentNames={agentNames}
                  onOpen={onOpen}
                  onInspect={onInspect}
                  onStop={onStop}
                  onArchive={onArchive}
                  onRecover={onRecover}
                  onReplace={onReplace}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SubagentBackgroundWorkCard({
  activeCount,
  totalCount,
  loading,
  nodes,
  stoppingSubagentRunId,
  agentNames,
  onOpen,
  onInspect,
  onStop,
  onArchive,
  onRecover,
  onReplace,
  onMinimize,
  compact = false,
}: {
  activeCount: number;
  totalCount: number;
  loading: boolean;
  nodes: SubagentRunTreeNode[];
  stoppingSubagentRunId: string | null;
  agentNames: Map<string, string>;
  onOpen: (run: SubagentRunRecord) => void;
  onInspect: (run: SubagentRunRecord) => void;
  onStop: (runId: string) => void;
  onArchive: (runId: string) => void;
  onRecover: (run: SubagentRunRecord) => void;
  onReplace: (run: SubagentRunRecord) => void;
  onMinimize?: () => void;
  compact?: boolean;
}): ReactElement {
  return (
    <div className="rounded-lg border border-border/60 bg-card/85 p-2.5 shadow-sm backdrop-blur-md">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            {activeCount > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
            <span>Background work</span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            Current task child agents
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{loading ? 'Refreshing...' : `${activeCount} active · ${totalCount} total`}</span>
            {onMinimize ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Minimise Background work to a top tab"
                      onClick={onMinimize}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end">
                    Minimise to top tab
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
      </div>
      <div className={cn(compact ? 'max-h-32' : 'max-h-40', 'overflow-y-auto pr-1')}>
        <SubagentTreeList
          nodes={nodes}
          stoppingSubagentRunId={stoppingSubagentRunId}
          agentNames={agentNames}
          onOpen={onOpen}
          onInspect={onInspect}
          onStop={onStop}
          onArchive={onArchive}
          onRecover={onRecover}
          onReplace={onReplace}
        />
      </div>
    </div>
  );
}

interface ParsedPlanItem {
  id: string;
  content: string;
  status?: string;
  priority?: string;
}

interface AssistantReasoningParts {
  reasoning: string;
  answer: string;
  hasReasoning: boolean;
}

function splitAssistantReasoningContent(content: string): AssistantReasoningParts {
  const source = String(content || '');
  const answerParts: string[] = [];
  const reasoningParts: string[] = [];
  const reasoningTagPattern = 'think|thinks|thinking|reasoning';
  const openTagPattern = new RegExp(`<(${reasoningTagPattern})>`, 'gi');
  const closeTagPattern = new RegExp(`</(?:${reasoningTagPattern})>`, 'i');
  let cursor = 0;

  while (cursor < source.length) {
    openTagPattern.lastIndex = cursor;
    const openMatch = openTagPattern.exec(source);
    const orphanCloseMatch = closeTagPattern.exec(source.slice(cursor));
    if (orphanCloseMatch && (!openMatch || cursor + orphanCloseMatch.index < openMatch.index)) {
      const closeStart = cursor + orphanCloseMatch.index;
      const closeEnd = closeStart + orphanCloseMatch[0].length;
      const reasoning = source.slice(cursor, closeStart);
      if (reasoning.trim()) reasoningParts.push(reasoning.trim());
      cursor = closeEnd;
      continue;
    }

    if (!openMatch) break;

    const before = source.slice(cursor, openMatch.index);
    if (before.trim()) answerParts.push(before.trim());

    const reasoningStart = openTagPattern.lastIndex;
    const closeMatch = closeTagPattern.exec(source.slice(reasoningStart));

    if (!closeMatch) {
      const fallbackReasoning = source.slice(reasoningStart);
      if (fallbackReasoning.trim()) reasoningParts.push(fallbackReasoning.trim());
      cursor = source.length;
      break;
    }

    const closeStart = reasoningStart + closeMatch.index;
    const closeEnd = closeStart + closeMatch[0].length;
    const reasoning = source.slice(reasoningStart, closeStart);
    if (reasoning.trim()) reasoningParts.push(reasoning.trim());
    cursor = closeEnd;
  }

  const after = source.slice(cursor);
  if (after.trim()) answerParts.push(after.trim());

  const reasoning = reasoningParts.join('\n\n').trim();
  return {
    reasoning,
    answer: answerParts.join('\n\n').trim(),
    hasReasoning: reasoning.length > 0,
  };
}

function getAssistantAnswerContent(content: string): string {
  const parts = splitAssistantReasoningContent(content);
  return parts.hasReasoning ? parts.answer : String(content || '');
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
      const planArray = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).plan))
          ? ((parsed as Record<string, unknown>).plan as unknown[])
          : null;
      if (!planArray) continue;

      const items: ParsedPlanItem[] = [];
      for (let i = 0; i < planArray.length; i += 1) {
        const entry = planArray[i];
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const text = typeof record.content === 'string' ? record.content.trim() : '';
        if (!text) return null;
        items.push({
          id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : String(i + 1),
          content: text,
          status: typeof record.status === 'string' ? record.status.trim().toLowerCase() : undefined,
          priority: typeof record.priority === 'string' ? record.priority.trim().toLowerCase() : undefined,
        });
      }

      return items.length > 0 ? items : null;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function formatPlanStatus(status?: string): string {
  if (!status) return 'pending';
  if (status === 'in_progress') return 'in progress';
  return status.replace(/_/g, ' ');
}

function getPlanStatusBadgeClasses(status?: string): string {
  if (status === 'completed') return 'bg-emerald-500/10 text-emerald-700';
  if (status === 'in_progress') return 'bg-amber-500/10 text-amber-700';
  if (status === 'failed' || status === 'blocked') return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

function getPlanPriorityBadgeClasses(priority?: string): string {
  if (priority === 'high') return 'bg-destructive/10 text-destructive';
  if (priority === 'medium') return 'bg-amber-500/10 text-amber-700';
  if (priority === 'low') return 'bg-emerald-500/10 text-emerald-700';
  return 'bg-muted text-muted-foreground';
}

// --- FollowUpBar: isolated component that owns its own typing state ---
// By moving followUp / attachedFiles / workingFolder state here, keystrokes
// only re-render this subtree instead of the entire ExecutionPage (which
// includes the expensive message list).

interface FollowUpBarHandle {
  setValue: (text: string) => void;
  appendValue: (text: string) => void;
  focus: () => void;
}

interface FollowUpBarProps {
  isLoading: boolean;
  hasSession: boolean;
  currentTaskStatus: string;
  promptsCount: number;
  onSend: (message: string, files?: string[], workingFolder?: string | null, privacyMode?: 'normal' | 'incognito', usageProjectId?: string | null) => Promise<void>;
  onStop?: () => void;
  onOpenSavedPrompts: (mode: 'select' | 'manage') => void;
  onOpenProjectWork?: () => void;
  onUsageProjectChange?: (projectId: string | null) => void | Promise<void>;
  onPlanNextJobs?: () => Promise<void>;
  planningJobs?: boolean;
  taskId?: string;
  agentId?: string;
  usageProjectId?: string | null;
  privacyMode?: 'normal' | 'incognito';
  onPrivacyModeChange?: (mode: 'normal' | 'incognito') => void;
  slashCommands: SlashCommandDefinition[];
  translucentSurface?: boolean;
}

const FollowUpBar = forwardRef<FollowUpBarHandle, FollowUpBarProps>(
  function FollowUpBar(
    { isLoading, hasSession, currentTaskStatus, promptsCount, onSend, onStop, onOpenSavedPrompts, onOpenProjectWork, onUsageProjectChange, onPlanNextJobs, planningJobs, taskId, agentId, usageProjectId, privacyMode = 'normal', onPrivacyModeChange, slashCommands, translucentSurface = false },
    ref
  ) {
    const [followUp, setFollowUp] = useState('');
    const [contextStats, setContextStats] = useState<ContextWindowEstimateResponse | null>(null);
    const attachedFiles = useAttachmentStore((state) => state.files);
    const addAttachedFiles = useAttachmentStore((state) => state.addFiles);
    const removeAttachedFile = useAttachmentStore((state) => state.removeFile);
    const clearAttachedFiles = useAttachmentStore((state) => state.clearFiles);
    const [workingFolder, setWorkingFolder] = useState<string | null>(null);
    const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
    const [selectedUsageProjectId, setSelectedUsageProjectId] = useState<string | null>(usageProjectId ?? null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const resizeRafRef = useRef<number>(0);
    const promptHistoryEntriesRef = useRef<string[]>([]);
    const promptHistoryCursorRef = useRef<number | null>(null);
    const promptHistoryDraftRef = useRef('');
    const accomplish = getAccomplish();

    useImperativeHandle(ref, () => ({
      setValue: (text: string) => {
        promptHistoryCursorRef.current = null;
        promptHistoryDraftRef.current = '';
        setFollowUp(text);
      },
      appendValue: (text: string) => {
        const insertion = text.trim();
        if (!insertion) return;
        promptHistoryCursorRef.current = null;
        promptHistoryDraftRef.current = '';
        setFollowUp((current) => (current.trim() ? `${current.trim()}\n\n${insertion}` : insertion));
      },
      focus: () => {
        inputRef.current?.focus();
      },
    }));

    // Auto-focus on mount
    useEffect(() => {
      inputRef.current?.focus();
    }, []);

    useEffect(() => {
      promptHistoryEntriesRef.current = readPromptHistory(CHAT_PROMPT_HISTORY_STORAGE_KEY);
    }, []);

    useEffect(() => {
      setSelectedUsageProjectId(usageProjectId ?? null);
    }, [usageProjectId, taskId]);

    const resetPromptHistoryNavigation = useCallback(() => {
      promptHistoryCursorRef.current = null;
      promptHistoryDraftRef.current = '';
    }, []);

    useEffect(() => registerPromptInsertionTarget(
      { mode: 'chat', label: 'Chat follow-up prompt' },
      (text) => {
        const insertion = text.trim();
        if (!insertion) return;
        resetPromptHistoryNavigation();
        setFollowUp((current) => (current.trim() ? `${current.trim()}\n\n${insertion}` : insertion));
        window.requestAnimationFrame(() => {
          const input = inputRef.current;
          if (!input) return;
          input.focus();
          const cursor = input.value.length;
          input.setSelectionRange(cursor, cursor);
        });
      }
    ), [resetPromptHistoryNavigation]);

    useEffect(() => registerPromptAttachmentTarget(
      { mode: 'chat', label: 'Chat follow-up prompt' },
      addAttachedFiles
    ), [addAttachedFiles]);

    const setFollowUpFromHistory = useCallback((value: string) => {
      setFollowUp(value);
      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        const cursor = input.value.length;
        input.setSelectionRange(cursor, cursor);
      });
    }, []);

    const recallPromptHistory = useCallback((direction: 'older' | 'newer') => {
      const entries = promptHistoryEntriesRef.current;
      if (entries.length === 0) return;

      const currentCursor = promptHistoryCursorRef.current;
      if (direction === 'older') {
        if (currentCursor === null) {
          promptHistoryDraftRef.current = inputRef.current?.value ?? followUp;
          promptHistoryCursorRef.current = entries.length - 1;
        } else {
          promptHistoryCursorRef.current = Math.max(0, currentCursor - 1);
        }
      } else if (currentCursor !== null) {
        if (currentCursor >= entries.length - 1) {
          promptHistoryCursorRef.current = null;
          setFollowUpFromHistory(promptHistoryDraftRef.current);
          return;
        }
        promptHistoryCursorRef.current = currentCursor + 1;
      }

      const nextCursor = promptHistoryCursorRef.current;
      if (nextCursor !== null) {
        setFollowUpFromHistory(entries[nextCursor] ?? '');
      }
    }, [followUp, setFollowUpFromHistory]);

    const handleFollowUpChange = useCallback((value: string) => {
      resetPromptHistoryNavigation();
      setFollowUp(value);
    }, [resetPromptHistoryNavigation]);

    const handleUsageProjectChange = useCallback((projectId: string | null) => {
      setSelectedUsageProjectId(projectId);
      void onUsageProjectChange?.(projectId);
    }, [onUsageProjectChange]);

    const filteredSlashCommands = useMemo(
      () => filterSlashCommands(followUp, slashCommands),
      [followUp, slashCommands]
    );

    useEffect(() => {
      setSelectedSlashIndex((current) => {
        if (filteredSlashCommands.length === 0) return 0;
        return Math.min(current, filteredSlashCommands.length - 1);
      });
    }, [filteredSlashCommands]);

    // Auto-resize follow-up field up to about one paragraph, then allow scrolling.
    useEffect(() => {
      const MAX_HEIGHT_PX = 120;
      const MIN_HEIGHT_PX = 40;
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        const textarea = inputRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        const nextHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT_PX);
        textarea.style.height = `${Math.max(nextHeight, MIN_HEIGHT_PX)}px`;
        textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
      });
      return () => cancelAnimationFrame(resizeRafRef.current);
    }, [followUp]);

    // Live context window estimation (debounced)
    useEffect(() => {
      let cancelled = false;
      const timeout = setTimeout(() => {
        accomplish
          .estimateContextWindow({
            prompt: followUp,
            taskId,
            agentId,
            attachedFiles: attachedFiles.length ? attachedFiles : undefined,
          })
          .then((stats) => {
            if (cancelled) return;
            setContextStats(stats);
          })
          .catch(() => {
            if (cancelled) return;
            setContextStats(null);
          });
      }, 250);

      return () => {
        cancelled = true;
        clearTimeout(timeout);
      };
    }, [accomplish, followUp, attachedFiles, agentId, taskId]);

    const handleSubmit = useCallback(async () => {
      if (!followUp.trim()) return;
      const message = followUp.trim();
      const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
      await onSend(message, files, workingFolder, privacyMode, selectedUsageProjectId);
      if (privacyMode !== 'incognito') {
        promptHistoryEntriesRef.current = addPromptHistoryEntry(
          CHAT_PROMPT_HISTORY_STORAGE_KEY,
          message,
          promptHistoryEntriesRef.current
        );
      }
      resetPromptHistoryNavigation();
      setFollowUp('');
      clearAttachedFiles();
      setWorkingFolder(null);
    }, [followUp, attachedFiles, workingFolder, onSend, privacyMode, selectedUsageProjectId, clearAttachedFiles, resetPromptHistoryNavigation]);

    const handleExecuteSlashCommand = useCallback(async (command: SlashCommandDefinition) => {
      await command.execute();
      resetPromptHistoryNavigation();
      setFollowUp('');
      setSelectedSlashIndex(0);
    }, [resetPromptHistoryNavigation]);

    const {
      voiceEnabled,
      voiceAccessKeySet,
      voiceToggleBusy,
      toggleVoiceWake,
      talkModeActive,
      talkModeInterim,
      talkModeError,
      talkModeLevel,
      voiceMeterLevel,
    } = useVoiceWakeTalkMode({
      value: followUp,
      onChange: handleFollowUpChange,
      onSubmit: handleSubmit,
      focusRef: inputRef,
      disabled: isLoading,
    });

    const handleSelectFolder = async () => {
      const folder = await accomplish.selectFolder();
      if (folder) setWorkingFolder(folder);
    };

    const clearWorkingFolder = () => setWorkingFolder(null);

    const handleSelectFiles = async () => {
      const files = await accomplish.selectFiles();
      if (files.length > 0) {
        addAttachedFiles(files);
      }
    };

    const removeFile = (filePath: string) => {
      removeAttachedFile(filePath);
    };

    return (
      <div
        className={cn(
          'flex-shrink-0 border-t border-border px-4 py-2',
          translucentSurface ? 'bg-background/28 backdrop-blur-md' : 'bg-card/50'
        )}
      >
        <div className="mx-auto max-w-5xl space-y-1.5">
          {privacyMode === 'incognito' && (
            <p className="text-[10px] leading-tight text-muted-foreground">
              Chat content is not saved. Usage totals still include this session.
            </p>
          )}
          {/* Input field with Ideas/Send buttons */}
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={isLoading}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/85 text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  title="Add photos and files"
                  aria-label="Add photos and files"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onClick={handleSelectFiles}>
                  <Image className="h-4 w-4" />
                  Add photos & files
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="relative min-w-0 flex-1">
              <textarea
                ref={inputRef}
                value={followUp}
                onChange={(e) => handleFollowUpChange(e.target.value)}
                onKeyDown={(e) => {
                  if (filteredSlashCommands.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedSlashIndex((current) => (
                        current >= filteredSlashCommands.length - 1 ? 0 : current + 1
                      ));
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedSlashIndex((current) => (
                        current <= 0 ? filteredSlashCommands.length - 1 : current - 1
                      ));
                      return;
                    }
                    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                      e.preventDefault();
                      const selected = filteredSlashCommands[selectedSlashIndex] || filteredSlashCommands[0];
                      if (selected) {
                        void handleExecuteSlashCommand(selected);
                      }
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      resetPromptHistoryNavigation();
                      setFollowUp('');
                      setSelectedSlashIndex(0);
                      return;
                    }
                  }
                  if (e.key === 'ArrowUp') {
                    const shouldRecall = shouldHandlePromptHistoryRecall({
                      key: e.key,
                      altKey: e.altKey,
                      ctrlKey: e.ctrlKey,
                      metaKey: e.metaKey,
                      shiftKey: e.shiftKey,
                      isComposing: e.nativeEvent.isComposing,
                      currentTarget: e.currentTarget,
                    }, 'older', promptHistoryCursorRef.current !== null);
                    if (shouldRecall) {
                      e.preventDefault();
                      recallPromptHistory('older');
                      return;
                    }
                  }
                  if (e.key === 'ArrowDown') {
                    const shouldRecall = shouldHandlePromptHistoryRecall({
                      key: e.key,
                      altKey: e.altKey,
                      ctrlKey: e.ctrlKey,
                      metaKey: e.metaKey,
                      shiftKey: e.shiftKey,
                      isComposing: e.nativeEvent.isComposing,
                      currentTarget: e.currentTarget,
                    }, 'newer', promptHistoryCursorRef.current !== null);
                    if (shouldRecall) {
                      e.preventDefault();
                      recallPromptHistory('newer');
                      return;
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={
                  ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentTaskStatus)
                    ? (hasSession ? 'Give new instructions...' : 'Start a new task...')
                    : 'Ask for something...'
                }
                disabled={isLoading}
                rows={1}
                className="followup-textarea-scrollbar block min-h-9 max-h-[104px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="execution-follow-up-input"
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
            </div>
            {onPlanNextJobs && (
              <Button
                onClick={() => void onPlanNextJobs()}
                disabled={isLoading || Boolean(planningJobs)}
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                title="Ask Deskmate for ideas based on your memory"
                aria-label="Ask Deskmate for ideas based on your memory"
              >
                {planningJobs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
            )}
            <Button
              onClick={() => void handleSubmit()}
              disabled={!followUp.trim() || isLoading}
              variant="outline"
              className="h-9 shrink-0 gap-1.5 px-3"
            >
              <CornerDownLeft className="h-4 w-4" />
              {hasSession || currentTaskStatus === 'interrupted' ? 'Send' : 'Start'}
            </Button>
            {currentTaskStatus === 'running' && onStop && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onStop}
                title="Stop agent (Ctrl+C)"
                aria-label="Stop agent"
                className="h-9 w-9 shrink-0 hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid="execution-stop-button"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            )}
          </div>

          {/* Action buttons under prompt input */}
          <div className="flex flex-wrap items-center gap-1.5">
            <ContextWindowIndicator stats={contextStats} />
            <ContextInspector
              stats={contextStats}
              agentId={agentId}
              workspace={workingFolder}
              attachedFiles={attachedFiles}
              privacyMode={privacyMode}
              usageProjectId={selectedUsageProjectId}
            />
            <UsageProjectSelector
              mode="chat"
              value={selectedUsageProjectId}
              onChange={handleUsageProjectChange}
              compact
              disabled={isLoading}
            />
            <UsageBudgetPill usageProjectId={selectedUsageProjectId} label="Task budget" className="max-w-[220px]" />

            <button
              type="button"
              onClick={handleSelectFolder}
              disabled={isLoading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/85 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="Select a working folder"
              aria-label="Select a working folder"
            >
              <Folder className="h-3.5 w-3.5" />
            </button>

            {onPrivacyModeChange && (
              <button
                type="button"
                onClick={() => onPrivacyModeChange(privacyMode === 'incognito' ? 'normal' : 'incognito')}
                disabled={isLoading}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-medium shadow-sm backdrop-blur-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  privacyMode === 'incognito'
                    ? 'border-amber-500/60 bg-amber-500/20 text-amber-700'
                    : 'border-border/70 bg-background/85 text-foreground/80 hover:border-border hover:bg-background hover:text-foreground'
                }`}
                title="Toggle incognito mode for this task/session"
                aria-label="Toggle incognito mode for this task/session"
              >
                <Shield className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenSavedPrompts('select')}
              disabled={isLoading || promptsCount === 0}
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-background/85 px-2 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title={promptsCount === 0 ? 'No saved prompts or recipes' : 'Use a saved prompt or recipe'}
              aria-label={promptsCount === 0 ? 'No saved prompts or recipes' : 'Use a saved prompt or recipe'}
            >
              <FileText className="h-3.5 w-3.5" />
              {promptsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">
                  {promptsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onOpenSavedPrompts('manage')}
              disabled={isLoading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/85 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="Manage saved prompts"
              aria-label="Manage saved prompts"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={onOpenProjectWork}
              disabled={isLoading || !onOpenProjectWork}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/85 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="Open project work linked to this Chat task."
              aria-label="Open project work linked to this Chat task"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={toggleVoiceWake}
              disabled={voiceToggleBusy || isLoading || !voiceAccessKeySet || talkModeActive}
              className={`flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors ${
                voiceEnabled ? 'bg-emerald-500/20 text-emerald-700' : 'bg-background/85 text-foreground/80'
              } ${voiceToggleBusy ? 'opacity-60' : ''} ${talkModeActive ? 'ring-2 ring-emerald-400/40 shadow-glow' : ''}`}
              title={
                !voiceAccessKeySet
                  ? 'Add access key to activate Picovoice'
                  : talkModeActive
                    ? 'Listening for speech...'
                    : voiceEnabled
                      ? 'Click to turn off voice wake'
                      : 'Click to turn on voice wake'
              }
            >
              <Mic className="h-3.5 w-3.5" />
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide">
                <span
                  className={`h-2 w-2 rounded-full ${
                    talkModeActive ? 'bg-emerald-500 animate-pulse' : voiceEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                  }`}
                />
                {voiceEnabled ? 'On' : 'Off'}
              </span>
              {talkModeActive && (
                <span className="text-[10px] font-semibold text-emerald-600 animate-pulse">Listening...</span>
              )}
              <div className="flex items-end gap-[2px] h-4">
                {(() => {
                  const thresholds = [0.12, 0.24, 0.36, 0.5, 0.65, 0.8];
                  const level = voiceMeterLevel;
                  return thresholds.map((threshold, index) => (
                    <span
                      key={threshold}
                      className={`w-1 rounded-sm transition-colors ${
                        level >= threshold
                          ? 'bg-emerald-500'
                          : voiceEnabled
                            ? 'bg-emerald-500/30'
                            : 'bg-muted-foreground/30'
                      }`}
                      style={{ height: `${6 + index * 2}px` }}
                    />
                  ));
                })()}
              </div>
            </button>
          </div>

          {(talkModeActive || talkModeError) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {talkModeActive && (
                <span className="text-emerald-600 animate-pulse">Listening...</span>
              )}
              {talkModeActive && (
                <div className="flex items-center gap-1">
                  {Array.from({ length: 6 }).map((_, index) => {
                    const threshold = (index + 1) / 6;
                    return (
                      <span
                        key={`talk-meter-${index}`}
                        className={`w-1 rounded-sm transition-colors ${
                          talkModeLevel >= threshold ? 'bg-emerald-500' : 'bg-emerald-500/30'
                        }`}
                        style={{ height: `${6 + index * 2}px` }}
                      />
                    );
                  })}
                </div>
              )}
              {talkModeActive && talkModeInterim && (
                <span className="text-emerald-500/70">"{talkModeInterim}"</span>
              )}
              {talkModeError && (
                <span className="text-destructive">{talkModeError}</span>
              )}
            </div>
          )}

          {/* Attached files display */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file) => (
                <div key={file} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs text-foreground">
                  <FileText className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate max-w-[200px]" title={file}>
                    {file.split(/[\\/]/).pop()}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(file)}
                    className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Working folder display */}
          {workingFolder && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm">
              <Folder className="h-4 w-4 text-primary shrink-0" />
              <span className="text-muted-foreground">Working in:</span>
              <span className="text-foreground truncate flex-1" title={workingFolder}>
                {workingFolder}
              </span>
              <button
                type="button"
                onClick={clearWorkingFolder}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Clear working folder"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default function ExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const accomplish = getAccomplish();
  const messagesVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const messageScrollerRef = useRef<HTMLElement | null>(null);
  const followUpBarRef = useRef<FollowUpBarHandle>(null);
  const isNearBottomRef = useRef(true);
  const lastAutoScrollRef = useRef<{ taskId: string | null; messageCount: number }>({ taskId: null, messageCount: 0 });
  const autoFollowSuppressedUntilRef = useRef(0);
  const bottomScrollFrameRef = useRef<number | null>(null);
  const bottomScrollTimeoutsRef = useRef<number[]>([]);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<'normal' | 'incognito'>('normal');
  const [taskRunCount, setTaskRunCount] = useState(0);
  const [activePromptNavigatorId, setActivePromptNavigatorId] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [currentToolInput, setCurrentToolInput] = useState<unknown>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugModeEnabled, setDebugModeEnabled] = useState(false);
  const [debugExported, setDebugExported] = useState(false);
  const [planningJobs, setPlanningJobs] = useState(false);
  const [globalSelectedModel, setGlobalSelectedModel] = useState<SelectedModel | null>(null);
  const [modelProviders, setModelProviders] = useState<ProviderConfig[]>([]);
  const [modelApiKeyStatus, setModelApiKeyStatus] = useState<Record<string, { exists: boolean; prefix?: string }>>({});
  const [proactiveOpen, setProactiveOpen] = useState(false);
  const [proactiveError, setProactiveError] = useState<string | null>(null);
  const [proactiveSuggestions, setProactiveSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [saveSkillOpen, setSaveSkillOpen] = useState(false);
  const [saveSkillLoading, setSaveSkillLoading] = useState(false);
  const [saveSkillSaving, setSaveSkillSaving] = useState(false);
  const [saveSkillError, setSaveSkillError] = useState<string | null>(null);
  const [saveSkillOverwrite, setSaveSkillOverwrite] = useState(false);
  const [saveSkillId, setSaveSkillId] = useState('');
  const [saveSkillName, setSaveSkillName] = useState('');
  const [saveSkillDesc, setSaveSkillDesc] = useState('');
  const [saveSkillMd, setSaveSkillMd] = useState('');
  const [saveSkillShareScope, setSaveSkillShareScope] = useState<UserSkillSharingScope>('private');
  const [saveSkillShareAgentIds, setSaveSkillShareAgentIds] = useState<string[]>([]);
  const [subagentRuns, setSubagentRuns] = useState<SubagentRunRecord[]>([]);
  const [subagentTree, setSubagentTree] = useState<SubagentRunTreeNode[]>([]);
  const [subagentRunsLoading, setSubagentRunsLoading] = useState(false);
  const [subagentPanelMinimized, setSubagentPanelMinimized] = useState(false);
  const [stoppingSubagentRunId, setStoppingSubagentRunId] = useState<string | null>(null);
  const [subagentDetailRun, setSubagentDetailRun] = useState<SubagentRunRecord | null>(null);
  const [subagentDetailTask, setSubagentDetailTask] = useState<Task | null>(null);
  const [subagentDetailLoading, setSubagentDetailLoading] = useState(false);
  const [subagentDetailPrompt, setSubagentDetailPrompt] = useState('');
  const [subagentDetailModelOverride, setSubagentDetailModelOverride] = useState('');
  const [subagentDetailSending, setSubagentDetailSending] = useState(false);
  const [subagentDetailMutating, setSubagentDetailMutating] = useState(false);
  const [subagentDetailMessageLimit, setSubagentDetailMessageLimit] = useState(SUBAGENT_DETAIL_TRANSCRIPT_INITIAL_LIMIT);
  const debugPanelRef = useRef<HTMLDivElement>(null);
  const addAttachedFiles = useAttachmentStore((state) => state.addFiles);
  const autoFollowUpSentRef = useRef<Set<string>>(new Set());
  const { agents, activeAgentId, loadAgents, upsertAgent } = useAgentStore();
  const [chatAnswerAvatarsVisible, setChatAnswerAvatarsVisible] = useState(readChatAnswerAvatarVisible);
  const [chatAnswerAvatarNoticeVisible, setChatAnswerAvatarNoticeVisible] = useState(false);
  const [pendingAgentChatBackgroundId, setPendingAgentChatBackgroundId] = useState<string | null>(null);
  const [pendingAgentAppearance, setPendingAgentAppearance] = useState<Partial<AgentAppearance>>({});
  const [conversationMapExtras, setConversationMapExtras] = useState<ConversationMapExtraEntry[]>([]);
  const [postcardDraft, setPostcardDraft] = useState<ChatPostcardDraft | null>(null);
  const [postcardTemplate, setPostcardTemplate] = useState<ChatPostcardTemplate>('clean-summary');
  const [postcardSaving, setPostcardSaving] = useState(false);
  const [postcardGenerating, setPostcardGenerating] = useState(false);
  const [postcardError, setPostcardError] = useState<string | null>(null);
  const {
    projects: usageProjects,
    assignees: usageAssignees,
    selectedChatProjectId,
    loadProjects: loadUsageProjects,
    createProject: createUsageProject,
  } = useUsageProjectStore();
  const { folders, loadFolders } = useFolderStore();
  const activeSubagentCount = useMemo(
    () => subagentRuns.filter(isActiveSubagentRun).length,
    [subagentRuns]
  );
  const {
    currentTask,
    loadTaskById,
    isLoading,
    error,
    addTaskUpdate,
    addTaskActivity,
    addTaskUpdateBatch,
    updateTaskStatus,
    permissionRequest,
    sendFollowUp,
    setTaskUsageProject,
    startTask,
    interruptTask,
    setupProgress,
    setupProgressTaskId,
    setupDownloadStep,
  } = useTaskStore();

  useEffect(() => {
    if (subagentRuns.length === 0) {
      setSubagentPanelMinimized(false);
    }
  }, [subagentRuns.length]);

  useEffect(() => {
    if (currentTask?.privacyMode === 'incognito') {
      setPrivacyMode('incognito');
      return;
    }
    if (currentTask?.privacyMode === 'normal') {
      setPrivacyMode('normal');
    }
  }, [currentTask?.privacyMode]);

  const taskAgentId = currentTask?.agentId || activeAgentId;
  const pluginSlashCommands = usePluginSlashCommands();
  const canSaveSkillFromTask = Boolean(
    currentTask
    && ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentTask.status)
    && currentTask.messages.length > 0
  );
  const visibleTaskMessages = useMemo(() => {
    const messages = currentTask?.messages ?? [];
    const lastMessage = messages[messages.length - 1];
    const isLastMessageBashTool = lastMessage?.type === 'tool' && lastMessage?.toolName?.toLowerCase() === 'bash';
    const taskIsComplete = ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentTask?.status ?? '');

    return messages.filter((message, index) => {
      if (!(message.type === 'tool' && message.toolName?.toLowerCase() === 'bash')) {
        return true;
      }
      return taskIsComplete && isLastMessageBashTool && index === messages.length - 1;
    });
  }, [currentTask?.messages, currentTask?.status]);
  const recentTaskActivity = useMemo(
    () => (currentTask?.activity ?? []).slice(-CHAT_NAVIGATOR_ACTIVITY_ENTRY_LIMIT),
    [currentTask?.activity]
  );
  useEffect(() => {
    setConversationMapExtras(readConversationMapExtras(currentTask?.id));
  }, [currentTask?.id]);

  const addConversationMapExtra = useCallback((entry: Omit<ConversationMapExtraEntry, 'taskId' | 'timestamp'> & { timestamp?: string }) => {
    if (!currentTask?.id) return;
    setConversationMapExtras((current) => {
      const nextEntry: ConversationMapExtraEntry = {
        ...entry,
        taskId: currentTask.id,
        timestamp: entry.timestamp || new Date().toISOString(),
      };
      const next = [nextEntry, ...current.filter((item) => item.id !== nextEntry.id)].slice(0, 120);
      writeConversationMapExtras(currentTask.id, next);
      return next;
    });
  }, [currentTask?.id]);

  const removeConversationMapExtra = useCallback((entryId: string) => {
    if (!currentTask?.id) return;
    setConversationMapExtras((current) => {
      const next = current.filter((item) => item.id !== entryId);
      writeConversationMapExtras(currentTask.id, next);
      return next;
    });
  }, [currentTask?.id]);

  const promptNavigatorEntries = useMemo<PromptNavigatorEntry[]>(() => {
    const entries: PromptNavigatorEntry[] = [];
    const messageIndexById = new Map<string, number>();
    const messageTimes = visibleTaskMessages.map((message) => {
      const value = new Date(message.timestamp || '').getTime();
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    });
    visibleTaskMessages.forEach((message, index) => {
      messageIndexById.set(message.id, index);
    });

    const findMessageIndexAtOrAfter = (timestampMs: number): number => {
      if (!Number.isFinite(timestampMs) || messageTimes.length === 0) return -1;
      let low = 0;
      let high = messageTimes.length - 1;
      let result = -1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (messageTimes[mid] >= timestampMs) {
          result = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      return result;
    };

    const shouldScanAssetsForNavigator = (messageIndex: number): boolean => (
      visibleTaskMessages.length <= CHAT_NAVIGATOR_FULL_ASSET_SCAN_MESSAGE_LIMIT
      || messageIndex >= visibleTaskMessages.length - CHAT_NAVIGATOR_RECENT_ASSET_SCAN_LIMIT
    );

    const addEntry = (entry: PromptNavigatorEntry) => {
      if (!entry.preview.trim()) return;
      entries.push(entry);
    };

    visibleTaskMessages.forEach((message, index) => {
      if (message.type === 'user') {
        addEntry({
          id: `prompt:${message.id}`,
          messageIndex: index,
          preview: createPromptPreview(message.content),
          fullText: createConversationMapFullText(message.content),
          timestamp: message.timestamp,
          kind: 'prompt',
          detail: 'Prompt',
        });
        return;
      }

      if (message.type !== 'assistant') return;
      const answerContent = getAssistantAnswerContent(message.content);
      const answerPreview = createPromptPreview(answerContent || message.content);
      addEntry({
        id: `answer:${message.id}`,
        messageIndex: index,
        preview: answerPreview === 'Untitled prompt' ? 'Assistant answer' : answerPreview,
        fullText: createConversationMapFullText(answerContent || message.content),
        timestamp: message.timestamp,
        kind: 'answer',
        detail: 'Answer',
      });

      const assetContent = answerContent || message.content;
      if (shouldScanAssetsForNavigator(index)) {
        const previews = extractAssistantLinkPreviews(assetContent);
        previews.imageLinks.forEach((image, imageIndex) => {
          addEntry({
            id: `image:${message.id}:${imageIndex}:${image.url}`,
            messageIndex: index,
            preview: image.label || 'Image',
            fullText: image.url,
            timestamp: message.timestamp,
            kind: 'image',
            detail: 'Image in answer',
            assetLabel: image.label,
            assetUrl: image.url,
          });
        });
        previews.documentLinks.forEach((documentLink, documentIndex) => {
          addEntry({
            id: `document:${message.id}:${documentIndex}:${documentLink.target}`,
            messageIndex: index,
            preview: documentLink.label || 'Document',
            fullText: documentLink.target,
            timestamp: message.timestamp,
            kind: 'document',
            detail: documentLink.kind === 'local' ? 'Local document' : 'Web document',
            assetLabel: documentLink.label,
            assetUrl: documentLink.target,
          });
        });
        previews.siteLinks.forEach((site, siteIndex) => {
          addEntry({
            id: `source:${message.id}:${siteIndex}:${site.host}`,
            messageIndex: index,
            preview: site.host,
            fullText: site.url,
            timestamp: message.timestamp,
            kind: 'source',
            detail: 'Source link',
            assetLabel: site.host,
            assetUrl: site.url,
          });
        });
      }
    });

    const messageCount = visibleTaskMessages.length;
    for (const activity of recentTaskActivity) {
      const directIndex = activity.messageId ? messageIndexById.get(activity.messageId) : undefined;
      let messageIndex = typeof directIndex === 'number' ? directIndex : Math.max(0, messageCount - 1);
      const activityTime = new Date(activity.timestamp).getTime();
      if (typeof directIndex !== 'number' && Number.isFinite(activityTime)) {
        const nearestIndex = findMessageIndexAtOrAfter(activityTime);
        if (nearestIndex >= 0) {
          messageIndex = nearestIndex;
        }
      }
      addEntry({
        id: `event:${activity.id}`,
        messageIndex,
        preview: activity.title || activity.kind.replace(/_/g, ' '),
        fullText: createConversationMapFullText([activity.title, activity.detail].filter(Boolean).join('\n\n')),
        timestamp: activity.timestamp,
        kind: activity.kind === 'memory_updated' || activity.kind === 'skill_created' || activity.kind === 'skill_updated'
          ? 'note'
          : 'event',
        detail: activity.detail || activity.kind.replace(/_/g, ' '),
      });
    }

    for (const extra of conversationMapExtras) {
      const directIndex = extra.messageId ? messageIndexById.get(extra.messageId) : undefined;
      const messageIndex = typeof directIndex === 'number'
        ? directIndex
        : Math.max(0, messageCount - 1);
      addEntry({
        id: `extra:${extra.id}`,
        messageIndex,
        preview: extra.title,
        fullText: createConversationMapFullText(extra.detail || extra.assetUrl || extra.title),
        timestamp: extra.timestamp,
        kind: extra.kind,
        detail: extra.detail,
        assetLabel: extra.assetLabel || extra.title,
        assetUrl: extra.assetUrl,
        actionLabel: extra.actionLabel,
        pinned: extra.pinned,
      });
    }

    const seenEntryIds = new Set<string>();
    const uniqueEntries: PromptNavigatorEntry[] = [];
    for (const entry of entries) {
      if (seenEntryIds.has(entry.id)) continue;
      seenEntryIds.add(entry.id);
      uniqueEntries.push(entry);
    }

    return uniqueEntries.sort((a, b) => {
        if (a.messageIndex !== b.messageIndex) return a.messageIndex - b.messageIndex;
        const aTime = new Date(a.timestamp || '').getTime();
        const bTime = new Date(b.timestamp || '').getTime();
        return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
      });
  }, [conversationMapExtras, recentTaskActivity, visibleTaskMessages]);
  useEffect(() => {
    if (promptNavigatorEntries.length === 0) {
      setActivePromptNavigatorId(null);
      return;
    }
    setActivePromptNavigatorId((current) => (
      current && promptNavigatorEntries.some((entry) => entry.id === current)
        ? current
        : promptNavigatorEntries[0]?.id ?? null
    ));
  }, [promptNavigatorEntries]);
  const handlePromptNavigatorRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (promptNavigatorEntries.length === 0) return;
    const midpoint = (range.startIndex + range.endIndex) / 2;
    let activeEntry = promptNavigatorEntries[0];
    for (const entry of promptNavigatorEntries) {
      if (entry.messageIndex <= midpoint) {
        activeEntry = entry;
      } else {
        break;
      }
    }
    setActivePromptNavigatorId((current) => current === activeEntry.id ? current : activeEntry.id);
  }, [promptNavigatorEntries]);
  const handlePromptNavigatorJump = useCallback((entry: PromptNavigatorEntry) => {
    setActivePromptNavigatorId(entry.id);
    isNearBottomRef.current = false;
    messagesVirtuosoRef.current?.scrollToIndex({
      index: entry.messageIndex,
      align: 'start',
      behavior: 'smooth',
    });
  }, []);
  const handlePromptNavigatorOpenAsset = useCallback((entry: PromptNavigatorEntry) => {
    const target = entry.assetUrl?.trim();
    if (!target) {
      handlePromptNavigatorJump(entry);
      return;
    }
    const normalizedDocument = normalizeDocumentTarget(target);
    if (normalizedDocument?.kind === 'local' || LOCAL_DOCUMENT_PATH_RE.test(target)) {
      void getAccomplish().openPath(normalizedDocument?.target || target).catch((error) => {
        console.warn('Failed to open conversation map asset:', error);
      });
      return;
    }
    if (normalizedDocument?.kind === 'web' || isHttpUrl(target)) {
      void getAccomplish().openExternal(normalizedDocument?.target || target).catch((error) => {
        console.warn('Failed to open conversation map asset:', error);
      });
      return;
    }
    handlePromptNavigatorJump(entry);
  }, [handlePromptNavigatorJump]);
  const lastVisibleAssistantIndex = useMemo(() => {
    for (let index = visibleTaskMessages.length - 1; index >= 0; index -= 1) {
      if (visibleTaskMessages[index]?.type === 'assistant') return index;
    }
    return -1;
  }, [visibleTaskMessages]);
  const executionSlashCommands = useMemo<SlashCommandDefinition[]>(() => {
    return createAppSlashCommands({
      navigate,
      pathname: location.pathname,
      context: 'chat',
      search: location.search,
      modeSwitchTarget: 'build',
      pluginCommands: pluginSlashCommands,
      taskStop: { visible: currentTask?.status === 'running' },
      taskSaveSkill: { visible: canSaveSkillFromTask },
      subagentsRefresh: { visible: Boolean(currentTask?.id) },
    });
  }, [canSaveSkillFromTask, currentTask?.id, currentTask?.status, location.pathname, location.search, navigate, pluginSlashCommands]);
  const saveSkillOwnerAgentId = String(taskAgentId || activeAgentId || '').trim();
  const saveSkillSelectableAgents = useMemo(
    () => agents.filter((agent) => agent.id !== saveSkillOwnerAgentId),
    [agents, saveSkillOwnerAgentId]
  );

  const handleChatAnswerAvatarVisibilityChange = useCallback((visible: boolean) => {
    setChatAnswerAvatarsVisible(visible);
    setChatAnswerAvatarNoticeVisible(!visible);
    persistChatAnswerAvatarVisible(visible);
    const targetAgentId = String(taskAgentId || activeAgentId || '').trim();
    const targetAgent = useAgentStore.getState().agents.find((agent) => agent.id === targetAgentId);
    if (!targetAgent) return;
    const nextAppearance = {
      ...(targetAgent.appearance || {}),
      showAvatarOnAnswers: visible ? undefined : false,
    };
    const hasAppearance = Object.values(nextAppearance).some((value) => value !== undefined);
    void upsertAgent({
      id: targetAgent.id,
      name: targetAgent.name,
      appearance: hasAppearance ? nextAppearance : null,
    }).catch(() => {
      // Keep the immediate UI response even if persisting the preference fails.
    });
  }, [activeAgentId, taskAgentId, upsertAgent]);

  const toggleSaveSkillShareAgentId = useCallback((agentId: string, checked: boolean) => {
    const normalized = String(agentId || '').trim();
    if (!normalized) return;
    setSaveSkillShareAgentIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(normalized);
      } else {
        next.delete(normalized);
      }
      return Array.from(next);
    });
  }, []);

  useEffect(() => {
    if (!saveSkillOwnerAgentId) return;
    setSaveSkillShareAgentIds((current) => current.filter((agentId) => agentId !== saveSkillOwnerAgentId));
  }, [saveSkillOwnerAgentId]);

  const refreshSubagentRuns = useCallback(async (showLoading = false) => {
    if (!currentTask?.id) {
      setSubagentRuns([]);
      setSubagentTree([]);
      setSubagentRunsLoading(false);
      return;
    }
    if (showLoading) {
      setSubagentRunsLoading(true);
    }
    try {
      const result = await accomplish.listSubagents({ parentTaskId: currentTask.id });
      setSubagentRuns((current) => preserveEquivalentSubagentRunReferences(current, result.runs || []));
      setSubagentTree((current) => preserveEquivalentSubagentTreeReferences(current, result.tree || []));
    } catch (err) {
      console.error('Failed to load subagent runs:', err);
    } finally {
      if (showLoading) {
        setSubagentRunsLoading(false);
      }
    }
  }, [accomplish, currentTask?.id]);

  useEffect(() => {
    const handleTaskStop = () => {
      void interruptTask();
    };
    const handleTaskSaveSkill = () => {
      if (!canSaveSkillFromTask) return;
      setSaveSkillOpen(true);
      setSaveSkillError(null);
    };
    const handleSubagentsRefresh = () => {
      void refreshSubagentRuns(true);
    };

    window.addEventListener(APP_COMMAND_EVENTS.taskStop, handleTaskStop);
    window.addEventListener(APP_COMMAND_EVENTS.taskSaveSkill, handleTaskSaveSkill);
    window.addEventListener(APP_COMMAND_EVENTS.subagentsRefresh, handleSubagentsRefresh);

    return () => {
      window.removeEventListener(APP_COMMAND_EVENTS.taskStop, handleTaskStop);
      window.removeEventListener(APP_COMMAND_EVENTS.taskSaveSkill, handleTaskSaveSkill);
      window.removeEventListener(APP_COMMAND_EVENTS.subagentsRefresh, handleSubagentsRefresh);
    };
  }, [canSaveSkillFromTask, interruptTask, refreshSubagentRuns]);

  useEffect(() => {
    if (!currentTask?.id) {
      setSubagentRuns([]);
      setSubagentTree([]);
      setSubagentPanelMinimized(false);
      return;
    }
    void refreshSubagentRuns(subagentRuns.length === 0);
    const shouldKeepPolling = currentTask.status === 'running'
      || currentTask.status === 'queued'
      || activeSubagentCount > 0;
    if (!shouldKeepPolling) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshSubagentRuns();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeSubagentCount, currentTask?.id, currentTask?.status, refreshSubagentRuns, subagentRuns.length]);

  const stopSubagentRun = useCallback(async (runId: string) => {
    if (!runId) return;
    setStoppingSubagentRunId(runId);
    try {
      await accomplish.stopSubagent({ runId });
      await refreshSubagentRuns();
    } catch (err) {
      console.error('Failed to stop subagent:', err);
    } finally {
      setStoppingSubagentRunId((current) => (current === runId ? null : current));
    }
  }, [accomplish, refreshSubagentRuns]);

  const archiveSubagentRun = useCallback(async (runId: string) => {
    if (!runId) return;
    setSubagentDetailMutating(true);
    try {
      await accomplish.archiveSubagent({ runId, archived: true });
      setSubagentDetailRun((current) => current?.runId === runId ? null : current);
      setSubagentDetailTask((current) => subagentDetailRun?.runId === runId ? null : current);
      setSubagentDetailPrompt((current) => subagentDetailRun?.runId === runId ? '' : current);
      setSubagentDetailModelOverride((current) => subagentDetailRun?.runId === runId ? '' : current);
      await refreshSubagentRuns();
    } catch (err) {
      console.error('Failed to archive subagent:', err);
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, refreshSubagentRuns, subagentDetailRun?.runId]);

  const inspectSubagentRun = useCallback((run: SubagentRunRecord) => {
    const from = `${location.pathname}${location.search}`;
    navigate(`/subagents?runId=${encodeURIComponent(run.runId)}&q=${encodeURIComponent(run.childTaskId)}`, { state: { from } });
  }, [location.pathname, location.search, navigate]);

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
      console.error('Failed to load subagent transcript:', err);
    } finally {
      if (options?.showLoading !== false) {
        setSubagentDetailLoading(false);
      }
    }
  }, [accomplish]);

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

  useEffect(() => {
    if (!subagentDetailRun) {
      setSubagentDetailTask(null);
      setSubagentDetailPrompt('');
      setSubagentDetailModelOverride('');
      setSubagentDetailMessageLimit(SUBAGENT_DETAIL_TRANSCRIPT_INITIAL_LIMIT);
      return;
    }
    setSubagentDetailMessageLimit(SUBAGENT_DETAIL_TRANSCRIPT_INITIAL_LIMIT);
    void loadSubagentDetail(subagentDetailRun, { showLoading: true, replaceRun: false });
    if (!isActiveSubagentRun(subagentDetailRun)) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadSubagentDetail(subagentDetailRun, { showLoading: false, replaceRun: false });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadSubagentDetail, subagentDetailRun?.runId, subagentDetailRun?.status]);

  const sendSubagentFollowUp = useCallback(async () => {
    const prompt = subagentDetailPrompt.trim();
    if (!prompt || !subagentDetailTask) return;
    const selectedOverride = availableSubagentModelOptions.find((entry) => entry.value === subagentDetailModelOverride) || null;
    setSubagentDetailSending(true);
    try {
      await accomplish.sendSubagent({
        runId: subagentDetailRun?.runId || '',
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
      console.error('Failed to send subagent follow-up:', err);
    } finally {
      setSubagentDetailSending(false);
    }
  }, [accomplish, availableSubagentModelOptions, refreshSubagentRuns, subagentDetailModelOverride, subagentDetailPrompt, subagentDetailRun?.runId, subagentDetailTask]);

  const sendSubagentControlPrompt = useCallback(async (run: SubagentRunRecord, prompt: string) => {
    if (!run.runId || !prompt.trim()) return;
    try {
      await accomplish.sendSubagent({ runId: run.runId, prompt });
      await refreshSubagentRuns();
    } catch (err) {
      console.error('Failed to send subagent control prompt:', err);
    }
  }, [accomplish, refreshSubagentRuns]);

  const recoverSubagentRun = useCallback((run: SubagentRunRecord) => {
    const stalledReason = run.supervisor?.stalledReason ? ` Stalled reason: ${run.supervisor.stalledReason}` : '';
    void sendSubagentControlPrompt(
      run,
      `Supervisor recovery request: report your current state, recover from any blocked or stale work, and continue toward the original goal.${stalledReason}`
    );
  }, [sendSubagentControlPrompt]);

  const replaceSubagentRun = useCallback((run: SubagentRunRecord) => {
    void sendSubagentControlPrompt(
      run,
      `Supervisor replacement request: prepare a concise handoff bundle for replacing this run. Include completed work, remaining work, blockers, expected outputs, and any files or commands a replacement run should use.`
    );
  }, [sendSubagentControlPrompt]);

  const archiveSubagentDetail = useCallback(async () => {
    if (!subagentDetailRun) return;
    setSubagentDetailMutating(true);
    try {
      await accomplish.archiveSubagent({ runId: subagentDetailRun.runId, archived: true });
      setSubagentDetailRun(null);
      await refreshSubagentRuns();
    } catch (err) {
      console.error('Failed to archive subagent:', err);
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, refreshSubagentRuns, subagentDetailRun]);

  const closeSubagentDetailSession = useCallback(async () => {
    if (!subagentDetailRun) return;
    setSubagentDetailMutating(true);
    try {
      const updated = await accomplish.closeSubagent({ runId: subagentDetailRun.runId });
      setSubagentDetailRun(updated);
      await loadSubagentDetail(updated);
      await refreshSubagentRuns();
    } catch (err) {
      console.error('Failed to close subagent session:', err);
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, loadSubagentDetail, refreshSubagentRuns, subagentDetailRun]);

  const tryAttachSnapshotFromMessage = useCallback((message?: TaskMessage | null) => {
    if (!message || message.type !== 'tool') return;
    const toolName = message.toolName || '';
    if (!toolName.includes('nodes_camera_snapshot')) return;
    const match = message.content?.match(/Saved to:\s*(.+)$/);
    const filePath = match?.[1]?.trim();
    if (filePath) {
      addAttachedFiles([filePath]);
      const currentTask = useTaskStore.getState().currentTask;
      const initialPrompt = currentTask?.messages.find((msg) => msg.type === 'user')?.content ?? '';
      const shouldAutoFollowUp = /what do you see/i.test(initialPrompt);
      if (currentTask && shouldAutoFollowUp && !autoFollowUpSentRef.current.has(currentTask.id)) {
        autoFollowUpSentRef.current.add(currentTask.id);
        setTimeout(() => {
          const attachmentState = useAttachmentStore.getState();
          const files = attachmentState.files.includes(filePath)
            ? attachmentState.files
            : [...attachmentState.files, filePath];
          void useTaskStore.getState().sendFollowUp(
            'What do you see in the attached snapshot? Give a concise description.',
            files
          );
        }, 0);
      }
    }
  }, [addAttachedFiles]);

  const setMessageScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    messageScrollerRef.current = ref instanceof HTMLElement ? ref : null;
  }, []);

  const getMessageDistanceFromBottom = useCallback((): number | null => {
    const scroller = messageScrollerRef.current;
    if (!scroller) return null;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  }, []);

  const isMessageScrollerNearBottom = useCallback((thresholdPx = 320): boolean => {
    const distance = getMessageDistanceFromBottom();
    return distance === null ? isNearBottomRef.current : distance <= thresholdPx;
  }, [getMessageDistanceFromBottom]);

  const clearPendingBottomScrollTimeouts = useCallback(() => {
    for (const timeoutId of bottomScrollTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    bottomScrollTimeoutsRef.current = [];
  }, []);

  const scrollVirtuosoToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const lastIndex = visibleTaskMessages.length - 1;
    if (lastIndex < 0) return;
    const scrollBehavior = behavior === 'smooth' ? 'smooth' : 'auto';
    messagesVirtuosoRef.current?.scrollToIndex({
      index: lastIndex,
      align: 'end',
      behavior: scrollBehavior,
    });
    messagesVirtuosoRef.current?.scrollTo({
      top: Number.MAX_SAFE_INTEGER,
      behavior: scrollBehavior,
    });
  }, [visibleTaskMessages.length]);

  const scrollToBottomNow = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (bottomScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomScrollFrameRef.current);
      bottomScrollFrameRef.current = null;
    }
    clearPendingBottomScrollTimeouts();
    autoFollowSuppressedUntilRef.current = 0;
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollVirtuosoToBottom(behavior);
    for (const delayMs of [80, 220]) {
      const timeoutId = window.setTimeout(() => {
        bottomScrollTimeoutsRef.current = bottomScrollTimeoutsRef.current.filter((id) => id !== timeoutId);
        if (isNearBottomRef.current && Date.now() >= autoFollowSuppressedUntilRef.current) {
          scrollVirtuosoToBottom('auto');
        }
      }, delayMs);
      bottomScrollTimeoutsRef.current.push(timeoutId);
    }
  }, [clearPendingBottomScrollTimeouts, scrollVirtuosoToBottom]);

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (bottomScrollFrameRef.current !== null) return;
    bottomScrollFrameRef.current = window.requestAnimationFrame(() => {
      bottomScrollFrameRef.current = null;
      scrollToBottomNow(behavior);
    });
  }, [scrollToBottomNow]);

  useEffect(() => () => {
    if (bottomScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomScrollFrameRef.current);
      bottomScrollFrameRef.current = null;
    }
    clearPendingBottomScrollTimeouts();
  }, [clearPendingBottomScrollTimeouts]);

  const suppressAutoFollow = useCallback(() => {
    if (bottomScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomScrollFrameRef.current);
      bottomScrollFrameRef.current = null;
    }
    autoFollowSuppressedUntilRef.current = Date.now() + 2500;
    isNearBottomRef.current = false;
    setShowScrollToBottom(true);
  }, []);

  const isAutoFollowSuppressed = useCallback(() => (
    Date.now() < autoFollowSuppressedUntilRef.current
  ), []);

  const handleMessageWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      suppressAutoFollow();
      return;
    }
    if (event.deltaY > 0 && isMessageScrollerNearBottom(700)) {
      autoFollowSuppressedUntilRef.current = 0;
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      if (currentTask?.status === 'running') {
        scheduleScrollToBottom('auto');
      }
    }
  }, [currentTask?.status, isMessageScrollerNearBottom, scheduleScrollToBottom, suppressAutoFollow]);

  const handleMessageTouchStartCapture = useCallback(() => {
    suppressAutoFollow();
  }, [suppressAutoFollow]);

  const handleMessagesAtBottomChange = useCallback((isAtBottom: boolean) => {
    if (isAtBottom) {
      autoFollowSuppressedUntilRef.current = 0;
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      return;
    }
    if (isAutoFollowSuppressed()) {
      isNearBottomRef.current = false;
      setShowScrollToBottom(true);
      return;
    }
    if (currentTask?.status === 'running') {
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      scheduleScrollToBottom('auto');
      return;
    }
    isNearBottomRef.current = false;
    setShowScrollToBottom(true);
  }, [currentTask?.status, isAutoFollowSuppressed, scheduleScrollToBottom]);

  // Load debug mode setting on mount and subscribe to changes
  useEffect(() => {
    accomplish.getDebugMode().then(setDebugModeEnabled);

    // Subscribe to debug mode changes from settings
    const unsubscribeDebugMode = accomplish.onDebugModeChange?.(({ enabled }) => {
      setDebugModeEnabled(enabled);
    });

    return () => {
      unsubscribeDebugMode?.();
    };
  }, [accomplish]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    void loadUsageProjects(true);
    void loadFolders();
  }, [loadFolders, loadUsageProjects]);

  useEffect(() => {
    let cancelled = false;
    const loadModelState = async () => {
      try {
        const [selectedModelRaw, providersRaw, apiKeysRaw] = await Promise.all([
          accomplish.getSelectedModel(),
          accomplish.listModelProviders(),
          accomplish.getAllApiKeys(),
        ]);
        if (cancelled) return;

        const selectedModelCandidate = selectedModelRaw as
          | (SelectedModel & { id?: string })
          | null
          | undefined;
        const modelValue =
          typeof selectedModelCandidate?.model === 'string'
            ? selectedModelCandidate.model
            : typeof selectedModelCandidate?.id === 'string'
              ? selectedModelCandidate.id
              : '';
        const providerValue =
          typeof selectedModelCandidate?.provider === 'string'
            ? selectedModelCandidate.provider
            : '';

        setGlobalSelectedModel(
          modelValue
            ? {
                provider: providerValue,
                model: modelValue,
                baseUrl:
                  typeof selectedModelCandidate?.baseUrl === 'string'
                    ? selectedModelCandidate.baseUrl
                    : undefined,
              }
            : null
        );
        setModelProviders(Array.isArray(providersRaw) ? (providersRaw as ProviderConfig[]) : []);
        setModelApiKeyStatus(apiKeysRaw ?? {});
      } catch {
        if (cancelled) return;
        setGlobalSelectedModel(null);
        setModelProviders([]);
        setModelApiKeyStatus({});
      }
    };

    void loadModelState();
    return () => {
      cancelled = true;
    };
  }, [accomplish]);

  useEffect(() => {
    const handleSelectedModelChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setGlobalSelectedModel(normalizeSelectedModel(detail));
    };
    window.addEventListener(SELECTED_MODEL_CHANGED_EVENT, handleSelectedModelChanged);
    return () => {
      window.removeEventListener(SELECTED_MODEL_CHANGED_EVENT, handleSelectedModelChanged);
    };
  }, []);

  // Load task and subscribe to events
  useEffect(() => {
    if (id) {
      loadTaskById(id);
      // Clear debug logs when switching tasks
      setDebugLogs([]);
    }

    // Handle individual task updates
    const unsubscribeTask = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
      if (event.type === 'message') {
        tryAttachSnapshotFromMessage(event.message);
      }
      // Track current tool from tool messages
      if (event.type === 'message' && event.message?.type === 'tool') {
        const toolName = event.message.toolName || event.message.content?.match(/Using tool: (\w+)/)?.[1];
        if (toolName) {
          setCurrentTool(toolName);
          setCurrentToolInput(event.message.toolInput);
        }
      }
      // Clear tool on completion
      if (event.type === 'complete' || event.type === 'error') {
        setCurrentTool(null);
        setCurrentToolInput(null);
      }
    });

    // Handle batched task updates (for performance)
    const unsubscribeTaskBatch = accomplish.onTaskUpdateBatch?.((event) => {
      if (event.messages?.length) {
        addTaskUpdateBatch(event);
        event.messages.forEach((message) => {
          tryAttachSnapshotFromMessage(message);
        });
        // Track current tool from the last tool message
        const lastToolMsg = [...event.messages].reverse().find(m => m.type === 'tool');
        if (lastToolMsg) {
          const toolName = lastToolMsg.toolName || lastToolMsg.content?.match(/Using tool: (\w+)/)?.[1];
          if (toolName) {
            setCurrentTool(toolName);
            setCurrentToolInput(lastToolMsg.toolInput);
          }
        }
      }
    });

    const unsubscribeActivity = accomplish.onTaskActivity?.((event) => {
      addTaskActivity(event);
    });

    // Subscribe to task status changes (e.g., queued -> running)
    const unsubscribeStatusChange = accomplish.onTaskStatusChange?.((data) => {
      if (data.taskId === id) {
        updateTaskStatus(data.taskId, data.status);
      }
    });

    // Subscribe to debug logs
    const unsubscribeDebugLog = accomplish.onDebugLog((log) => {
      const entry = log as DebugLogEntry;
      if (entry.taskId === id) {
        setDebugLogs((prev) => [...prev, entry]);
      }
    });

    return () => {
      unsubscribeTask();
      unsubscribeActivity?.();
      unsubscribeTaskBatch?.();
      unsubscribeStatusChange?.();
      unsubscribeDebugLog();
    };
  }, [id, loadTaskById, addTaskUpdate, addTaskActivity, addTaskUpdateBatch, updateTaskStatus, accomplish]);

  // Increment counter when task starts/resumes
  useEffect(() => {
    if (currentTask?.status === 'running') {
      setTaskRunCount((c) => c + 1);
    }
  }, [currentTask?.status]);

  // Auto-scroll to bottom only when opening a task or when new output arrives
  // while the user is already at the bottom. This avoids fighting manual upward scroll.
  useEffect(() => {
    if (!currentTask) return;
    const messageCount = visibleTaskMessages.length;
    const previous = lastAutoScrollRef.current;
    const taskChanged = previous.taskId !== currentTask.id;
    const messageCountIncreased = previous.taskId === currentTask.id && messageCount > previous.messageCount;
    lastAutoScrollRef.current = { taskId: currentTask.id, messageCount };
    if (messageCount <= 0) return;

    if (taskChanged) {
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      scheduleScrollToBottom('auto');
      return;
    }

    if (messageCountIncreased && isNearBottomRef.current && !isAutoFollowSuppressed()) {
      scheduleScrollToBottom('auto');
    }
  }, [currentTask?.id, currentTask?.status, isAutoFollowSuppressed, scheduleScrollToBottom, visibleTaskMessages.length]);

  const lastVisibleMessageSignature = useMemo(() => {
    const lastMessage = visibleTaskMessages[visibleTaskMessages.length - 1];
    if (!lastMessage) return '';
    return [
      lastMessage.id,
      lastMessage.type,
      lastMessage.content?.length ?? 0,
      lastMessage.timestamp,
      currentTask?.status,
    ].join(':');
  }, [currentTask?.status, visibleTaskMessages]);

  useEffect(() => {
    if (!currentTask || !lastVisibleMessageSignature) return;
    if (!isNearBottomRef.current || isAutoFollowSuppressed()) return;
    scheduleScrollToBottom('auto');
  }, [currentTask?.id, isAutoFollowSuppressed, lastVisibleMessageSignature, scheduleScrollToBottom]);

  const runningActivitySignature = useMemo(() => {
    if (currentTask?.status !== 'running') return '';
    const activity = currentTask.activity || [];
    const latestActivity = activity[activity.length - 1];
    return [
      currentTask.id,
      activity.length,
      latestActivity?.id || '',
      latestActivity?.timestamp || '',
      currentTool || '',
    ].join(':');
  }, [currentTask?.activity, currentTask?.id, currentTask?.status, currentTool]);

  useEffect(() => {
    if (!runningActivitySignature) return;
    if (!isNearBottomRef.current || isAutoFollowSuppressed()) return;
    scheduleScrollToBottom('auto');
  }, [isAutoFollowSuppressed, runningActivitySignature, scheduleScrollToBottom]);

  // Auto-scroll debug panel when new logs arrive
  useEffect(() => {
    if (debugPanelOpen && debugPanelRef.current) {
      debugPanelRef.current.scrollTop = debugPanelRef.current.scrollHeight;
    }
  }, [debugLogs.length, debugPanelOpen]);

  // Auto-focus follow-up input when task completes
  const isComplete = ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentTask?.status ?? '');
  const sessionId = currentTask?.result?.sessionId || currentTask?.sessionId;
  const hasSession = typeof sessionId === 'string' && sessionId.startsWith('ses');
  const canInlinePrompt = isComplete || currentTask?.status === 'running';

  const appendLocalTaskMessages = useCallback((taskId: string, newMessages: TaskMessage[]) => {
    if (!taskId || newMessages.length === 0) return;
    useTaskStore.setState((state) => {
      const isCurrentTask = state.currentTask?.id === taskId;
      const appendToTask = (task: typeof state.currentTask | undefined | null) =>
        task
          ? {
              ...task,
              messages: [...task.messages, ...newMessages],
            }
          : task;
      return {
        ...state,
        currentTask: isCurrentTask ? appendToTask(state.currentTask) : state.currentTask,
        tasks: state.tasks.map((task) => (task.id === taskId ? appendToTask(task)! : task)),
      };
    });
  }, []);

  const saveCurrentTaskAsSkill = useCallback(async (params?: {
    explicitSkillId?: string;
    explicitName?: string;
    explicitDescription?: string;
    explicitSkillMd?: string;
    overwrite?: boolean;
    shareScope?: UserSkillSharingScope;
    shareAgentIds?: string[];
    announceInTask?: boolean;
  }): Promise<{ skillId: string; updated: boolean }> => {
    if (!currentTask || !isComplete) {
      throw new Error('Finish the task before saving it as a skill.');
    }

    const explicitSkillId = (params?.explicitSkillId || '').trim();
    const explicitName = (params?.explicitName || '').trim();
    const explicitDescription = (params?.explicitDescription || '').trim();
    const explicitSkillMd = (params?.explicitSkillMd || '').trim();
    const overwrite = Boolean(params?.overwrite);
    const shareScope = (params?.shareScope || 'private') as UserSkillSharingScope;
    const shareAgentIds = Array.from(new Set(
      (params?.shareAgentIds || [])
        .map((agentId) => String(agentId || '').trim())
        .filter(Boolean)
    ));
    const requesterAgentId = String(taskAgentId || activeAgentId || '').trim() || undefined;

    let draft: { skillId?: string; name?: string; description?: string; skillMd?: string } = {};
    if (!explicitSkillMd) {
      const draftResponse = await accomplish.generateUserSkillFromTask({
        taskId: currentTask.id,
        agentId: currentTask.agentId ?? undefined,
      });
      if (!draftResponse.ok || !draftResponse.draft) {
        throw new Error(draftResponse.error || 'Failed to generate skill draft.');
      }
      draft = draftResponse.draft;
    }

    const skillMd = explicitSkillMd || String(draft.skillMd || '').trim();
    if (!skillMd) {
      throw new Error('Generated SKILL.md was empty.');
    }

    const report = await accomplish.listUserSkills(taskAgentId);
    const skills = Array.isArray(report.skills) ? report.skills : [];
    const existingIds = new Set(skills.map((entry: any) => String(entry.id || '').trim()).filter(Boolean));

    const preferredBaseId =
      explicitSkillId
      || String(draft.skillId || '').trim()
      || explicitName
      || String(draft.name || '').trim()
      || String(currentTask.summary || '').trim()
      || String(currentTask.prompt || '').trim();

    let finalSkillId = explicitSkillId
      ? normalizeSkillIdCandidate(explicitSkillId)
      : resolveUniqueSkillId(preferredBaseId, existingIds);

    let existing = skills.find((entry: any) => String(entry.id || '').trim() === finalSkillId) || null;
    if (existing && !explicitSkillId) {
      finalSkillId = resolveUniqueSkillId(finalSkillId, existingIds);
      existing = skills.find((entry: any) => String(entry.id || '').trim() === finalSkillId) || null;
    }

    if (existing && !overwrite) {
      throw new Error('A skill with this ID already exists. Enable overwrite or use a different ID.');
    }
    if (existing && !existing.editable) {
      throw new Error('That skill is not editable (bundled). Choose a different ID.');
    }

    const finalName = explicitName || String(draft.name || '').trim() || finalSkillId;
    const finalDescription = explicitDescription || String(draft.description || '').trim() || undefined;
    const targetSource = existing ? existing.source : 'managed';

    let updated = false;
    if (existing) {
      await accomplish.writeUserSkillFile({
        skillId: existing.id,
        relPath: 'SKILL.md',
        content: skillMd,
        source: existing.source,
        agentId: requesterAgentId,
      });
      updated = true;
    } else {
      await accomplish.createUserSkill({
        skillId: finalSkillId,
        name: finalName || undefined,
        description: finalDescription,
      });
      await accomplish.writeUserSkillFile({
        skillId: finalSkillId,
        relPath: 'SKILL.md',
        content: skillMd,
        source: 'managed',
        agentId: requesterAgentId,
      } as any);
    }

    const sharingResult = await accomplish.setUserSkillSharing({
      skillId: finalSkillId,
      source: targetSource,
      agentId: requesterAgentId,
      scope: shareScope,
      sharedWithAgentIds: shareScope === 'selected' ? shareAgentIds : [],
    });
    if (!sharingResult?.ok) {
      throw new Error(sharingResult?.message || 'Skill saved, but failed to apply sharing settings.');
    }

    if (params?.announceInTask) {
      const sharingLabel =
        shareScope === 'all'
          ? 'Shared with all agents.'
          : shareScope === 'selected'
            ? `Shared with ${shareAgentIds.length} selected agent${shareAgentIds.length === 1 ? '' : 's'}.`
            : 'Private to owner agent.';
      appendLocalTaskMessages(currentTask.id, [
        {
          id: createLocalTaskMessageId(),
          type: 'assistant',
          content: updated
            ? `Skill updated successfully. ID: \`${finalSkillId}\`. ${sharingLabel}`
            : `Skill created successfully. ID: \`${finalSkillId}\`. ${sharingLabel}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    }

    return { skillId: finalSkillId, updated };
  }, [accomplish, activeAgentId, appendLocalTaskMessages, currentTask, isComplete, taskAgentId]);

  // Generate "save as skill" draft on open (only for finished chats).
  useEffect(() => {
    let cancelled = false;
    if (!saveSkillOpen || !currentTask || !isComplete) return;

    setSaveSkillError(null);
    setSaveSkillLoading(true);

    accomplish
      .generateUserSkillFromTask({ taskId: currentTask.id, agentId: currentTask.agentId ?? undefined })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.draft) {
          setSaveSkillError(res.error || 'Failed to generate skill draft.');
          return;
        }
        setSaveSkillId(res.draft.skillId || '');
        setSaveSkillName(res.draft.name || '');
        setSaveSkillDesc(res.draft.description || '');
        setSaveSkillMd(res.draft.skillMd || '');
        setSaveSkillShareScope('private');
        setSaveSkillShareAgentIds([]);
      })
      .catch((err) => {
        if (cancelled) return;
        setSaveSkillError(err instanceof Error ? err.message : 'Failed to generate skill draft.');
      })
      .finally(() => {
        if (cancelled) return;
        setSaveSkillLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accomplish, currentTask, isComplete, saveSkillOpen]);

  const handleSaveAsSkill = useCallback(async () => {
    if (!currentTask) return;
    if (saveSkillShareScope === 'selected' && saveSkillShareAgentIds.length === 0) {
      setSaveSkillError('Select at least one agent to share with, or choose a different sharing scope.');
      return;
    }
    setSaveSkillSaving(true);
    setSaveSkillError(null);
    try {
      const result = await saveCurrentTaskAsSkill({
        explicitSkillId: saveSkillId,
        explicitName: saveSkillName,
        explicitDescription: saveSkillDesc,
        explicitSkillMd: saveSkillMd,
        overwrite: saveSkillOverwrite,
        shareScope: saveSkillShareScope,
        shareAgentIds: saveSkillShareAgentIds,
        announceInTask: true,
      });
      setSaveSkillId(result.skillId);
      setSaveSkillOpen(false);
      setSaveSkillOverwrite(false);
      setSaveSkillShareScope('private');
      setSaveSkillShareAgentIds([]);
    } catch (err) {
      setSaveSkillError(err instanceof Error ? err.message : 'Failed to save skill.');
    } finally {
      setSaveSkillSaving(false);
    }
  }, [currentTask, saveCurrentTaskAsSkill, saveSkillDesc, saveSkillId, saveSkillMd, saveSkillName, saveSkillOverwrite, saveSkillShareAgentIds, saveSkillShareScope]);

  const handleFollowUpSend = useCallback(async (
    message: string,
    files?: string[],
    folder?: string | null,
    mode: 'normal' | 'incognito' = privacyMode,
    usageProjectId?: string | null
  ) => {
    if (!currentTask) return;
    const nextUsageProjectId = usageProjectId !== undefined ? usageProjectId : currentTask.usageProjectId ?? null;
    if (hasSession || currentTask.status === 'interrupted') {
      await sendFollowUp(message, files, nextUsageProjectId);
    } else {
      const task = await startTask({
        prompt: message,
        taskId: currentTask.id,
        workingDirectory: folder ?? undefined,
        attachedFiles: files,
        privacyMode: mode,
        usageProjectId: nextUsageProjectId,
      });
      if (task && task.id !== currentTask.id) {
        navigate(`/execution/${task.id}`);
      }
    }
  }, [currentTask, hasSession, navigate, privacyMode, sendFollowUp, startTask]);

  const handleFollowUpUsageProjectChange = useCallback(async (usageProjectId: string | null) => {
    if (!currentTask?.id) return;
    try {
      await setTaskUsageProject(currentTask.id, usageProjectId);
    } catch (err) {
      console.warn('Failed to save task budget project:', err);
    }
  }, [currentTask?.id, setTaskUsageProject]);

  const handlePlanNextJobs = useCallback(async () => {
    setPlanningJobs(true);
    setProactiveError(null);
    try {
      const plan = await accomplish.planNextJobs(taskAgentId);
      setProactiveSuggestions(Array.isArray(plan?.suggestions) ? plan.suggestions : []);
      setProactiveOpen(true);
    } catch (err) {
      setProactiveSuggestions([]);
      setProactiveError(err instanceof Error ? err.message : String(err));
      setProactiveOpen(true);
    } finally {
      setPlanningJobs(false);
    }
  }, [accomplish, taskAgentId]);

  const handleRunProactiveSuggestion = useCallback(
    async (suggestion: ProactiveSuggestion) => {
      setProactiveOpen(false);
      setProactiveError(null);
      setProactiveSuggestions([]);
      const task = await startTask({ prompt: suggestion.prompt, privacyMode });
      if (task?.id) {
        navigate(`/execution/${task.id}`);
      }
    },
    [startTask, navigate, privacyMode]
  );

  const handleContinue = async () => {
    // Send a simple "continue" message to resume the task
    await sendFollowUp('continue');
  };

  const { savePrompt, prompts, loadPrompts } = useSavedPromptsStore();
  const promptPickerCount = prompts.length + BUILD_RECIPES.length;
  const [promptToSave, setPromptToSave] = useState<string | null>(null);
  const [savePromptTitle, setSavePromptTitle] = useState('');
  const [showSavePromptDialog, setShowSavePromptDialog] = useState(false);
  const [answerSaveDialogOpen, setAnswerSaveDialogOpen] = useState(false);
  const [answerSavePending, setAnswerSavePending] = useState<AnswerSavePending | null>(null);
  const [answerSaveDialogMode, setAnswerSaveDialogMode] = useState<'existing-project' | 'new-project'>('existing-project');
  const [answerSaveTargetProjectId, setAnswerSaveTargetProjectId] = useState('');
  const [answerSaveTargetWorkItemId, setAnswerSaveTargetWorkItemId] = useState('');
  const [answerSaveWorkItems, setAnswerSaveWorkItems] = useState<UsageProjectWorkItem[]>([]);
  const [answerSaveWorkItemsProjectId, setAnswerSaveWorkItemsProjectId] = useState('');
  const [answerSaveWorkItemsLoading, setAnswerSaveWorkItemsLoading] = useState(false);
  const [answerSaveNewProjectName, setAnswerSaveNewProjectName] = useState('');
  const [answerSaveNewWorkItemTitle, setAnswerSaveNewWorkItemTitle] = useState('');
  const [answerSaveTitle, setAnswerSaveTitle] = useState('');
  const [answerSaveSourceDescription, setAnswerSaveSourceDescription] = useState('');
  const [answerSaveRtfAttachToWorkItem, setAnswerSaveRtfAttachToWorkItem] = useState(true);
  const [answerSaveSaving, setAnswerSaveSaving] = useState(false);
  const [answerSaveNotice, setAnswerSaveNotice] = useState<string | null>(null);
  const [answerSaveError, setAnswerSaveError] = useState<string | null>(null);
  const [projectWorkPopupOpen, setProjectWorkPopupOpen] = useState(false);
  const [projectWorkPopupInitialProjectId, setProjectWorkPopupInitialProjectId] = useState<string | null>(null);
  const answerSaveTitleRef = useRef('');
  const answerSaveSourceDescriptionRef = useRef('');
  const answerSaveWorkItemsRequestRef = useRef(0);
  const answerSaveNoticeTimeoutRef = useRef<number | null>(null);
  const [showSavedPromptsSelector, setShowSavedPromptsSelector] = useState(false);
  const [savedPromptsMode, setSavedPromptsMode] = useState<'select' | 'manage'>('select');

  // Load saved prompts on mount
  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const handleSelectSavedPrompt = (content: string) => {
    followUpBarRef.current?.setValue(content);
    followUpBarRef.current?.focus();
  };

  const handleSavePrompt = (content: string) => {
    setPromptToSave(content);
    setSavePromptTitle('');
    setShowSavePromptDialog(true);
  };

  const handleConfirmSavePrompt = () => {
    if (promptToSave && savePromptTitle.trim()) {
      savePrompt(savePromptTitle, promptToSave);
      setShowSavePromptDialog(false);
      setPromptToSave(null);
      setSavePromptTitle('');
    }
  };

  useEffect(() => () => {
    if (answerSaveNoticeTimeoutRef.current !== null) {
      window.clearTimeout(answerSaveNoticeTimeoutRef.current);
    }
  }, []);

  const showAnswerSaveNotice = useCallback((message: string) => {
    setAnswerSaveNotice(message);
    if (answerSaveNoticeTimeoutRef.current !== null) {
      window.clearTimeout(answerSaveNoticeTimeoutRef.current);
    }
    answerSaveNoticeTimeoutRef.current = window.setTimeout(() => {
      setAnswerSaveNotice(null);
      answerSaveNoticeTimeoutRef.current = null;
    }, 5000);
  }, []);

  const getDefaultAnswerSaveProjectId = useCallback(() => {
    const activeProjectIds = new Set(usageProjects.map((project) => project.id));
    const directTaskProjectId = currentTask?.usageProjectId || null;
    if (directTaskProjectId && activeProjectIds.has(directTaskProjectId)) {
      return directTaskProjectId;
    }

    const folderBudgetProjectId = currentTask?.folderId
      ? folders.find((folder) => folder.id === currentTask.folderId)?.usageProjectId || null
      : null;
    if (folderBudgetProjectId && activeProjectIds.has(folderBudgetProjectId)) {
      return folderBudgetProjectId;
    }

    if (selectedChatProjectId && activeProjectIds.has(selectedChatProjectId)) {
      return selectedChatProjectId;
    }

    return usageProjects[0]?.id || '';
  }, [currentTask?.folderId, currentTask?.usageProjectId, folders, selectedChatProjectId, usageProjects]);

  const currentTaskFolder = useMemo(
    () => currentTask?.folderId ? folders.find((folder) => folder.id === currentTask.folderId) || null : null,
    [currentTask?.folderId, folders]
  );

  const getLinkedChatProjectWorkProjectId = useCallback(() => {
    const activeProjectIds = new Set(usageProjects.map((project) => project.id));
    const directTaskProjectId = currentTask?.usageProjectId || null;
    if (directTaskProjectId && activeProjectIds.has(directTaskProjectId)) {
      return directTaskProjectId;
    }

    const folderBudgetProjectId = currentTaskFolder?.usageProjectId || null;
    if (folderBudgetProjectId && activeProjectIds.has(folderBudgetProjectId)) {
      return folderBudgetProjectId;
    }

    return null;
  }, [currentTask?.usageProjectId, currentTaskFolder?.usageProjectId, usageProjects]);

  const chatProjectWorkSourceLabel = useMemo(() => {
    if (currentTaskFolder) return `Chat project: ${currentTaskFolder.name}`;
    const taskTitle = (currentTask?.summary || currentTask?.prompt || '').trim();
    if (taskTitle) return `Chat task: ${taskTitle.slice(0, 80)}`;
    return 'Chat project work';
  }, [currentTask?.prompt, currentTask?.summary, currentTaskFolder]);

  const openChatProjectWorkPopup = useCallback(() => {
    const linkedProjectId = getLinkedChatProjectWorkProjectId();
    setProjectWorkPopupInitialProjectId(linkedProjectId);
    setProjectWorkPopupOpen(true);
    writeChatProjectWorkPopupSession(true, linkedProjectId);
  }, [getLinkedChatProjectWorkProjectId]);

  useEffect(() => {
    if (!currentTask?.id) return;
    const session = readChatProjectWorkPopupSession();
    if (!session.open) return;
    setProjectWorkPopupInitialProjectId(session.projectId || getLinkedChatProjectWorkProjectId());
    setProjectWorkPopupOpen(true);
  }, [currentTask?.id, getLinkedChatProjectWorkProjectId]);

  const loadAnswerSaveWorkItemsForProject = useCallback(async (projectId: string) => {
    const normalizedProjectId = projectId.trim();
    const requestId = answerSaveWorkItemsRequestRef.current + 1;
    answerSaveWorkItemsRequestRef.current = requestId;
    if (!normalizedProjectId) {
      setAnswerSaveWorkItems([]);
      setAnswerSaveWorkItemsProjectId('');
      setAnswerSaveTargetWorkItemId('');
      setAnswerSaveWorkItemsLoading(false);
      return;
    }

    setAnswerSaveWorkItems([]);
    setAnswerSaveWorkItemsProjectId(normalizedProjectId);
    setAnswerSaveTargetWorkItemId('');
    setAnswerSaveWorkItemsLoading(true);
    try {
      const items = await accomplish.listUsageProjectWorkItems({
        projectId: normalizedProjectId,
        includeArchived: true,
      });
      if (answerSaveWorkItemsRequestRef.current !== requestId) return;
      const sortedItems = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setAnswerSaveWorkItems(sortedItems);
      setAnswerSaveTargetWorkItemId((current) => (
        current && sortedItems.some((item) => item.id === current)
          ? current
          : (sortedItems[0]?.id || '__new__')
      ));
    } catch (err) {
      if (answerSaveWorkItemsRequestRef.current !== requestId) return;
      setAnswerSaveWorkItems([]);
      setAnswerSaveWorkItemsProjectId(normalizedProjectId);
      setAnswerSaveTargetWorkItemId('__new__');
      setAnswerSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      if (answerSaveWorkItemsRequestRef.current === requestId) {
        setAnswerSaveWorkItemsLoading(false);
      }
    }
  }, [accomplish]);

  const openAnswerSaveDialog = useCallback(async (
    mode: 'note' | 'rtf',
    payload: { messageId: string; content: string; sourceElement?: HTMLElement | null }
  ) => {
    const trimmed = payload.content.trim();
    if (!trimmed) return;
    const defaultProjectId = getDefaultAnswerSaveProjectId();
    const fallbackProject = usageProjects.find((project) => project.id === defaultProjectId) || usageProjects[0] || null;
    const workItemTitle = (currentTask?.summary || currentTask?.prompt || 'Chat task answer').trim().slice(0, 120);
    const defaultTitle = mode === 'rtf' ? defaultTaskAnswerFileBaseName() : 'Task answer';

    const rtf = mode === 'rtf'
      ? await buildWordFriendlyClipboardRtf(payload.sourceElement || null, trimmed)
      : undefined;

    setAnswerSavePending({
      mode,
      messageId: payload.messageId,
      content: trimmed,
      html: buildWorkItemNoteHtmlFragment(payload.sourceElement || null, trimmed),
      rtf,
    });
    setAnswerSaveError(null);
    answerSaveTitleRef.current = defaultTitle;
    answerSaveSourceDescriptionRef.current = '';
    setAnswerSaveTitle(defaultTitle);
    setAnswerSaveSourceDescription('');
    setAnswerSaveDialogMode(fallbackProject ? 'existing-project' : 'new-project');
    setAnswerSaveTargetProjectId(fallbackProject?.id || '');
    setAnswerSaveTargetWorkItemId('');
    setAnswerSaveWorkItems([]);
    setAnswerSaveWorkItemsProjectId(fallbackProject?.id || '');
    setAnswerSaveNewProjectName(
      currentTask?.summary
        ? `${currentTask.summary} budget`
        : currentTask?.prompt
          ? `${currentTask.prompt.slice(0, 64)} budget`
          : 'Chat budget project'
    );
    setAnswerSaveNewWorkItemTitle(workItemTitle || 'Chat task answer');
    setAnswerSaveRtfAttachToWorkItem(true);
    setAnswerSaveDialogOpen(true);
    if (fallbackProject?.id) void loadAnswerSaveWorkItemsForProject(fallbackProject.id);
  }, [
    currentTask?.prompt,
    currentTask?.summary,
    getDefaultAnswerSaveProjectId,
    loadAnswerSaveWorkItemsForProject,
    usageProjects,
  ]);

  const handleSaveAnswerAsProjectNote = useCallback((payload: { messageId: string; content: string; sourceElement?: HTMLElement | null }) => {
    void openAnswerSaveDialog('note', payload);
  }, [openAnswerSaveDialog]);

  const handleSaveAnswerAsRtf = useCallback((payload: { messageId: string; content: string; sourceElement?: HTMLElement | null }) => {
    void openAnswerSaveDialog('rtf', payload);
  }, [openAnswerSaveDialog]);

  const openFileLinkSaveDialog = useCallback((payload: {
    messageId: string;
    filePath: string;
    label: string;
    content?: string;
    kind?: UsageProjectWorkItemDocumentLink['kind'];
  }) => {
    const target = payload.filePath.trim();
    if (!target) return;
    const defaultProjectId = getDefaultAnswerSaveProjectId();
    const fallbackProject = usageProjects.find((project) => project.id === defaultProjectId) || usageProjects[0] || null;
    const workItemTitle = (currentTask?.summary || currentTask?.prompt || 'Chat task asset').trim().slice(0, 120);
    const label = payload.label.trim() || target.split(/[\\/]/).filter(Boolean).pop() || 'Chat asset';

    setAnswerSavePending({
      mode: 'file-link',
      messageId: payload.messageId,
      content: payload.content?.trim() || label,
      filePath: target,
      fileLabel: label,
      fileKind: payload.kind || (isHttpUrl(target) ? 'url' : 'local'),
    });
    setAnswerSaveError(null);
    answerSaveTitleRef.current = label;
    answerSaveSourceDescriptionRef.current = '';
    setAnswerSaveTitle(label);
    setAnswerSaveSourceDescription('');
    setAnswerSaveDialogMode(fallbackProject ? 'existing-project' : 'new-project');
    setAnswerSaveTargetProjectId(fallbackProject?.id || '');
    setAnswerSaveTargetWorkItemId('');
    setAnswerSaveWorkItems([]);
    setAnswerSaveWorkItemsProjectId(fallbackProject?.id || '');
    setAnswerSaveNewProjectName(
      currentTask?.summary
        ? `${currentTask.summary} budget`
        : currentTask?.prompt
          ? `${currentTask.prompt.slice(0, 64)} budget`
          : 'Chat budget project'
    );
    setAnswerSaveNewWorkItemTitle(workItemTitle || 'Chat task asset');
    setAnswerSaveRtfAttachToWorkItem(true);
    setAnswerSaveDialogOpen(true);
    if (fallbackProject?.id) void loadAnswerSaveWorkItemsForProject(fallbackProject.id);
  }, [
    currentTask?.prompt,
    currentTask?.summary,
    getDefaultAnswerSaveProjectId,
    loadAnswerSaveWorkItemsForProject,
    usageProjects,
  ]);

  const handleAttachAssetToWorkboard = useCallback((payload: { messageId: string; target: string; label: string; kind?: 'web' | 'local' }) => {
    openFileLinkSaveDialog({
      messageId: payload.messageId,
      filePath: payload.target,
      label: payload.label,
      content: payload.target,
      kind: payload.kind === 'web' || isHttpUrl(payload.target) ? 'url' : 'local',
    });
  }, [openFileLinkSaveDialog]);

  const openSourceLinkSaveDialog = useCallback((payload: {
    messageId: string;
    url: string;
    title: string;
    description?: string;
  }) => {
    const url = payload.url.trim();
    if (!/^https?:\/\//i.test(url)) return;
    const title = payload.title.trim() || url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || 'Source';
    const defaultProjectId = getDefaultAnswerSaveProjectId();
    const fallbackProject = usageProjects.find((project) => project.id === defaultProjectId) || usageProjects[0] || null;
    const workItemTitle = (currentTask?.summary || currentTask?.prompt || 'Chat task source').trim().slice(0, 120);
    const description = payload.description?.trim() || `Source saved from chat answer: ${title}`;

    setAnswerSavePending({
      mode: 'source-link',
      messageId: payload.messageId,
      content: description,
      sourceUrl: url,
      sourceTitle: title,
      sourceDescription: description,
    });
    setAnswerSaveError(null);
    answerSaveTitleRef.current = title;
    answerSaveSourceDescriptionRef.current = description;
    setAnswerSaveTitle(title);
    setAnswerSaveSourceDescription(description);
    setAnswerSaveDialogMode(fallbackProject ? 'existing-project' : 'new-project');
    setAnswerSaveTargetProjectId(fallbackProject?.id || '');
    setAnswerSaveTargetWorkItemId('');
    setAnswerSaveWorkItems([]);
    setAnswerSaveWorkItemsProjectId(fallbackProject?.id || '');
    setAnswerSaveNewProjectName(
      currentTask?.summary
        ? `${currentTask.summary} budget`
        : currentTask?.prompt
          ? `${currentTask.prompt.slice(0, 64)} budget`
          : 'Chat budget project'
    );
    setAnswerSaveNewWorkItemTitle(workItemTitle || 'Chat task source');
    setAnswerSaveRtfAttachToWorkItem(true);
    setAnswerSaveDialogOpen(true);
    if (fallbackProject?.id) void loadAnswerSaveWorkItemsForProject(fallbackProject.id);
  }, [
    currentTask?.prompt,
    currentTask?.summary,
    getDefaultAnswerSaveProjectId,
    loadAnswerSaveWorkItemsForProject,
    usageProjects,
  ]);

  const handleSaveAssetAsProjectNote = useCallback((payload: { messageId: string; target: string; label: string }) => {
    const target = payload.target.trim();
    const label = payload.label.trim() || target;
    openAnswerSaveDialog('note', {
      messageId: payload.messageId,
      content: `Saved asset: [${label}](${target})`,
    });
  }, [openAnswerSaveDialog]);

  const getLatestAssistantMessageForAction = useCallback(() => {
    for (let index = visibleTaskMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleTaskMessages[index];
      if (message?.type === 'assistant') return message;
    }
    return null;
  }, [visibleTaskMessages]);

  const savePendingAnswer = useCallback(async () => {
    if (!answerSavePending || !currentTask) return;
    setAnswerSaveSaving(true);
    setAnswerSaveError(null);
    try {
      let savedRtfPath: string | null = null;
      let savedRtfLabel = '';
      if (answerSavePending.mode === 'rtf') {
        if (!answerSavePending.rtf) throw new Error('RTF content was not available.');
        const fileTitle = sanitizeSuggestedFileBaseName(answerSaveTitleRef.current, defaultTaskAnswerFileBaseName());
        const saved = await accomplish.saveTextToFileAs(answerSavePending.rtf, {
          baseName: fileTitle,
          extension: 'rtf',
          title: 'Save answer as Rich Text File',
        });
        if (saved.cancelled || !saved.filePath) {
          showAnswerSaveNotice('RTF export cancelled.');
          return;
        }
        savedRtfPath = saved.filePath;
        savedRtfLabel = fileTitle;
        if (!answerSaveRtfAttachToWorkItem) {
          showAnswerSaveNotice(`Saved RTF: ${saved.filePath}`);
          setAnswerSaveDialogOpen(false);
          return;
        }
      }

      let project: UsageProject | null = null;
      if (answerSaveDialogMode === 'new-project') {
        const created = await createUsageProject({
          name: answerSaveNewProjectName.trim() || 'Chat budget project',
          color: '#2dd4bf',
          trackingEnabled: true,
        });
        if (!created) throw new Error('Unable to create project.');
        project = created;
        setAnswerSaveTargetProjectId(created.id);
      } else {
        project = usageProjects.find((entry) => entry.id === answerSaveTargetProjectId) || null;
      }
      if (!project) throw new Error('Choose a project before saving.');

      let workItem: UsageProjectWorkItem | null = null;
      if (answerSaveTargetWorkItemId && answerSaveTargetWorkItemId !== '__new__') {
        const cachedItems = answerSaveWorkItemsProjectId === project.id ? answerSaveWorkItems : [];
        workItem = cachedItems.find((item) => item.id === answerSaveTargetWorkItemId) || null;
        if (!workItem) {
          const items = await accomplish.listUsageProjectWorkItems({ projectId: project.id, includeArchived: true });
          workItem = items.find((item) => item.id === answerSaveTargetWorkItemId) || null;
        }
      }

      if (answerSavePending.mode === 'source-link') {
        const sourceUrl = answerSavePending.sourceUrl?.trim();
        if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
          throw new Error('Source link must start with http:// or https://.');
        }
        const sourceLink: UsageProjectWorkItemSourceLink = {
          id: `source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: answerSaveTitleRef.current.trim() || answerSavePending.sourceTitle || 'Source',
          url: sourceUrl,
          description: answerSaveSourceDescriptionRef.current.trim() || answerSavePending.sourceDescription || undefined,
          createdAt: new Date().toISOString(),
        };
        if (!workItem) {
          workItem = await accomplish.createUsageProjectWorkItem({
            usageProjectId: project.id,
            title: answerSaveNewWorkItemTitle.trim() || 'Chat task source',
            sourceType: 'chat_task',
            sourceId: currentTask.id,
            sources: [sourceLink],
          });
        } else {
          workItem = await accomplish.updateUsageProjectWorkItem(workItem.id, {
            sources: [sourceLink, ...(workItem.sources || [])],
          });
        }
        showAnswerSaveNotice(`Saved source "${sourceLink.title}" to "${workItem.title}" in "${project.name}".`);
        addConversationMapExtra({
          id: `event:${sourceLink.id}`,
          messageId: answerSavePending.messageId,
          kind: 'event',
          title: `Source saved: ${sourceLink.title}`,
          detail: `Saved to ${workItem.title} in ${project.name}`,
          assetUrl: sourceLink.url,
          actionLabel: 'Open',
        });
      } else if (answerSavePending.mode === 'note') {
        const note: UsageProjectWorkItemNote = {
          id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: answerSaveTitleRef.current.trim() || undefined,
          text: answerSavePending.content,
          html: answerSavePending.html,
          createdAt: new Date().toISOString(),
        };
        if (!workItem) {
          workItem = await accomplish.createUsageProjectWorkItem({
            usageProjectId: project.id,
            title: answerSaveNewWorkItemTitle.trim() || 'Chat task answer',
            sourceType: 'chat_task',
            sourceId: currentTask.id,
            notes: [note],
          });
        } else {
          workItem = await accomplish.updateUsageProjectWorkItem(workItem.id, {
            notes: [note, ...(workItem.notes || [])],
          });
        }
        showAnswerSaveNotice(`Saved answer note to "${workItem.title}" in "${project.name}".`);
        addConversationMapExtra({
          id: `note:${note.id}`,
          messageId: answerSavePending.messageId,
          kind: 'note',
          title: note.title || 'Saved note',
          detail: `Saved to ${workItem.title} in ${project.name}`,
          actionLabel: 'Jump',
        });
      } else {
        const documentTarget = answerSavePending.mode === 'file-link'
          ? answerSavePending.filePath
          : savedRtfPath;
        if (!documentTarget) throw new Error('File was not saved.');
        const documentKind = answerSavePending.mode === 'file-link'
          ? (answerSavePending.fileKind || (isHttpUrl(documentTarget) ? 'url' : 'local'))
          : 'local';
        const documentLink: UsageProjectWorkItemDocumentLink = {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          label: answerSavePending.mode === 'file-link'
            ? (answerSavePending.fileLabel || answerSaveTitleRef.current.trim() || 'Chat asset')
            : savedRtfLabel,
          kind: documentKind,
          path: documentKind === 'local' ? documentTarget : undefined,
          url: documentKind === 'url' ? documentTarget : undefined,
          createdAt: new Date().toISOString(),
        };
        if (!workItem) {
          workItem = await accomplish.createUsageProjectWorkItem({
            usageProjectId: project.id,
            title: answerSaveNewWorkItemTitle.trim() || 'Chat task answer',
            sourceType: 'chat_task',
            sourceId: currentTask.id,
            documents: [documentLink],
          });
        } else {
          workItem = await accomplish.updateUsageProjectWorkItem(workItem.id, {
            documents: [documentLink, ...(workItem.documents || [])],
          });
        }
        showAnswerSaveNotice(
          answerSavePending.mode === 'file-link'
            ? `Attached "${documentLink.label}" to "${workItem.title}" in "${project.name}".`
            : `Saved RTF and attached it to "${workItem.title}" in "${project.name}".`
        );
        addConversationMapExtra({
          id: `${documentLink.kind === 'local' && documentLink.path?.toLowerCase().endsWith('.png') ? 'postcard' : 'file'}:${documentLink.id}`,
          messageId: answerSavePending.messageId,
          kind: documentLink.kind === 'local' && documentLink.path?.toLowerCase().endsWith('.png') ? 'postcard' : 'file',
          title: documentLink.label || 'Attached file',
          detail: `Attached to ${workItem.title} in ${project.name}`,
          assetUrl: documentLink.path || documentLink.url,
          assetLabel: documentLink.label,
          actionLabel: 'Open',
        });
      }

      setAnswerSaveDialogOpen(false);
      setAnswerSavePending(null);
      setAnswerSaveWorkItems([]);
      setAnswerSaveWorkItemsProjectId('');
      setAnswerSaveTargetWorkItemId('');
      await loadUsageProjects(true);
    } catch (err) {
      setAnswerSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnswerSaveSaving(false);
    }
  }, [
    accomplish,
    addConversationMapExtra,
    answerSaveDialogMode,
    answerSaveNewProjectName,
    answerSaveNewWorkItemTitle,
    answerSavePending,
    answerSaveRtfAttachToWorkItem,
    answerSaveTargetProjectId,
    answerSaveTargetWorkItemId,
    answerSaveWorkItems,
    answerSaveWorkItemsProjectId,
    createUsageProject,
    currentTask,
    loadUsageProjects,
    showAnswerSaveNotice,
    usageProjects,
  ]);

  const handleExportDebugLogs = useCallback(() => {
    const text = debugLogs
      .map((log) => {
        const dataStr = log.data !== undefined
          ? ` ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}`
          : '';
        return `${new Date(log.timestamp).toISOString()} [${log.type}] ${log.message}${dataStr}`;
      })
      .join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${id}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setDebugExported(true);
    setTimeout(() => setDebugExported(false), 2000);
  }, [debugLogs, id]);

  const topBarTaskAgentName =
    agents.find((agent) => agent.id === taskAgentId)?.name || taskAgentId;
  const topBarTaskAgent = agents.find((agent) => agent.id === taskAgentId);
  const topBarEffectiveSelectedModel = topBarTaskAgent?.selectedModel ?? globalSelectedModel;
  const topBarModelBadgeLabel = formatExecutionModelBadgeLabel(topBarEffectiveSelectedModel, modelProviders);
  const activeThemeProjectId = currentTask?.usageProjectId
    || (currentTask?.folderId ? folders.find((folder) => folder.id === currentTask.folderId)?.usageProjectId : null)
    || selectedChatProjectId
    || null;
  const activeThemeProject = activeThemeProjectId
    ? usageProjects.find((project) => project.id === activeThemeProjectId) || null
    : null;
  useEffect(() => {
    setPendingAgentChatBackgroundId(null);
    setPendingAgentAppearance({});
  }, [
    topBarTaskAgent?.id,
    topBarTaskAgent?.appearance?.accentColor,
    topBarTaskAgent?.appearance?.answerStyle,
    topBarTaskAgent?.appearance?.avatarFrame,
    topBarTaskAgent?.appearance?.chatBackgroundId,
    topBarTaskAgent?.appearance?.presenceAnimation,
    topBarTaskAgent?.appearance?.reactionMode,
    topBarTaskAgent?.appearance?.showAvatarOnAnswers,
  ]);

  const agentChatBackgroundId = normalizeChatBackgroundId(
    pendingAgentChatBackgroundId
    ?? topBarTaskAgent?.appearance?.chatBackgroundId
    ?? DEFAULT_CHAT_BACKGROUND_ID
  );
  const effectiveAgentAppearance = useMemo<AgentAppearance>(() => ({
    ...(topBarTaskAgent?.appearance || {}),
    ...pendingAgentAppearance,
  }), [pendingAgentAppearance, topBarTaskAgent?.appearance]);
  const agentReactionMode: AgentReactionMode = effectiveAgentAppearance.reactionMode || 'minimal';
  const handleUpdateAgentAppearance = useCallback((patch: Partial<AgentAppearance>) => {
    const normalizedPatch: Partial<AgentAppearance> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'chatBackgroundId')) {
      const normalized = normalizeChatBackgroundId(patch.chatBackgroundId);
      setPendingAgentChatBackgroundId(normalized);
      normalizedPatch.chatBackgroundId = normalized === DEFAULT_CHAT_BACKGROUND_ID ? undefined : normalized;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'showAvatarOnAnswers')) {
      setChatAnswerAvatarsVisible(patch.showAvatarOnAnswers !== false);
    }
    setPendingAgentAppearance((prev) => ({ ...prev, ...normalizedPatch }));
    const targetAgentId = String(taskAgentId || activeAgentId || '').trim();
    const targetAgent = useAgentStore.getState().agents.find((agent) => agent.id === targetAgentId);
    if (!targetAgent) return;

    const nextAppearance = {
      ...(targetAgent.appearance || {}),
      ...normalizedPatch,
    };
    const hasAppearance = Object.values(nextAppearance).some((value) => value !== undefined);
    void upsertAgent({
      id: targetAgent.id,
      name: targetAgent.name,
      appearance: hasAppearance ? nextAppearance : null,
    }).catch(() => {
      setPendingAgentChatBackgroundId(null);
      setPendingAgentAppearance({});
    });
  }, [activeAgentId, taskAgentId, upsertAgent]);
  const handleSelectAgentChatBackground = useCallback((id: string) => {
    handleUpdateAgentAppearance({ chatBackgroundId: id });
  }, [handleUpdateAgentAppearance]);

  const effectiveChatBackground = getChatBackground(agentChatBackgroundId);
  const effectiveChatBackgroundStyle = useMemo<CSSProperties>(() => {
    if (!effectiveChatBackground) return {};
    return {
      backgroundImage: `linear-gradient(135deg, hsl(var(--background) / 0.22), hsl(var(--background) / 0.38)), url("${effectiveChatBackground.src}")`,
      backgroundPosition: 'center',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
    };
  }, [effectiveChatBackground]);
  const activeChatAccentColor = activeThemeProject?.chatTheme?.accentColor
    || topBarTaskAgent?.appearance?.accentColor
    || topBarTaskAgent?.avatarColor
    || 'hsl(var(--primary))';
  const effectiveThinkingIndicatorStyle = useMemo<CSSProperties | undefined>(() => {
    if (!effectiveChatBackground) return undefined;
    return {
      color: effectiveChatBackground.thinkingIndicator.color,
      textShadow: effectiveChatBackground.thinkingIndicator.textShadow,
    };
  }, [effectiveChatBackground]);
  const agentPresence = useMemo(
    () => getAgentPresence(currentTool, currentToolInput, currentTask?.status, Boolean(permissionRequest)),
    [currentTask?.status, currentTool, currentToolInput, permissionRequest]
  );
  const agentToolActivitySteps = useMemo(
    () => getToolActivityStepsFromActivity(
      recentTaskActivity,
      currentTool ? { toolName: currentTool, toolInput: currentToolInput } : null
    ),
    [currentTool, currentToolInput, recentTaskActivity]
  );
  const recentTaskActivityByMessageId = useMemo(() => {
    const map = new Map<string, typeof recentTaskActivity>();
    for (const activity of recentTaskActivity) {
      if (!activity.messageId) continue;
      const current = map.get(activity.messageId) || [];
      current.push(activity);
      map.set(activity.messageId, current);
    }
    return map;
  }, [recentTaskActivity]);
  const recentUnscopedTerminalActivities = useMemo(
    () => recentTaskActivity.filter((activity) => (
      !activity.messageId && ['memory_updated', 'skill_created', 'skill_updated', 'task_finished'].includes(activity.kind)
    )),
    [recentTaskActivity]
  );

  const getAssistantMessageReactions = useCallback((message: TaskMessage, isLastAssistantMessage: boolean): AssistantReaction[] => {
    if (message.type !== 'assistant' || agentReactionMode === 'off') return [];
    const answerContent = getAssistantAnswerContent(message.content);
    const previews = extractAssistantLinkPreviews(answerContent || message.content);
    const reactions: AssistantReaction[] = [];

    if (previews.siteLinks.length > 0) {
      reactions.push({ id: 'sources-found', label: 'Sources found', tone: 'info' });
    }
    if (previews.imageLinks.length > 0) {
      reactions.push({ id: 'images-found', label: 'Images found', tone: 'info' });
    }
    if (previews.documentLinks.length > 0) {
      reactions.push({ id: 'files-linked', label: 'Files linked', tone: 'info' });
    }

    const relatedActivity = [
      ...(recentTaskActivityByMessageId.get(message.id) || []),
      ...(isLastAssistantMessage ? recentUnscopedTerminalActivities : []),
    ];
    if (relatedActivity.some((activity) => activity.kind === 'memory_updated')) {
      reactions.push({ id: 'memory-updated', label: 'Memory updated', tone: 'success' });
    }
    if (relatedActivity.some((activity) => activity.kind === 'skill_created' || activity.kind === 'skill_updated')) {
      reactions.push({ id: 'skill-learned', label: 'Skill learned', tone: 'success' });
    }
    if (isLastAssistantMessage && currentTask?.status === 'completed') {
      reactions.push({ id: 'done', label: 'Done', tone: 'success' });
    }
    if (isLastAssistantMessage && currentTask?.status === 'failed') {
      reactions.push({ id: 'needs-attention', label: 'Needs attention', tone: 'warning' });
    }

    const unique = reactions.filter((reaction, index, list) => list.findIndex((item) => item.id === reaction.id) === index);
    if (agentReactionMode === 'minimal') return unique.slice(0, 2);
    if (agentReactionMode === 'standard') return unique.slice(0, 4);
    return unique;
  }, [agentReactionMode, currentTask?.status, recentTaskActivityByMessageId, recentUnscopedTerminalActivities]);

  const pinnedDecisionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of conversationMapExtras) {
      if (entry.kind === 'decision') ids.add(entry.id);
    }
    return ids;
  }, [conversationMapExtras]);

  const savedNoteAssetsByMessageId = useMemo(() => {
    const map = new Map<string, SavedNoteAsset[]>();
    for (const entry of conversationMapExtras) {
      if (entry.kind !== 'note' || !entry.messageId) continue;
      const current = map.get(entry.messageId) || [];
      current.push({
        id: entry.id,
        title: entry.title,
        detail: entry.detail,
        timestamp: entry.timestamp,
      });
      map.set(entry.messageId, current);
    }
    return map;
  }, [conversationMapExtras]);

  const isDecisionPinned = useCallback((messageId: string) => (
    pinnedDecisionIds.has(`decision:${messageId}`)
  ), [pinnedDecisionIds]);

  const getSavedNoteAssetsForMessage = useCallback((messageId: string): SavedNoteAsset[] => (
    savedNoteAssetsByMessageId.get(messageId) || EMPTY_SAVED_NOTE_ASSETS
  ), [savedNoteAssetsByMessageId]);

  const toggleDecisionPin = useCallback((payload: { messageId: string; content: string }) => {
    const entryId = `decision:${payload.messageId}`;
    if (conversationMapExtras.some((entry) => entry.id === entryId)) {
      removeConversationMapExtra(entryId);
      showAnswerSaveNotice('Decision removed from the Conversation map.');
      return;
    }
    const content = getAssistantAnswerContent(payload.content) || payload.content;
    addConversationMapExtra({
      id: entryId,
      messageId: payload.messageId,
      kind: 'decision',
      title: createPromptPreview(content),
      detail: content.slice(0, 480),
      actionLabel: 'Jump',
      pinned: true,
    });
    showAnswerSaveNotice('Decision pinned to the Conversation map.');
  }, [addConversationMapExtra, conversationMapExtras, removeConversationMapExtra, showAnswerSaveNotice]);

  const openAnswerPostcard = useCallback(async (payload: { messageId: string; content: string; sourceElement?: HTMLElement | null }) => {
    if (postcardGenerating) return;
    const sources = extractAssistantLinkPreviews(payload.content).siteLinks.map((site) => site.url);
    const template = sources.length > 0 ? 'research-card' : 'clean-summary';
    setPostcardTemplate(template);
    setPostcardError(null);
    setPostcardGenerating(true);
    showAnswerSaveNotice('Creating postcard...');
    const result = await getAccomplish().generateChatPostcardDraft({
      agentId: taskAgentId || activeAgentId,
      source: 'answer',
      templateId: template,
      content: payload.content,
      sources,
      agentName: topBarTaskAgentName || 'Agent',
      agentRole: topBarTaskAgent?.roleName,
      projectName: activeThemeProject?.name,
    }).catch((error) => ({
      ok: false as const,
      title: '',
      summary: '',
      highlights: [],
      error: error instanceof Error ? error.message : 'Postcard generation failed.',
    }));
    setPostcardGenerating(false);
    if (!result.ok) {
      const reason = result.error || 'The assistant could not create a postcard draft.';
      setPostcardError(reason);
      showAnswerSaveNotice(`Could not create postcard: ${reason}`);
      return;
    }
    setPostcardDraft({
      source: 'answer',
      messageId: payload.messageId,
      title: cleanPostcardTitleText(result.title),
      content: payload.content,
      summary: result.summary.trim(),
      highlights: result.highlights.map((highlight) => highlight.trim()).filter(Boolean),
      agentName: topBarTaskAgentName || 'Agent',
      agentRole: topBarTaskAgent?.roleName,
      projectName: activeThemeProject?.name,
      sources,
      createdAt: new Date().toISOString(),
    });
  }, [activeAgentId, activeThemeProject?.name, postcardGenerating, showAnswerSaveNotice, taskAgentId, topBarTaskAgent?.roleName, topBarTaskAgentName]);

  const openConversationPostcard = useCallback(async () => {
    if (!currentTask || postcardGenerating) return;
    const assistantAnswers = currentTask.messages
      .filter((message) => message.type === 'assistant')
      .map((message) => getAssistantAnswerContent(message.content))
      .filter((content) => content.trim().length > 0);
    const content = assistantAnswers.slice(-3).join('\n\n') || currentTask.prompt;
    const sources = currentTask.messages
      .flatMap((message) => message.type === 'assistant' ? extractAssistantLinkPreviews(message.content).siteLinks.map((site) => site.url) : [])
      .filter((url, index, list) => list.indexOf(url) === index)
      .slice(0, 6);
    const template = sources.length > 0 ? 'research-card' : 'clean-summary';
    setPostcardTemplate(template);
    setPostcardError(null);
    setPostcardGenerating(true);
    showAnswerSaveNotice('Creating conversation postcard...');
    const result = await getAccomplish().generateChatPostcardDraft({
      agentId: taskAgentId || activeAgentId,
      source: 'conversation',
      templateId: template,
      titleHint: currentTask.summary || currentTask.prompt,
      content,
      sources,
      agentName: topBarTaskAgentName || 'Agent',
      agentRole: topBarTaskAgent?.roleName,
      projectName: activeThemeProject?.name,
    }).catch((error) => ({
      ok: false as const,
      title: '',
      summary: '',
      highlights: [],
      error: error instanceof Error ? error.message : 'Postcard generation failed.',
    }));
    setPostcardGenerating(false);
    if (!result.ok) {
      const reason = result.error || 'The assistant could not create a postcard draft.';
      setPostcardError(reason);
      showAnswerSaveNotice(`Could not create postcard: ${reason}`);
      return;
    }
    setPostcardDraft({
      source: 'conversation',
      title: cleanPostcardTitleText(result.title),
      content,
      summary: result.summary.trim(),
      highlights: result.highlights.map((highlight) => highlight.trim()).filter(Boolean),
      agentName: topBarTaskAgentName || 'Agent',
      agentRole: topBarTaskAgent?.roleName,
      projectName: activeThemeProject?.name,
      sources,
      createdAt: new Date().toISOString(),
    });
  }, [activeAgentId, activeThemeProject?.name, currentTask, postcardGenerating, showAnswerSaveNotice, taskAgentId, topBarTaskAgent?.roleName, topBarTaskAgentName]);

  const postcardDialogDraft = useMemo(() => (
    postcardDraft ? toPostcardDialogDraft(postcardDraft, postcardTemplate) : undefined
  ), [postcardDraft, postcardTemplate]);

  const handlePostcardDialogDraftChange = useCallback((draft: ChatPostcardDialogDraft) => {
    setPostcardTemplate(draft.templateId as ChatPostcardTemplate);
    setPostcardDraft((current) => current
      ? {
          ...current,
          title: draft.title,
          summary: draft.summary,
          highlights: draft.highlights,
        }
      : current);
  }, []);

  const savePostcardPng = useCallback(async (payload?: ChatPostcardActionPayload) => {
    if (!postcardDraft) return;
    setPostcardSaving(true);
    setPostcardError(null);
    try {
      const dataUrl =
        (await capturePostcardPreviewDataUrl(payload?.element)) ||
        createPostcardPngDataUrl(postcardDraft, postcardTemplate, activeChatAccentColor);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const result = await getAccomplish().saveDataUrlToFileAs(dataUrl, `chat-postcard-${timestamp}`);
      if (!result.cancelled && result.filePath) {
        const fileName = result.filePath.split(/[\\/]/).pop() || 'chat postcard.png';
        const savedTitle = createPostcardTitleFromContent(postcardDraft.title || postcardDraft.content, fileName);
        showAnswerSaveNotice(`Postcard saved: ${fileName}`);
        addConversationMapExtra({
          id: `postcard:${result.filePath}:${Date.now()}`,
          messageId: postcardDraft.messageId,
          kind: 'postcard',
          title: savedTitle,
          detail: postcardDraft.source === 'conversation' ? 'Conversation postcard exported' : 'Answer postcard exported',
          assetUrl: result.filePath,
          assetLabel: fileName,
          actionLabel: 'Open',
        });
        return result.filePath;
      }
      return null;
    } catch (error) {
      setPostcardError(error instanceof Error ? error.message : 'Failed to export postcard.');
      return null;
    } finally {
      setPostcardSaving(false);
    }
  }, [activeChatAccentColor, addConversationMapExtra, postcardDraft, postcardTemplate, showAnswerSaveNotice]);

  const exportPostcard = useCallback(async (payload?: ChatPostcardActionPayload) => {
    const savedPath = await savePostcardPng(payload);
    if (savedPath) {
      setPostcardDraft(null);
    }
  }, [savePostcardPng]);

  const exportPostcardAndAttach = useCallback(async (payload?: ChatPostcardActionPayload) => {
    const sourceDraft = postcardDraft;
    const savedPath = await savePostcardPng(payload);
    if (!savedPath || !sourceDraft) return;
    openFileLinkSaveDialog({
      messageId: sourceDraft.messageId || currentTask?.id || 'conversation',
      filePath: savedPath,
      label: savedPath.split(/[\\/]/).pop() || sourceDraft.title || 'Chat postcard',
      content: sourceDraft.title,
      kind: 'local',
    });
    setPostcardDraft(null);
  }, [currentTask?.id, openFileLinkSaveDialog, postcardDraft, savePostcardPng]);

  const copyPostcardImage = useCallback(async (payload?: ChatPostcardActionPayload) => {
    if (!postcardDraft) return;
    setPostcardSaving(true);
    setPostcardError(null);
    try {
      const dataUrl =
        (await capturePostcardPreviewDataUrl(payload?.element)) ||
        createPostcardPngDataUrl(postcardDraft, postcardTemplate, activeChatAccentColor);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const ClipboardItemCtor = window.ClipboardItem;
      if (!navigator.clipboard || !ClipboardItemCtor) {
        throw new Error('Image clipboard is not available in this environment.');
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      showAnswerSaveNotice('Postcard copied to clipboard.');
    } catch (error) {
      setPostcardError(error instanceof Error ? error.message : 'Failed to copy postcard.');
    } finally {
      setPostcardSaving(false);
    }
  }, [activeChatAccentColor, postcardDraft, postcardTemplate, showAnswerSaveNotice]);

  useEffect(() => {
    const handleAgentPickerOpen = () => {
      window.dispatchEvent(new CustomEvent('opendeskmate:open-settings', { detail: { query: 'agent' } }));
    };
    const handleProjectPickerOpen = () => {
      const projectSelector = document.querySelector<HTMLSelectElement>('select[data-usage-project-selector="chat"]');
      projectSelector?.focus();
    };
    const handleWorkboardOpen = () => openChatProjectWorkPopup();
    const handleSaveNote = () => {
      const latestAssistant = getLatestAssistantMessageForAction();
      if (!latestAssistant) {
        showAnswerSaveNotice('No assistant answer is available to save yet.');
        return;
      }
      handleSaveAnswerAsProjectNote({
        messageId: latestAssistant.id,
        content: getAssistantAnswerContent(latestAssistant.content) || latestAssistant.content,
      });
    };
    const handleExportOpen = () => {
      const latestAssistant = getLatestAssistantMessageForAction();
      if (latestAssistant) {
        openAnswerPostcard({
          messageId: latestAssistant.id,
          content: getAssistantAnswerContent(latestAssistant.content) || latestAssistant.content,
        });
        return;
      }
      openConversationPostcard();
    };

    window.addEventListener(APP_COMMAND_EVENTS.agentPickerOpen, handleAgentPickerOpen);
    window.addEventListener(APP_COMMAND_EVENTS.projectPickerOpen, handleProjectPickerOpen);
    window.addEventListener(APP_COMMAND_EVENTS.workboardOpen, handleWorkboardOpen);
    window.addEventListener(APP_COMMAND_EVENTS.saveNote, handleSaveNote);
    window.addEventListener(APP_COMMAND_EVENTS.exportOpen, handleExportOpen);
    return () => {
      window.removeEventListener(APP_COMMAND_EVENTS.agentPickerOpen, handleAgentPickerOpen);
      window.removeEventListener(APP_COMMAND_EVENTS.projectPickerOpen, handleProjectPickerOpen);
      window.removeEventListener(APP_COMMAND_EVENTS.workboardOpen, handleWorkboardOpen);
      window.removeEventListener(APP_COMMAND_EVENTS.saveNote, handleSaveNote);
      window.removeEventListener(APP_COMMAND_EVENTS.exportOpen, handleExportOpen);
    };
  }, [
    getLatestAssistantMessageForAction,
    handleSaveAnswerAsProjectNote,
    openAnswerPostcard,
    openChatProjectWorkPopup,
    openConversationPostcard,
    showAnswerSaveNotice,
  ]);

  const executionTopBarControls = useMemo(() => {
    if (!currentTask) return null;

    return (
      <div
        className={cn(
          'flex max-w-[min(68vw,1040px)] items-center gap-2 overflow-x-auto rounded-full border border-border/60 px-2 py-1 shadow-md backdrop-blur-md',
          effectiveChatBackground ? 'bg-background/28' : 'bg-card/85'
        )}
      >
        <div className="shrink-0">
          <ModeSwitch />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/')}
          className="h-8 w-8 shrink-0 no-drag rounded-full"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <h1
            className="min-w-0 max-w-[260px] truncate text-sm font-medium text-foreground"
            title={currentTask.prompt}
          >
            {currentTask.prompt}
          </h1>
          <TaskStatusBadge status={currentTask.status} />
          {topBarModelBadgeLabel && (
            <span
              data-testid="execution-model-badge"
              title={topBarModelBadgeLabel}
              className="inline-flex max-w-[300px] shrink-0 items-center gap-1.5 truncate rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
            >
              <Code className="h-3 w-3 shrink-0" />
              <span className="truncate">Model: {topBarModelBadgeLabel}</span>
            </span>
          )}
          {planningJobs && (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              Planning
              <TypingDots className="text-primary" />
            </span>
          )}
          {taskAgentId && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <User className="h-3 w-3" />
              Agent: {topBarTaskAgentName}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <BuildRuntimeIndicator agentId={taskAgentId || undefined} />
          <Button
            size="sm"
            variant="outline"
            disabled={currentTask.messages.length === 0 || postcardGenerating}
            onClick={openConversationPostcard}
            title="Create a postcard from this conversation"
          >
            {postcardGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Image className="mr-2 h-4 w-4" />}
            {postcardGenerating ? 'Creating...' : 'Postcard'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isComplete || currentTask.messages.length === 0}
            onClick={() => {
              setSaveSkillOpen(true);
              setSaveSkillError(null);
            }}
            title={isComplete ? 'Generate a reusable skill from this finished chat' : 'Finish the task to save it as a skill'}
          >
            <FileText className="mr-2 h-4 w-4" />
            Save as skill
          </Button>
        </div>
      </div>
    );
  }, [
    currentTask,
    effectiveChatBackground,
    isComplete,
    navigate,
    openConversationPostcard,
    planningJobs,
    taskAgentId,
    topBarModelBadgeLabel,
    topBarTaskAgentName,
  ]);
  useTopBarControls(executionTopBarControls);

  useEffect(() => {
    setChatAnswerAvatarsVisible(topBarTaskAgent?.appearance?.showAvatarOnAnswers !== false);
  }, [topBarTaskAgent?.appearance?.showAvatarOnAnswers, topBarTaskAgent?.id]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-6 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={() => navigate('/')}>Go Home</Button>
        </Card>
      </div>
    );
  }

  if (!currentTask) {
    return (
      <div className="h-full flex items-center justify-center">
        <TypingDots className="text-muted-foreground" />
      </div>
    );
  }

  const taskAgentName =
    agents.find((agent) => agent.id === taskAgentId)?.name || taskAgentId;
  const taskAgent = agents.find((agent) => agent.id === taskAgentId);
  const subagentDetailAgent = agents.find((agent) => agent.id === (subagentDetailTask?.agentId || subagentDetailRun?.childAgentId));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const subagentAgentNames = new Map(agents.map((agent) => [agent.id, agent.name || agent.id]));

  return (
    <div
      className="h-full flex flex-col bg-background relative"
      style={effectiveChatBackground ? effectiveChatBackgroundStyle : undefined}
    >
      {currentTask?.id && subagentRuns.length > 0 ? (
        <div
          className={cn(
            'relative z-10 border-b border-border/60 px-3 backdrop-blur sm:px-6',
            subagentPanelMinimized ? 'bg-background/35 pb-1 pt-0' : 'bg-background/70 py-2'
          )}
        >
          <div className={cn('mx-auto', subagentPanelMinimized ? 'max-w-4xl' : 'max-w-6xl')}>
            {subagentPanelMinimized ? (
              <button
                type="button"
                className="mx-auto flex min-h-8 max-w-full items-center gap-2 rounded-b-lg border border-t-0 border-border/70 bg-card/90 px-3 py-1.5 text-xs text-foreground shadow-sm backdrop-blur-md transition-colors hover:border-primary/40 hover:bg-card"
                aria-label="Restore Background work panel"
                onClick={() => setSubagentPanelMinimized(false)}
              >
                {activeSubagentCount > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
                <span className="font-semibold">Background work</span>
                <span className="text-muted-foreground">
                  {subagentRunsLoading ? 'Refreshing...' : `${activeSubagentCount} active · ${subagentRuns.length} total`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            ) : (
              <SubagentBackgroundWorkCard
                activeCount={activeSubagentCount}
                totalCount={subagentRuns.length}
                loading={subagentRunsLoading}
                nodes={subagentTree}
                stoppingSubagentRunId={stoppingSubagentRunId}
                agentNames={subagentAgentNames}
                onOpen={(run) => void loadSubagentDetail(run)}
                onInspect={inspectSubagentRun}
                onStop={(runId) => void stopSubagentRun(runId)}
                onArchive={(runId) => void archiveSubagentRun(runId)}
                onRecover={recoverSubagentRun}
                onReplace={replaceSubagentRun}
                onMinimize={() => setSubagentPanelMinimized(true)}
              />
            )}
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {chatAnswerAvatarNoticeVisible ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springs.gentle}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-6"
            role="status"
          >
            <motion.div
              initial={{ y: -8, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: -8, scale: 0.98 }}
              transition={springs.gentle}
              className="pointer-events-auto w-[min(92vw,460px)] rounded-2xl border border-primary/30 bg-card px-5 py-4 shadow-2xl shadow-black/25"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <EyeOff className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 text-sm text-muted-foreground">
                  <div className="text-base font-semibold text-foreground">Answer avatars hidden</div>
                  <p className="mt-1 leading-relaxed">
                    To switch them back on, use the eye button beside the Copy final answer button at the bottom of any answer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setChatAnswerAvatarNoticeVisible(false)}
                  className="-mr-2 -mt-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Close answer avatar notice"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Browser installation modal - only shown during Playwright download */}
      <AnimatePresence>
        {setupProgress && setupProgressTaskId === id && (setupProgress.toLowerCase().includes('download') || setupProgress.includes('% of')) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={springs.bouncy}
            >
              <Card className="w-[480px] p-6">
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Download className="h-7 w-7 text-primary" />
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    />
                  </div>
                  <div className="w-full">
                    <h3 className="text-lg font-semibold text-foreground mb-1">
                      Chrome not installed
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      Installing browser for automation...
                    </p>
                    {/* Progress bar - combines all downloads into single 0-100% */}
                    {(() => {
                      const percentMatch = setupProgress?.match(/(\d+)%/);
                      const currentPercent = percentMatch ? parseInt(percentMatch[1], 10) : 0;

                      // Weight each download by size: Chromium ~160MB (64%), FFMPEG ~1MB (0%), Headless ~90MB (36%)
                      // Step 1: 0-64%, Step 2: 64-64%, Step 3: 64-100%
                      let overallPercent = 0;
                      if (setupDownloadStep === 1) {
                        overallPercent = Math.round(currentPercent * 0.64);
                      } else if (setupDownloadStep === 2) {
                        overallPercent = 64 + Math.round(currentPercent * 0.01);
                      } else {
                        overallPercent = 65 + Math.round(currentPercent * 0.35);
                      }

                      return (
                        <div className="w-full">
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Downloading...</span>
                            <span className="text-foreground font-medium">{overallPercent}%</span>
                          </div>
                          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-primary rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${overallPercent}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground mt-4 text-center">
                      One-time setup (~250 MB total)
                    </p>
                  </div>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Queued state - full page (new task, no messages yet) */}
      {currentTask.status === 'queued' && currentTask.messages.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.gentle}
          className="relative flex-1 flex flex-col items-center justify-center gap-6 bg-background px-6"
          style={effectiveChatBackground ? effectiveChatBackgroundStyle : undefined}
        >
          <ChatBackgroundSwitcher
            selectedId={agentChatBackgroundId}
            onSelect={handleSelectAgentChatBackground}
            appearance={effectiveAgentAppearance}
            onAppearanceChange={handleUpdateAgentAppearance}
            agentAvatar={topBarTaskAgent?.avatar}
            agentAvatarColor={topBarTaskAgent?.avatarColor}
            agentAvatarImageDataUrl={topBarTaskAgent?.avatarImageDataUrl}
          />
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
            <Clock className="h-8 w-8 text-amber-600" />
          </div>
          <div className="text-center max-w-md">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Waiting for another task
            </h2>
            <p className="text-muted-foreground">
              Your task is queued and will start automatically when the current task completes.
            </p>
          </div>
        </motion.div>
      )}

      {/* Queued state - inline (follow-up, has previous messages) */}
      {currentTask.status === 'queued' && currentTask.messages.length > 0 && (
        <div
          className="relative min-h-0 flex-1 bg-background"
          style={effectiveChatBackground ? effectiveChatBackgroundStyle : undefined}
          onWheelCapture={handleMessageWheelCapture}
          onTouchStartCapture={handleMessageTouchStartCapture}
        >
          <ChatBackgroundSwitcher
            selectedId={agentChatBackgroundId}
            onSelect={handleSelectAgentChatBackground}
            appearance={effectiveAgentAppearance}
            onAppearanceChange={handleUpdateAgentAppearance}
            agentAvatar={topBarTaskAgent?.avatar}
            agentAvatarColor={topBarTaskAgent?.avatarColor}
            agentAvatarImageDataUrl={topBarTaskAgent?.avatarImageDataUrl}
          />
          <Virtuoso
            ref={messagesVirtuosoRef}
            scrollerRef={setMessageScrollerRef}
            className="h-full"
            data={visibleTaskMessages}
            computeItemKey={(_index, message) => message.id}
            defaultItemHeight={180}
            atBottomThreshold={240}
            increaseViewportBy={{ top: 500, bottom: 700 }}
            atBottomStateChange={handleMessagesAtBottomChange}
            rangeChanged={handlePromptNavigatorRangeChanged}
            itemContent={(index, message) => {
              const isLastMessage = index === visibleTaskMessages.length - 1;
              const relayedSubagentMeta = getRelayedSubagentCompletionMeta(message);
              const relayedSubagentAgent = relayedSubagentMeta
                ? agentById.get(relayedSubagentMeta.childAgentId)
                : undefined;
              return (
                <div className={cn('px-6', index === 0 ? 'pt-6' : 'pt-2', isLastMessage ? 'pb-5' : 'pb-2')}>
                  <div className="mx-auto max-w-5xl">
                    <MessageBubble
                      message={message}
                      onSavePrompt={handleSavePrompt}
                      onSaveAnswerAsProjectNote={handleSaveAnswerAsProjectNote}
                      onSaveAnswerAsRtf={handleSaveAnswerAsRtf}
                      assistantAgentName={taskAgentName || 'Agent'}
                      assistantAgentRoleName={taskAgent?.roleName}
                      assistantAgentAvatar={taskAgent?.avatar}
                      assistantAgentAvatarColor={taskAgent?.avatarColor}
                      assistantAgentAvatarImageDataUrl={taskAgent?.avatarImageDataUrl}
                      assistantAvatarFrame={taskAgent?.appearance?.avatarFrame}
                      assistantAccentColor={activeChatAccentColor}
                      assistantAnswerStyle={taskAgent?.appearance?.answerStyle}
                      relayedSubagentAgentName={relayedSubagentAgent?.name || relayedSubagentMeta?.childAgentId}
                      relayedSubagentAgentRoleName={relayedSubagentAgent?.roleName}
                      relayedSubagentAgentAvatar={relayedSubagentAgent?.avatar}
                      relayedSubagentAgentAvatarColor={relayedSubagentAgent?.avatarColor}
                      relayedSubagentAgentAvatarImageDataUrl={relayedSubagentAgent?.avatarImageDataUrl}
                      relayedSubagentAvatarFrame={relayedSubagentAgent?.appearance?.avatarFrame}
                      relayedSubagentLabel={relayedSubagentMeta?.label}
                      assistantReactions={getAssistantMessageReactions(message, message.type === 'assistant' && index === lastVisibleAssistantIndex)}
                      savedNoteAssets={getSavedNoteAssetsForMessage(message.id)}
                      showAssistantAvatar={chatAnswerAvatarsVisible}
                      onToggleAssistantAvatar={handleChatAnswerAvatarVisibilityChange}
                      onCreatePostcard={openAnswerPostcard}
                      decisionPinned={isDecisionPinned(message.id)}
                      onToggleDecisionPin={toggleDecisionPin}
                      onSaveAssetAsProjectNote={handleSaveAssetAsProjectNote}
                      onSaveSourceToWorkboard={openSourceLinkSaveDialog}
                      onAttachAssetToWorkboard={handleAttachAssetToWorkboard}
                      debugMode={debugModeEnabled}
                    />
                  </div>
                </div>
              );
            }}
            components={{
              Footer: () => (
                <div className="px-6 pb-6 pt-2">
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springs.gentle}
                    className="mx-auto flex max-w-5xl flex-col items-center gap-4 py-8"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
                      <Clock className="h-6 w-6 text-amber-600" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        Waiting for another task
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Your follow-up will continue automatically
                      </p>
                    </div>
                  </motion.div>
                </div>
              ),
            }}
          />
          <PromptNavigator
            entries={promptNavigatorEntries}
            activeEntryId={activePromptNavigatorId}
            onJump={handlePromptNavigatorJump}
            onOpenAsset={handlePromptNavigatorOpenAsset}
            storageKey={CHAT_PROMPT_NAVIGATOR_STORAGE_KEY}
            label="Conversation map"
          />
        </div>
      )}

      {/* Messages - normal state (running, completed, failed, etc.) */}
      {currentTask.status !== 'queued' && (
        <div
          className="relative min-h-0 flex-1 bg-background"
          style={effectiveChatBackground ? effectiveChatBackgroundStyle : undefined}
          onWheelCapture={handleMessageWheelCapture}
          onTouchStartCapture={handleMessageTouchStartCapture}
        >
          <ChatBackgroundSwitcher
            selectedId={agentChatBackgroundId}
            onSelect={handleSelectAgentChatBackground}
            appearance={effectiveAgentAppearance}
            onAppearanceChange={handleUpdateAgentAppearance}
            agentAvatar={topBarTaskAgent?.avatar}
            agentAvatarColor={topBarTaskAgent?.avatarColor}
            agentAvatarImageDataUrl={topBarTaskAgent?.avatarImageDataUrl}
          />
          <Virtuoso
            ref={messagesVirtuosoRef}
            scrollerRef={setMessageScrollerRef}
            className="h-full"
            data={visibleTaskMessages}
            computeItemKey={(_index, message) => message.id}
            defaultItemHeight={180}
            atBottomThreshold={240}
            increaseViewportBy={{ top: 500, bottom: 700 }}
            followOutput={(isAtBottom) => {
              if (currentTask.status !== 'running') return false;
              if (isAutoFollowSuppressed()) return false;
              return isAtBottom || isNearBottomRef.current ? 'auto' : false;
            }}
            atBottomStateChange={handleMessagesAtBottomChange}
            rangeChanged={handlePromptNavigatorRangeChanged}
            itemContent={(index, message) => {
              const isLastMessage = index === visibleTaskMessages.length - 1;
              const isLastAssistantMessage =
                message.type === 'assistant' && isLastMessage;
              const isLastAssistantForContinue = index === lastVisibleAssistantIndex;
              // Show continue button on last assistant message when:
              // - Task was interrupted (user can always continue)
              // - Task completed AND the message indicates agent is waiting for user action
              const showContinue = isLastAssistantForContinue && !!hasSession &&
                (currentTask.status === 'interrupted' ||
                 (currentTask.status === 'completed' && isWaitingForUser(getAssistantAnswerContent(message.content))));
              const relayedSubagentMeta = getRelayedSubagentCompletionMeta(message);
              const relayedSubagentAgent = relayedSubagentMeta
                ? agentById.get(relayedSubagentMeta.childAgentId)
                : undefined;
              return (
                <div className={cn('px-6', index === 0 ? 'pt-6' : 'pt-2', isLastMessage ? 'pb-5' : 'pb-2')}>
                  <div className="mx-auto max-w-5xl">
                    <MessageBubble
                      message={message}
                      shouldStream={isLastAssistantMessage && currentTask.status === 'running'}
                      isLastMessage={isLastMessage}
                      isRunning={currentTask.status === 'running'}
                      showContinueButton={showContinue}
                      continueLabel={currentTask.status === 'interrupted' ? 'Continue' : 'Done, Continue'}
                      onContinue={handleContinue}
                      isLoading={isLoading}
                      onSavePrompt={handleSavePrompt}
                      onSaveAnswerAsProjectNote={handleSaveAnswerAsProjectNote}
                      onSaveAnswerAsRtf={handleSaveAnswerAsRtf}
                      assistantAgentName={taskAgentName || 'Agent'}
                      assistantAgentRoleName={taskAgent?.roleName}
                      assistantAgentAvatar={taskAgent?.avatar}
                      assistantAgentAvatarColor={taskAgent?.avatarColor}
                      assistantAgentAvatarImageDataUrl={taskAgent?.avatarImageDataUrl}
                      assistantAvatarFrame={taskAgent?.appearance?.avatarFrame}
                      assistantAccentColor={activeChatAccentColor}
                      assistantAnswerStyle={taskAgent?.appearance?.answerStyle}
                      relayedSubagentAgentName={relayedSubagentAgent?.name || relayedSubagentMeta?.childAgentId}
                      relayedSubagentAgentRoleName={relayedSubagentAgent?.roleName}
                      relayedSubagentAgentAvatar={relayedSubagentAgent?.avatar}
                      relayedSubagentAgentAvatarColor={relayedSubagentAgent?.avatarColor}
                      relayedSubagentAgentAvatarImageDataUrl={relayedSubagentAgent?.avatarImageDataUrl}
                      relayedSubagentAvatarFrame={relayedSubagentAgent?.appearance?.avatarFrame}
                      relayedSubagentLabel={relayedSubagentMeta?.label}
                      assistantReactions={getAssistantMessageReactions(message, isLastAssistantForContinue)}
                      savedNoteAssets={getSavedNoteAssetsForMessage(message.id)}
                      showAssistantAvatar={chatAnswerAvatarsVisible}
                      onToggleAssistantAvatar={handleChatAnswerAvatarVisibilityChange}
                      onCreatePostcard={openAnswerPostcard}
                      decisionPinned={isDecisionPinned(message.id)}
                      onToggleDecisionPin={toggleDecisionPin}
                      onSaveAssetAsProjectNote={handleSaveAssetAsProjectNote}
                      onSaveSourceToWorkboard={openSourceLinkSaveDialog}
                      onAttachAssetToWorkboard={handleAttachAssetToWorkboard}
                      debugMode={debugModeEnabled}
                    />
                  </div>
                </div>
              );
            }}
            components={{
              Footer: () => (
                <div className="px-6 pb-6 pt-2">
                  <AnimatePresence>
                    {currentTask.status === 'running' && !permissionRequest ? (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={springs.gentle}
                      >
                        <AgentToolStateIndicator
                          presence={agentPresence}
                          activitySteps={agentToolActivitySteps}
                          agentName={topBarTaskAgentName || 'Agent'}
                          agentRoleName={topBarTaskAgent?.roleName}
                          agentAvatar={topBarTaskAgent?.avatar}
                          agentAvatarColor={topBarTaskAgent?.avatarColor}
                          agentAvatarImageDataUrl={topBarTaskAgent?.avatarImageDataUrl}
                          className={cn('mx-auto max-w-5xl', effectiveChatBackground && 'bg-background/55')}
                          style={effectiveThinkingIndicatorStyle}
                          testId="execution-thinking-indicator"
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              ),
            }}
          />
          <PromptNavigator
            entries={promptNavigatorEntries}
            activeEntryId={activePromptNavigatorId}
            onJump={handlePromptNavigatorJump}
            onOpenAsset={handlePromptNavigatorOpenAsset}
            storageKey={CHAT_PROMPT_NAVIGATOR_STORAGE_KEY}
            label="Conversation map"
          />
        </div>
      )}

      <AnimatePresence>
        {showScrollToBottom && visibleTaskMessages.length > 0 && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={springs.gentle}
            onClick={() => {
              isNearBottomRef.current = true;
              setShowScrollToBottom(false);
              scrollToBottomNow('smooth');
            }}
            className="absolute left-1/2 bottom-60 z-20 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-2 text-foreground shadow-md backdrop-blur-sm transition hover:bg-accent"
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
          >
            <ChevronDown className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Save Prompt Dialog */}
      <AnimatePresence>
        {showSavePromptDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={springs.bouncy}
            >
              <Card className="w-full max-w-md p-6 mx-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                    <Bookmark className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground mb-4">
                      Save Prompt
                    </h3>
                    <div className="space-y-3">
                      <Input
                        placeholder="Enter a title for this prompt..."
                        value={savePromptTitle}
                        onChange={(e) => setSavePromptTitle(e.target.value)}
                        autoFocus
                      />
                      <div className="p-3 rounded-lg bg-muted text-sm max-h-32 overflow-y-auto">
                        <p className="text-muted-foreground whitespace-pre-wrap break-words">
                          {promptToSave}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowSavePromptDialog(false);
                          setPromptToSave(null);
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleConfirmSavePrompt}
                        disabled={!savePromptTitle.trim()}
                        className="flex-1"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Follow-up input */}
      {canInlinePrompt && (
        <FollowUpBar
          ref={followUpBarRef}
          isLoading={isLoading}
          hasSession={!!hasSession}
          currentTaskStatus={currentTask.status}
          promptsCount={promptPickerCount}
          onSend={handleFollowUpSend}
          onStop={interruptTask}
          onPlanNextJobs={handlePlanNextJobs}
          planningJobs={planningJobs}
          taskId={currentTask.id}
          agentId={currentTask.agentId}
          usageProjectId={currentTask.usageProjectId ?? null}
          privacyMode={privacyMode}
          onPrivacyModeChange={setPrivacyMode}
          slashCommands={executionSlashCommands}
          onOpenSavedPrompts={(mode) => {
            setSavedPromptsMode(mode);
            setShowSavedPromptsSelector(true);
          }}
          onOpenProjectWork={openChatProjectWorkPopup}
          onUsageProjectChange={handleFollowUpUsageProjectChange}
          translucentSurface={Boolean(effectiveChatBackground)}
        />
      )}

      {/* Saved Prompts Selector Dialog */}
      <SavedPromptsDialog
        open={showSavedPromptsSelector}
        onOpenChange={setShowSavedPromptsSelector}
        onSelectPrompt={handleSelectSavedPrompt}
        mode={savedPromptsMode}
      />
      <ChatPostcardDialog
        open={Boolean(postcardDraft)}
        onOpenChange={(open) => {
          if (!open && !postcardSaving) {
            setPostcardDraft(null);
            setPostcardError(null);
          }
        }}
        defaultTemplateId={postcardTemplate}
        draft={postcardDialogDraft}
        onDraftChange={handlePostcardDialogDraftChange}
        onCopyPng={copyPostcardImage}
        onExportPng={exportPostcard}
        onAttachToWorkboard={exportPostcardAndAttach}
        copyLabel="Copy image"
        exportLabel={postcardSaving ? 'Exporting...' : 'Export PNG'}
        attachLabel="Export & attach"
        isCopying={postcardSaving}
        isExporting={postcardSaving}
        isAttaching={postcardSaving}
        errorMessage={postcardError}
      />
      <BuildProjectWorkPopup
        open={projectWorkPopupOpen}
        projects={usageProjects}
        assignees={usageAssignees}
        linkedProjectId={projectWorkPopupInitialProjectId}
        initialProjectId={projectWorkPopupInitialProjectId}
        sourceLabel={chatProjectWorkSourceLabel}
        fallbackLabel="Chat project work"
        storageScope="chat"
        agentId={currentTask?.agentId ?? taskAgentId}
        onInsertPrompt={(prompt) => {
          followUpBarRef.current?.appendValue(prompt);
          followUpBarRef.current?.focus();
        }}
        onSelectedProjectChange={(projectId) => writeChatProjectWorkPopupSession(true, projectId)}
        onClose={() => {
          setProjectWorkPopupOpen(false);
          writeChatProjectWorkPopupSession(false);
        }}
      />

      {answerSaveNotice ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[100] max-w-[min(28rem,calc(100vw-2rem))]">
          <Card className="flex items-start gap-2 border-primary/30 bg-background/95 p-3 text-sm text-primary shadow-xl backdrop-blur">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{answerSaveNotice}</span>
          </Card>
        </div>
      ) : null}

      <Dialog open={answerSaveDialogOpen} onOpenChange={(open) => {
        setAnswerSaveDialogOpen(open);
        if (!open && !answerSaveSaving) {
          answerSaveWorkItemsRequestRef.current += 1;
          setAnswerSavePending(null);
          setAnswerSaveWorkItems([]);
          setAnswerSaveWorkItemsProjectId('');
          setAnswerSaveTargetWorkItemId('');
          setAnswerSaveError(null);
          answerSaveTitleRef.current = '';
          answerSaveSourceDescriptionRef.current = '';
          setAnswerSaveTitle('');
          setAnswerSaveSourceDescription('');
        }
      }}>
        <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-xl flex-col overflow-hidden">
          <DialogHeader className="pr-8">
            <DialogTitle>
              {answerSavePending?.mode === 'rtf'
                ? 'Save Answer As RTF'
                : answerSavePending?.mode === 'file-link'
                  ? 'Attach File to Workboard'
                  : answerSavePending?.mode === 'source-link'
                    ? 'Save Source'
                    : 'Save Answer As Note'}
            </DialogTitle>
            <DialogDescription>
              {answerSavePending?.mode === 'rtf'
                ? 'Save this answer as a Rich Text File. You can also attach the saved file to a project Workboard item.'
                : answerSavePending?.mode === 'file-link'
                  ? 'Attach this generated file, document, source, or postcard to a project Workboard item.'
                  : answerSavePending?.mode === 'source-link'
                    ? 'Save this source link to a project Workboard item with a title and description.'
                    : 'Save this answer as a formatted note on a project Workboard item.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {answerSaveError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {answerSaveError}
              </div>
            ) : null}

            <div className="rounded-md border border-border/60 bg-background p-3">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="chat-answer-save-title">
                {answerSavePending?.mode === 'rtf'
                  ? 'File name'
                  : answerSavePending?.mode === 'file-link'
                    ? 'File label'
                    : answerSavePending?.mode === 'source-link'
                      ? 'Source title'
                      : 'Note title'}
              </label>
              <Input
                key={`answer-save-title:${answerSavePending?.messageId || 'new'}:${answerSavePending?.mode || 'note'}`}
                id="chat-answer-save-title"
                className="mt-1.5"
                defaultValue={answerSaveTitle}
                onChange={(event) => {
                  answerSaveTitleRef.current = event.target.value;
                }}
                placeholder={answerSavePending?.mode === 'rtf'
                  ? 'task-answer_YYYY-MM-DD_HH-MM'
                  : answerSavePending?.mode === 'file-link'
                    ? 'Document label'
                    : answerSavePending?.mode === 'source-link'
                      ? 'Source title'
                      : 'Task answer'}
              />
            </div>

            {answerSavePending?.mode === 'source-link' && answerSavePending.sourceUrl ? (
              <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                <div>
                  <div className="font-medium text-foreground">Source link</div>
                  <div className="mt-1 break-all font-mono">{answerSavePending.sourceUrl}</div>
                </div>
                <label className="grid gap-1">
                  <span className="font-medium text-foreground">Description</span>
                  <Textarea
                    key={`answer-save-source-description:${answerSavePending.messageId}:${answerSavePending.sourceUrl}`}
                    defaultValue={answerSaveSourceDescription}
                    onChange={(event) => {
                      answerSaveSourceDescriptionRef.current = event.target.value;
                      setAnswerSaveSourceDescription(event.target.value);
                    }}
                    className="min-h-20 text-sm"
                    placeholder="What this source supports or why it is useful"
                  />
                </label>
              </div>
            ) : null}

            {answerSavePending?.mode === 'file-link' && answerSavePending.filePath ? (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">Link target</div>
                <div className="mt-1 break-all font-mono">{answerSavePending.filePath}</div>
              </div>
            ) : null}

            {answerSavePending?.mode === 'rtf' ? (
              <label className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={answerSaveRtfAttachToWorkItem}
                  onChange={(event) => {
                    setAnswerSaveRtfAttachToWorkItem(event.target.checked);
                    if (event.target.checked) {
                      const nextProjectId = answerSaveTargetProjectId || getDefaultAnswerSaveProjectId();
                      setAnswerSaveTargetProjectId(nextProjectId);
                      if (nextProjectId) void loadAnswerSaveWorkItemsForProject(nextProjectId);
                    }
                  }}
                />
                <span>
                  <span className="block font-medium text-foreground">Attach saved file to a project work item</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    This links the saved local RTF file. If the file is moved later, the document link will break.
                  </span>
                </span>
              </label>
            ) : null}

            {answerSavePending?.mode !== 'rtf' || answerSaveRtfAttachToWorkItem ? (
              <>
                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Project</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className={cn(
                        'rounded-md border px-3 py-2 text-left text-sm',
                        answerSaveDialogMode === 'existing-project'
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                      )}
                      onClick={() => {
                        setAnswerSaveDialogMode('existing-project');
                        const nextProjectId = answerSaveTargetProjectId || getDefaultAnswerSaveProjectId();
                        setAnswerSaveTargetProjectId(nextProjectId);
                        if (nextProjectId) void loadAnswerSaveWorkItemsForProject(nextProjectId);
                      }}
                      disabled={usageProjects.length === 0}
                    >
                      Existing project
                      <div className="mt-1 text-xs text-muted-foreground">Use one of your current budget projects.</div>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded-md border px-3 py-2 text-left text-sm',
                        answerSaveDialogMode === 'new-project'
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                      )}
                      onClick={() => {
                        setAnswerSaveDialogMode('new-project');
                        answerSaveWorkItemsRequestRef.current += 1;
                        setAnswerSaveWorkItems([]);
                        setAnswerSaveWorkItemsProjectId('');
                        setAnswerSaveTargetWorkItemId('__new__');
                      }}
                    >
                      New project
                      <div className="mt-1 text-xs text-muted-foreground">Create a budget project and save this answer under it.</div>
                    </button>
                  </div>

                  {answerSaveDialogMode === 'existing-project' ? (
                    <div className="mt-3 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="chat-answer-save-project">Choose project</label>
                      <select
                        id="chat-answer-save-project"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={answerSaveTargetProjectId}
                        onChange={(event) => {
                          const nextProjectId = event.target.value;
                          setAnswerSaveTargetProjectId(nextProjectId);
                          setAnswerSaveTargetWorkItemId('');
                          if (nextProjectId) void loadAnswerSaveWorkItemsForProject(nextProjectId);
                        }}
                      >
                        {usageProjects.length === 0 ? (
                          <option value="">No projects yet</option>
                        ) : (
                          <>
                            <option value="">Choose a project...</option>
                            {usageProjects.map((project) => (
                              <option key={project.id} value={project.id}>{project.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="chat-answer-save-new-project">New project name</label>
                      <Input
                        id="chat-answer-save-new-project"
                        value={answerSaveNewProjectName}
                        onChange={(event) => setAnswerSaveNewProjectName(event.target.value)}
                        placeholder="Budget project name"
                      />
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Work item</div>
                  {answerSaveDialogMode === 'existing-project' && answerSaveTargetProjectId ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="chat-answer-save-work-item">Choose work item</label>
                      <select
                        id="chat-answer-save-work-item"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={answerSaveTargetWorkItemId || '__new__'}
                        onChange={(event) => setAnswerSaveTargetWorkItemId(event.target.value)}
                        disabled={answerSaveWorkItemsLoading}
                      >
                        {(answerSaveWorkItemsProjectId === answerSaveTargetProjectId ? answerSaveWorkItems : []).map((item) => (
                          <option key={item.id} value={item.id}>{item.title}{item.archived ? ' (archived)' : ''}</option>
                        ))}
                        <option value="__new__">Create new work item</option>
                      </select>
                      {answerSaveWorkItemsLoading ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading work items...
                        </div>
                      ) : null}
                      {!answerSaveWorkItemsLoading
                        && answerSaveWorkItemsProjectId === answerSaveTargetProjectId
                        && answerSaveWorkItems.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          No work items are saved under this project yet.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Choose a project to see its work items.</div>
                  )}

                  {(!answerSaveWorkItemsLoading && (answerSaveDialogMode === 'new-project' || answerSaveTargetWorkItemId === '__new__' || !answerSaveTargetWorkItemId)) ? (
                    <div className="mt-3 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="chat-answer-save-new-work-item">New work item title</label>
                      <Input
                        id="chat-answer-save-new-work-item"
                        value={answerSaveNewWorkItemTitle}
                        onChange={(event) => setAnswerSaveNewWorkItemTitle(event.target.value)}
                        placeholder="Work item title"
                      />
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAnswerSaveDialogOpen(false)}
              disabled={answerSaveSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void savePendingAnswer()}
              disabled={
                answerSaveSaving
                || !answerSavePending
                || ((answerSavePending.mode !== 'rtf' || answerSaveRtfAttachToWorkItem) && answerSaveDialogMode === 'existing-project' && !answerSaveTargetProjectId)
                || ((answerSavePending.mode !== 'rtf' || answerSaveRtfAttachToWorkItem) && (answerSaveTargetWorkItemId === '__new__' || answerSaveDialogMode === 'new-project') && !answerSaveNewWorkItemTitle.trim())
              }
            >
              {answerSaveSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : (
                answerSavePending?.mode === 'rtf'
                  ? <Download className="mr-1.5 h-4 w-4" />
                  : answerSavePending?.mode === 'file-link'
                    ? <FolderOpen className="mr-1.5 h-4 w-4" />
                    : <FileText className="mr-1.5 h-4 w-4" />
              )}
              {answerSavePending?.mode === 'rtf'
                ? 'Save RTF'
                : answerSavePending?.mode === 'file-link'
                  ? 'Attach file'
                  : 'Save note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proactive suggestions dialog */}
      <Dialog
        open={proactiveOpen}
        onOpenChange={(open) => {
          setProactiveOpen(open);
          if (!open) {
            setProactiveError(null);
            setProactiveSuggestions([]);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Suggestions from memory
            </DialogTitle>
            <DialogDescription>
              Deskmate proposes a few tasks you might want to run next. Nothing runs until you click Yes.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {planningJobs ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <TypingDots />
                Planning…
              </div>
            ) : proactiveError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {proactiveError}
              </div>
            ) : proactiveSuggestions.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No strong suggestions right now.
              </div>
            ) : (
              <div className="space-y-3">
                {proactiveSuggestions.map((s) => (
                  <Card key={s.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{s.title}</div>
                        {s.why && <div className="mt-1 text-sm text-muted-foreground">{s.why}</div>}
                        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground whitespace-pre-wrap">
                          {s.prompt}
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          {s.confirmation || 'Run this task now?'}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setProactiveSuggestions((prev) => {
                              const next = prev.filter((entry) => entry.id !== s.id);
                              if (next.length === 0) {
                                setProactiveOpen(false);
                              }
                              return next;
                            });
                          }}
                        >
                          No
                        </Button>
                        <Button onClick={() => void handleRunProactiveSuggestion(s)}>Yes</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

      <DialogFooter>
            <Button variant="outline" onClick={() => setProactiveOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(subagentDetailRun)} onOpenChange={(open) => {
        if (!open && !subagentDetailSending) {
          setSubagentDetailRun(null);
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
                  {subagentDetailTask.messages.length > subagentDetailMessageLimit ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      <span>
                        Showing latest {subagentDetailMessageLimit} of {subagentDetailTask.messages.length} messages.
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSubagentDetailMessageLimit((current) => current + SUBAGENT_DETAIL_TRANSCRIPT_INCREMENT)}
                      >
                        Show earlier messages
                      </Button>
                    </div>
                  ) : null}
                  {subagentDetailTask.messages
                    .slice(Math.max(0, subagentDetailTask.messages.length - subagentDetailMessageLimit))
                    .map((message, visibleIndex) => {
                    const index = Math.max(0, subagentDetailTask.messages.length - subagentDetailMessageLimit) + visibleIndex;
                    const relayedSubagentMeta = getRelayedSubagentCompletionMeta(message);
                    const relayedSubagentAgent = relayedSubagentMeta
                      ? agentById.get(relayedSubagentMeta.childAgentId)
                      : undefined;
                    return (
                      <MessageBubble
                        key={`${message.id}-${index}`}
                        message={message}
                        onSaveAnswerAsProjectNote={handleSaveAnswerAsProjectNote}
                        onSaveAnswerAsRtf={handleSaveAnswerAsRtf}
                        onCreatePostcard={openAnswerPostcard}
                        decisionPinned={isDecisionPinned(message.id)}
                        onToggleDecisionPin={toggleDecisionPin}
                        onSaveAssetAsProjectNote={handleSaveAssetAsProjectNote}
                        onSaveSourceToWorkboard={openSourceLinkSaveDialog}
                        onAttachAssetToWorkboard={handleAttachAssetToWorkboard}
                        assistantAgentName={subagentDetailAgent?.name || subagentDetailTask?.agentId || subagentDetailRun?.childAgentId || 'Agent'}
                        assistantAgentRoleName={subagentDetailAgent?.roleName}
                        assistantAgentAvatar={subagentDetailAgent?.avatar}
                        assistantAgentAvatarColor={subagentDetailAgent?.avatarColor}
                        assistantAgentAvatarImageDataUrl={subagentDetailAgent?.avatarImageDataUrl}
                        relayedSubagentAgentName={relayedSubagentAgent?.name || relayedSubagentMeta?.childAgentId}
                        relayedSubagentAgentRoleName={relayedSubagentAgent?.roleName}
                        relayedSubagentAgentAvatar={relayedSubagentAgent?.avatar}
                        relayedSubagentAgentAvatarColor={relayedSubagentAgent?.avatarColor}
                        relayedSubagentAgentAvatarImageDataUrl={relayedSubagentAgent?.avatarImageDataUrl}
                        relayedSubagentAvatarFrame={relayedSubagentAgent?.appearance?.avatarFrame}
                        relayedSubagentLabel={relayedSubagentMeta?.label}
                        showAssistantAvatar={chatAnswerAvatarsVisible}
                        onToggleAssistantAvatar={handleChatAnswerAvatarVisibilityChange}
                        debugMode={debugModeEnabled}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Send follow-up to child session</label>
                <Textarea
                  value={subagentDetailPrompt}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setSubagentDetailPrompt(event.target.value)}
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
              onClick={() => setSubagentDetailRun(null)}
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

      {/* Save workflow as a skill (AI-assisted) */}
      <Dialog
        open={saveSkillOpen}
        onOpenChange={(open) => {
          setSaveSkillOpen(open);
          if (!open) {
            setSaveSkillLoading(false);
            setSaveSkillSaving(false);
            setSaveSkillError(null);
            setSaveSkillShareScope('private');
            setSaveSkillShareAgentIds([]);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Save this workflow as a skill</DialogTitle>
            <DialogDescription>
              Deskmate will generate an OpenDeskmate <code className="rounded bg-muted px-1 py-0.5">SKILL.md</code> playbook from this finished chat.
            </DialogDescription>
          </DialogHeader>

          {saveSkillLoading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <TypingDots />
              Generating draft…
            </div>
          ) : saveSkillError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {saveSkillError}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Skill ID (optional, folder name)</label>
                  <Input
                    value={saveSkillId}
                    onChange={(e) => setSaveSkillId(e.target.value)}
                    placeholder="Leave blank to auto-generate"
                    disabled={saveSkillSaving}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Name</label>
                  <Input
                    value={saveSkillName}
                    onChange={(e) => setSaveSkillName(e.target.value)}
                    placeholder="Human-friendly name"
                    disabled={saveSkillSaving}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Description</label>
                <Input
                  value={saveSkillDesc}
                  onChange={(e) => setSaveSkillDesc(e.target.value)}
                  placeholder="One sentence"
                  disabled={saveSkillSaving}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Sharing</label>
                <select
                  value={saveSkillShareScope}
                  onChange={(e) => setSaveSkillShareScope((e.target.value as UserSkillSharingScope) || 'private')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={saveSkillSaving}
                >
                  <option value="private">Private to owner agent</option>
                  <option value="selected">Share with selected agents</option>
                  <option value="all">Share with all agents</option>
                </select>
                <p className="text-xs text-muted-foreground">Owner agent always keeps access.</p>
              </div>

              {saveSkillShareScope === 'selected' && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Selected agents</label>
                  <div className="max-h-40 overflow-auto rounded-md border border-border p-2 space-y-2">
                    {saveSkillSelectableAgents.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No additional agents available to share with.</p>
                    ) : (
                      saveSkillSelectableAgents.map((agent) => {
                        const checked = saveSkillShareAgentIds.includes(agent.id);
                        return (
                          <label key={agent.id} className="flex items-center justify-between gap-2 text-sm">
                            <span>{agent.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleSaveSkillShareAgentId(agent.id, e.target.checked)}
                              disabled={saveSkillSaving}
                            />
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={saveSkillOverwrite}
                  onChange={(e) => setSaveSkillOverwrite(e.target.checked)}
                  disabled={saveSkillSaving}
                />
                Overwrite if the skill already exists
              </label>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">SKILL.md</label>
                <textarea
                  value={saveSkillMd}
                  onChange={(e) => setSaveSkillMd(e.target.value)}
                  className="w-full min-h-[340px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  spellCheck={false}
                  disabled={saveSkillSaving}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveSkillOpen(false)} disabled={saveSkillSaving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveAsSkill()} disabled={saveSkillLoading || saveSkillSaving}>
              {saveSkillSaving ? 'Saving…' : 'Save skill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Completed/Failed state (no session to continue) */}
      {isComplete && !canInlinePrompt && (
        <div
          className={cn(
            'flex-shrink-0 border-t border-border px-6 py-4 text-center',
            effectiveChatBackground ? 'bg-background/28 backdrop-blur-md' : 'bg-card/50'
          )}
        >
          <p className="text-sm text-muted-foreground mb-3">
            Task {currentTask.status === 'interrupted' ? 'stopped' : currentTask.status}
          </p>
          <Button onClick={() => navigate('/')}>
            Start New Task
          </Button>
        </div>
      )}

      {/* Debug Panel - Only visible when debug mode is enabled */}
      {debugModeEnabled && (
        <div className="flex-shrink-0 border-t border-border">
          {/* Toggle header */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDebugPanelOpen(!debugPanelOpen)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setDebugPanelOpen(!debugPanelOpen);
              }
            }}
            className="w-full flex items-center justify-between px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 transition-colors"
          >
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Bug className="h-4 w-4" />
              <span className="font-medium">Debug Logs</span>
              {debugLogs.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-300 text-xs">
                  {debugLogs.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {debugLogs.length > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportDebugLogs();
                    }}
                  >
                    {debugExported ? (
                      <Check className="h-3 w-3 mr-1 text-green-400" />
                    ) : (
                      <Download className="h-3 w-3 mr-1" />
                    )}
                    {debugExported ? 'Exported' : 'Export'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDebugLogs([]);
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                </>
              )}
              {debugPanelOpen ? (
                <ChevronDown className="h-4 w-4 text-zinc-500" />
              ) : (
                <ChevronUp className="h-4 w-4 text-zinc-500" />
              )}
            </div>
          </div>

          {/* Collapsible panel content */}
          <AnimatePresence>
            {debugPanelOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 200, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div
                  ref={debugPanelRef}
                  className="h-[200px] overflow-y-auto bg-zinc-950 text-zinc-300 font-mono text-xs p-4"
                >
                  {debugLogs.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-zinc-500">
                      No debug logs yet. Run a task to see logs.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {debugLogs.map((log, index) => (
                        <div key={index} className="flex gap-2">
                          <span className="text-zinc-500 shrink-0">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          <span className={cn(
                            'shrink-0 px-1 rounded',
                            log.type === 'error' ? 'bg-red-500/20 text-red-400' :
                            log.type === 'warn' ? 'bg-yellow-500/20 text-yellow-400' :
                            log.type === 'info' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-zinc-700 text-zinc-400'
                          )}>
                            [{log.type}]
                          </span>
                          <span className="text-zinc-300 break-all">
                            {log.message}
                            {log.data !== undefined && (
                              <span className="text-zinc-500 ml-2">
                                {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 0)}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: TaskMessage;
  shouldStream?: boolean;
  isLastMessage?: boolean;
  isRunning?: boolean;
  showContinueButton?: boolean;
  continueLabel?: string;
  onContinue?: () => void;
  isLoading?: boolean;
  onSavePrompt?: (content: string) => void;
  onSaveAnswerAsProjectNote?: (payload: { messageId: string; content: string; sourceElement?: HTMLElement | null }) => void;
  onSaveAnswerAsRtf?: (payload: { messageId: string; content: string; sourceElement?: HTMLElement | null }) => void;
  assistantAgentName?: string;
  assistantAgentRoleName?: string;
  assistantAgentAvatar?: string;
  assistantAgentAvatarColor?: string;
  assistantAgentAvatarImageDataUrl?: string;
  assistantAvatarFrame?: string;
  assistantAccentColor?: string;
  assistantAnswerStyle?: string;
  relayedSubagentAgentName?: string;
  relayedSubagentAgentRoleName?: string;
  relayedSubagentAgentAvatar?: string;
  relayedSubagentAgentAvatarColor?: string;
  relayedSubagentAgentAvatarImageDataUrl?: string;
  relayedSubagentAvatarFrame?: string;
  relayedSubagentLabel?: string;
  assistantReactions?: AssistantReaction[];
  savedNoteAssets?: SavedNoteAsset[];
  showAssistantAvatar?: boolean;
  onToggleAssistantAvatar?: (visible: boolean) => void;
  onCreatePostcard?: (payload: { messageId: string; content: string; sourceElement?: HTMLElement | null }) => void;
  decisionPinned?: boolean;
  onToggleDecisionPin?: (payload: { messageId: string; content: string }) => void;
  onSaveAssetAsProjectNote?: (payload: { messageId: string; target: string; label: string }) => void;
  onSaveSourceToWorkboard?: (payload: { messageId: string; url: string; title: string; description?: string }) => void;
  onAttachAssetToWorkboard?: (payload: { messageId: string; target: string; label: string; kind?: 'web' | 'local' }) => void;
  debugMode?: boolean;
}

function areAssistantReactionsEqual(a?: AssistantReaction[], b?: AssistantReaction[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left.id !== right.id || left.label !== right.label || left.tone !== right.tone) {
      return false;
    }
  }
  return true;
}

function areSavedNoteAssetsEqual(a?: SavedNoteAsset[], b?: SavedNoteAsset[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.id !== right.id
      || left.title !== right.title
      || left.detail !== right.detail
      || left.timestamp !== right.timestamp
    ) {
      return false;
    }
  }
  return true;
}

// Memoized MessageBubble to prevent unnecessary re-renders and markdown re-parsing
const MessageBubble = memo(function MessageBubble({ message, shouldStream = false, isLastMessage = false, isRunning = false, showContinueButton = false, continueLabel, onContinue, isLoading = false, onSavePrompt, onSaveAnswerAsProjectNote, onSaveAnswerAsRtf, assistantAgentName = 'Agent', assistantAgentRoleName, assistantAgentAvatar, assistantAgentAvatarColor, assistantAgentAvatarImageDataUrl, assistantAvatarFrame = 'none', assistantAccentColor, assistantAnswerStyle = 'balanced', relayedSubagentAgentName, relayedSubagentAgentRoleName, relayedSubagentAgentAvatar, relayedSubagentAgentAvatarColor, relayedSubagentAgentAvatarImageDataUrl, relayedSubagentAvatarFrame = 'none', relayedSubagentLabel, assistantReactions = [], savedNoteAssets = [], showAssistantAvatar = true, onToggleAssistantAvatar, onCreatePostcard, decisionPinned = false, onToggleDecisionPin, onSaveAssetAsProjectNote, onSaveSourceToWorkboard, onAttachAssetToWorkboard, debugMode = false }: MessageBubbleProps) {
  const [streamComplete, setStreamComplete] = useState(!shouldStream);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);
  const expandableMeasureRef = useRef<HTMLElement | null>(null);
  const imageDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const isUser = message.type === 'user';
  const isTool = message.type === 'tool';
  const isSystem = message.type === 'system';
  const isAssistant = message.type === 'assistant';
  const relayedSubagentMeta = getRelayedSubagentCompletionMeta(message);
  const isRelayedSubagentCompletion = Boolean(relayedSubagentMeta);
  const toolContent = message.content?.trim() ?? '';
  const showToolOutput = isTool
    && toolContent.length > 0
    && !/^using tool:/i.test(toolContent)
    && !/^tool\s+.+\s+(completed|error)$/i.test(toolContent);
  const assistantReasoningParts = useMemo(
    () => (isAssistant ? splitAssistantReasoningContent(message.content || '') : null),
    [isAssistant, message.content]
  );
  const assistantAnswerContent = assistantReasoningParts?.hasReasoning
    ? assistantReasoningParts.answer
    : message.content;
  const assistantHasReasoning = Boolean(assistantReasoningParts?.hasReasoning);
  const assistantCopyContent = assistantAnswerContent?.trim() || message.content;
  const currentPreviewImage = imagePreview?.images[imagePreview.index] ?? null;
  const assistantFrameClass = assistantAvatarFrame === 'circle'
    ? 'rounded-full'
    : assistantAvatarFrame === 'badge'
      ? 'rounded-2xl ring-2 ring-offset-2 ring-offset-background'
      : assistantAvatarFrame === 'soft'
        ? 'rounded-2xl'
        : 'rounded-xl';
  const relayedSubagentFrameClass = relayedSubagentAvatarFrame === 'circle'
    ? 'rounded-full'
    : relayedSubagentAvatarFrame === 'badge'
      ? 'rounded-2xl ring-2 ring-offset-2 ring-offset-card'
      : relayedSubagentAvatarFrame === 'soft'
        ? 'rounded-2xl'
        : 'rounded-xl';
  const assistantBubbleClass = assistantAnswerStyle === 'concise'
    ? 'px-3 py-2'
    : assistantAnswerStyle === 'detailed'
      ? 'px-5 py-4'
      : assistantAnswerStyle === 'playful'
        ? 'px-4 py-3 shadow-[0_12px_40px_rgba(20,184,166,0.13)]'
        : 'px-4 py-3';
  const assistantAccentStyle = assistantAccentColor && /^#[0-9a-f]{6}$/i.test(assistantAccentColor)
    ? {
        borderColor: `${assistantAccentColor}55`,
        boxShadow: assistantAnswerStyle === 'playful' ? `0 14px 42px ${assistantAccentColor}22` : undefined,
      }
    : undefined;
  const parsedAssistantPlan = useMemo(() => {
    if (!isAssistant || isTool || isSystem || isUser) return null;
    return parsePlanItemsFromAssistantContent(assistantAnswerContent || '');
  }, [assistantAnswerContent, isAssistant, isTool, isSystem, isUser]);

  // Get tool icon from mapping
  const toolName = message.toolName || message.content?.match(/Using tool: (\w+)/)?.[1];
  const ToolIcon = toolName && TOOL_PROGRESS_MAP[toolName]?.icon;

  // Mark stream as complete when shouldStream becomes false
  useEffect(() => {
    if (!shouldStream) {
      setStreamComplete(true);
    }
  }, [shouldStream]);

  useEffect(() => {
    setExpanded(false);
  }, [message.id]);

  const collapsedMaxHeight = 160;
  useLayoutEffect(() => {
    const el = expandableMeasureRef.current;
    const eligible = isTool && showToolOutput;
    if (!el || !eligible) {
      setCanExpand(false);
      return;
    }
    const hasVerticalOverflow = el.scrollHeight > collapsedMaxHeight + 6;
    const hasLongPayload = toolContent.length > 260;
    setCanExpand(hasVerticalOverflow || hasLongPayload);
  }, [message.content, isTool, showToolOutput, collapsedMaxHeight, streamComplete, toolContent]);

  const proseClasses = cn(
    'text-sm prose prose-sm max-w-none overflow-x-auto',
    'prose-headings:text-foreground',
    'prose-p:text-foreground prose-p:my-2',
    'prose-strong:text-foreground prose-strong:font-semibold',
    'prose-em:text-foreground',
    'prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs',
    'prose-pre:bg-muted prose-pre:text-foreground prose-pre:p-3 prose-pre:rounded-lg',
    'prose-ul:text-foreground prose-ol:text-foreground',
    'prose-li:text-foreground prose-li:my-1',
    'prose-a:text-primary prose-a:underline',
    'prose-blockquote:text-muted-foreground prose-blockquote:border-l-4 prose-blockquote:border-border prose-blockquote:pl-4',
    'prose-table:my-3 prose-table:w-full prose-table:border-collapse prose-table:text-sm',
    'prose-thead:border-b prose-thead:border-border',
    'prose-th:border prose-th:border-border prose-th:bg-muted/70 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-foreground prose-th:break-words',
    'prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:align-top prose-td:text-foreground prose-td:break-words',
    'prose-tr:border-border',
    'prose-hr:border-border'
  );

  const handleCopyToClipboard = useCallback(async (preferRichHtml: boolean) => {
    try {
      if (preferRichHtml) {
        const html = buildWordFriendlyClipboardHtml(contentRef.current, assistantCopyContent);
        const rtf = await buildWordFriendlyClipboardRtf(contentRef.current, assistantCopyContent);
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const rtfBlob = new Blob([rtf], { type: 'text/rtf' });
        const textBlob = new Blob([assistantCopyContent], { type: 'text/plain' });
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/rtf': rtfBlob,
              'text/html': htmlBlob,
              'text/plain': textBlob,
            }),
          ]);
        } catch {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': htmlBlob,
              'text/plain': textBlob,
            }),
          ]);
        }
      } else {
        await navigator.clipboard.writeText(message.content);
      }
    } catch {
      // Fallback to plain text when rich copy is unavailable
      await navigator.clipboard.writeText(preferRichHtml ? assistantCopyContent : message.content);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [assistantCopyContent, message.content]);

  const openImagePreview = useCallback((src: string, label: string, gallery?: ImagePreviewItem[]) => {
    const seen = new Set<string>();
    const normalizedSrc = normalizeImagePreviewUrl(src) ?? src;
    const images = (gallery && gallery.length > 0 ? gallery : [{ url: normalizedSrc, label }])
      .map((image) => ({
        url: normalizeImagePreviewUrl(image.url) ?? image.url,
        label: image.label?.trim() || getImagePreviewLabel(image.url),
      }))
      .filter((image) => {
        if (!image.url || seen.has(image.url)) return false;
        seen.add(image.url);
        return true;
      });
    if (!images.some((image) => image.url === normalizedSrc)) {
      images.unshift({ url: normalizedSrc, label });
    }
    const index = Math.max(0, images.findIndex((image) => image.url === normalizedSrc));
    imageDragRef.current = null;
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
    setImagePreview({ images, index });
  }, []);

  const resetImageViewport = useCallback(() => {
    imageDragRef.current = null;
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
  }, []);

  const showImagePreviewIndex = useCallback((index: number) => {
    setImagePreview((current) => {
      if (!current || current.images.length === 0) return current;
      const nextIndex = ((index % current.images.length) + current.images.length) % current.images.length;
      imageDragRef.current = null;
      setImageZoom(1);
      setImagePan({ x: 0, y: 0 });
      return { ...current, index: nextIndex };
    });
  }, []);

  const showPreviousImagePreview = useCallback(() => {
    setImagePreview((current) => {
      if (!current || current.images.length <= 1) return current;
      imageDragRef.current = null;
      setImageZoom(1);
      setImagePan({ x: 0, y: 0 });
      return {
        ...current,
        index: (current.index - 1 + current.images.length) % current.images.length,
      };
    });
  }, []);

  const showNextImagePreview = useCallback(() => {
    setImagePreview((current) => {
      if (!current || current.images.length <= 1) return current;
      imageDragRef.current = null;
      setImageZoom(1);
      setImagePan({ x: 0, y: 0 });
      return {
        ...current,
        index: (current.index + 1) % current.images.length,
      };
    });
  }, []);

  useEffect(() => {
    if (!imagePreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showPreviousImagePreview();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showNextImagePreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imagePreview, showNextImagePreview, showPreviousImagePreview]);

  const zoomImageBy = useCallback((delta: number) => {
    setImageZoom((current) => {
      const next = clampImageZoom(current + delta);
      if (next <= 1) {
        imageDragRef.current = null;
        setImagePan({ x: 0, y: 0 });
      }
      return next;
    });
  }, []);

  const handleImageWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomImageBy(event.deltaY > 0 ? -0.15 : 0.15);
  }, [zoomImageBy]);

  const handleImagePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (imageZoom <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: imagePan.x,
      originY: imagePan.y,
    };
  }, [imagePan.x, imagePan.y, imageZoom]);

  const handleImagePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = imageDragRef.current;
    if (!drag) return;
    event.preventDefault();
    setImagePan({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  }, []);

  const handleImagePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    imageDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const openDocumentLink = useCallback(async (documentLink: AssistantDocumentLink) => {
    if (documentLink.kind === 'web') {
      await getAccomplish().openExternal(documentLink.target);
      return;
    }
    const result = await getAccomplish().openPath(documentLink.target);
    if (!result.ok) throw new Error(result.error || 'Failed to open document.');
  }, []);

  const createMarkdownComponents = useCallback((imageGallery?: ImagePreviewItem[]): Components => ({
    a: ({ href, children, className, ...props }) => {
      const rawHref = typeof href === 'string' ? href.trim() : '';
      if (!rawHref) {
        return <a {...props} className={className}>{children}</a>;
      }

      if (isPreviewableImageHref(rawHref)) {
        const previewHref = normalizeImagePreviewUrl(rawHref) ?? rawHref;
        return (
          <a
            {...props}
            href={rawHref}
            onClick={(event) => {
              event.preventDefault();
              openImagePreview(previewHref, getImagePreviewLabel(previewHref), imageGallery);
            }}
          >
            {children}
          </a>
        );
      }

      if (isDocumentHref(rawHref)) {
        const normalized = normalizeDocumentTarget(rawHref);
        if (normalized) {
          const documentLink: AssistantDocumentLink = {
            ...normalized,
            label: getDocumentLinkLabel(rawHref),
          };
          return (
            <a
              {...props}
              href={rawHref}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-sm font-semibold text-primary underline decoration-primary/50 decoration-2 underline-offset-4 transition-colors hover:text-primary/80 hover:decoration-primary',
                className
              )}
              title={`Open document: ${documentLink.label}`}
              onClick={(event) => {
                event.preventDefault();
                void openDocumentLink(documentLink).catch((error) => {
                  console.warn('Failed to open document link:', error);
                });
              }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{children}</span>
            </a>
          );
        }
      }

      if (isHttpUrl(rawHref)) {
        return (
          <a
            {...props}
            href={rawHref}
            className={className}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void getAccomplish().openExternal(rawHref);
            }}
          >
            {children}
          </a>
        );
      }

      return (
        <a
          {...props}
          href={rawHref}
          className={className}
          onClick={(event) => {
            if (isPreviewableImageHref(rawHref)) {
              const previewHref = normalizeImagePreviewUrl(rawHref) ?? rawHref;
              event.preventDefault();
              openImagePreview(previewHref, getImagePreviewLabel(previewHref), imageGallery);
            }
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, title }) => {
      const rawSrc = typeof src === 'string' ? normalizeImagePreviewUrl(src) : null;
      const label = typeof alt === 'string' && alt.trim()
        ? alt.trim()
        : rawSrc
          ? getImagePreviewLabel(rawSrc)
          : 'Image preview';

      if (!rawSrc) {
        return null;
      }

      return (
        <span className="my-3 block max-w-full">
          <button
            type="button"
            className="block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted/30 p-0 text-left shadow-sm transition-colors hover:border-primary/60"
            title={title || 'Open image preview'}
            onClick={() => openImagePreview(rawSrc, label, imageGallery)}
          >
            <img
              src={rawSrc}
              alt={label}
              className="block max-h-80 max-w-full object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </button>
        </span>
      );
    },
    code: ({ children, className }) => {
      const rawCode = textFromMarkdownChildren(children).trim();
      if (!className && isDocumentHref(rawCode)) {
        const normalized = normalizeDocumentTarget(rawCode);
        if (normalized) {
          const documentLink: AssistantDocumentLink = {
            ...normalized,
            label: getDocumentLinkLabel(rawCode),
          };
          return (
            <a
              href={rawCode}
              className="inline-flex max-w-full items-center gap-1 rounded-sm bg-primary/10 px-1 py-0.5 font-mono text-[0.92em] font-semibold text-primary underline decoration-primary/50 decoration-2 underline-offset-4 transition-colors hover:bg-primary/15 hover:text-primary/80 hover:decoration-primary"
              title={`Open document: ${documentLink.label}`}
              onClick={(event) => {
                event.preventDefault();
                void openDocumentLink(documentLink).catch((error) => {
                  console.warn('Failed to open document link:', error);
                });
              }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{rawCode}</span>
            </a>
          );
        }
      }

      return <code className={className}>{children}</code>;
    },
  }), [openDocumentLink, openImagePreview]);

  const markdownComponents = useMemo<Components>(() => createMarkdownComponents(), [createMarkdownComponents]);

  const renderAssistantLinkPreviewStrip = useCallback((content: string, linkPreviews?: AssistantLinkPreviews): ReactElement | null => {
    const previews = linkPreviews ?? extractAssistantLinkPreviews(content);
    const generatedFileLinks = previews.documentLinks.filter((documentLink) => documentLink.kind === 'local');
    const documentLinks = previews.documentLinks.filter((documentLink) => documentLink.kind === 'web');
    const assetCount = previews.imageLinks.length + documentLinks.length + generatedFileLinks.length + previews.siteLinks.length + savedNoteAssets.length;
    if (assetCount === 0) {
      return null;
    }

    const copyAssetLink = (value: string) => {
      void navigator.clipboard?.writeText(value).catch(() => undefined);
    };

    return (
      <div className="mt-3 rounded-xl border border-border/70 bg-background/55 p-2.5 shadow-sm backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Answer assets
          </div>
          <div className="text-[10px] text-muted-foreground">
            {assetCount} item{assetCount === 1 ? '' : 's'}
          </div>
        </div>
        {previews.imageLinks.length > 0 ? (
          <div className="mb-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <Image className="h-3 w-3" />
              Images
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {previews.imageLinks.map((image) => (
                <div key={image.url} className="group/asset flex w-20 shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    className="group/image relative h-14 w-14 overflow-hidden rounded-md border border-border bg-muted/40 shadow-sm transition-colors hover:border-primary/60"
                    title={image.label}
                    aria-label={`Open image preview: ${image.label}`}
                    onClick={() => openImagePreview(image.url, image.label, previews.imageLinks)}
                  >
                    <span className="absolute inset-0 flex items-center justify-center bg-muted/60 text-muted-foreground">
                      <Image className="h-4 w-4" />
                    </span>
                    <img
                      src={image.url}
                      alt={image.label}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-150 group-hover/image:scale-105"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  </button>
                  {onSaveAssetAsProjectNote ? (
                    <button
                      type="button"
                      className="w-14 rounded-md px-1 py-0.5 text-[10px] font-semibold text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/asset:opacity-100"
                      title="Save image link as a project note"
                      onClick={() => onSaveAssetAsProjectNote({ messageId: message.id, target: image.url, label: image.label })}
                    >
                      Save
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {generatedFileLinks.length > 0 ? (
          <div className="mb-2 space-y-1.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <FolderOpen className="h-3 w-3" />
              Generated files
            </div>
            {generatedFileLinks.map((documentLink) => (
              <div
                key={documentLink.target}
                className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5 text-xs"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-semibold text-primary underline decoration-primary/45 underline-offset-4 transition-colors hover:text-primary/80 hover:decoration-primary"
                  title={`Open file: ${documentLink.label}`}
                  aria-label={`Open file: ${documentLink.label}`}
                  onClick={() => {
                    void openDocumentLink(documentLink).catch((error) => {
                      console.warn('Failed to open generated file link:', error);
                    });
                  }}
                >
                  {documentLink.label}
                </button>
                {onAttachAssetToWorkboard ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    title="Attach generated file to a Workboard item"
                    onClick={() => onAttachAssetToWorkboard({
                      messageId: message.id,
                      target: documentLink.target,
                      label: documentLink.label,
                      kind: documentLink.kind,
                    })}
                  >
                    Attach
                  </button>
                ) : null}
                {onSaveAssetAsProjectNote ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    title="Save generated file link as a project note"
                    onClick={() => onSaveAssetAsProjectNote({ messageId: message.id, target: documentLink.target, label: documentLink.label })}
                  >
                    Save
                  </button>
                ) : null}
                <button
                  type="button"
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="Copy file path"
                  onClick={() => copyAssetLink(documentLink.target)}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {documentLinks.length > 0 ? (
          <div className="mb-2 space-y-1.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <FileText className="h-3 w-3" />
              Documents
            </div>
            {documentLinks.map((documentLink) => (
              <div
                key={documentLink.target}
                className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5 text-xs"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-semibold text-primary underline decoration-primary/45 underline-offset-4 transition-colors hover:text-primary/80 hover:decoration-primary"
                  title={`Open document: ${documentLink.label}`}
                  aria-label={`Open document: ${documentLink.label}`}
                  onClick={() => {
                    void openDocumentLink(documentLink).catch((error) => {
                      console.warn('Failed to open document link:', error);
                    });
                  }}
                >
                  {documentLink.label}
                </button>
                {onAttachAssetToWorkboard ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    title="Attach document link to a Workboard item"
                    onClick={() => onAttachAssetToWorkboard({
                      messageId: message.id,
                      target: documentLink.target,
                      label: documentLink.label,
                      kind: documentLink.kind,
                    })}
                  >
                    Attach
                  </button>
                ) : null}
                {onSaveAssetAsProjectNote ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    title="Save document link as a project note"
                    onClick={() => onSaveAssetAsProjectNote({ messageId: message.id, target: documentLink.target, label: documentLink.label })}
                  >
                    Save
                  </button>
                ) : null}
                <button
                  type="button"
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="Copy document link"
                  onClick={() => copyAssetLink(documentLink.target)}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {previews.siteLinks.length > 0 ? (
          <div className="mb-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <Search className="h-3 w-3" />
              Sources
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {previews.siteLinks.map((site) => (
                <span key={site.host} className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex h-7 max-w-[180px] items-center gap-1.5 rounded-full border border-border bg-card px-2 text-[11px] font-semibold text-muted-foreground shadow-sm transition-colors hover:border-primary/60 hover:bg-muted/80 hover:text-foreground"
                    title={`Open ${site.host}`}
                    aria-label={`Open ${site.host}`}
                    onClick={() => void getAccomplish().openExternal(site.url)}
                  >
                    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[9px] uppercase">
                      <span aria-hidden="true">{site.host[0] || '?'}</span>
                      <img
                        src={site.faviconUrl}
                        alt=""
                        className="absolute h-4 w-4 rounded-full"
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    </span>
                    <span className="truncate">{site.host}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-primary/60 hover:bg-muted/80 hover:text-foreground"
                        title={`Source actions for ${site.host}`}
                        aria-label={`Source actions for ${site.host}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => void getAccomplish().openExternal(site.url)}>
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyAssetLink(site.url)}>
                        Copy link
                      </DropdownMenuItem>
                      {onSaveSourceToWorkboard ? (
                        <DropdownMenuItem
                          onClick={() => onSaveSourceToWorkboard({
                            messageId: message.id,
                            url: site.url,
                            title: site.host,
                            description: `Source from answer: ${site.host}`,
                          })}
                        >
                          Save source
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {savedNoteAssets.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <BookmarkCheck className="h-3 w-3" />
              Saved notes
            </div>
            {savedNoteAssets.map((note) => (
              <div
                key={note.id}
                className="flex min-w-0 items-start gap-2 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5 text-xs"
                title={[note.title, note.detail].filter(Boolean).join('\n')}
              >
                <BookmarkCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-foreground">{note.title}</div>
                  {note.detail ? (
                    <div className="truncate text-[11px] text-muted-foreground">{note.detail}</div>
                  ) : null}
                </div>
                {note.timestamp ? (
                  <div className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(note.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }, [
    message.id,
    onAttachAssetToWorkboard,
    onSaveAssetAsProjectNote,
    onSaveSourceToWorkboard,
    openDocumentLink,
    openImagePreview,
    savedNoteAssets,
  ]);

  const renderAssistantAvatarHeader = (): ReactElement | null => {
    if (!isAssistant || !showAssistantAvatar) return null;
    const avatarIsPicture = isPictureAvatar(assistantAgentAvatar, assistantAgentAvatarImageDataUrl);
    const roleLabel = assistantAgentRoleName?.trim() || 'No role set';
    return (
      <div className="mb-3 flex items-start gap-1.5">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={cn('flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-border/60 bg-muted/60', assistantFrameClass)}
                style={{
                  backgroundColor: assistantAgentAvatarColor ? `${assistantAgentAvatarColor}15` : undefined,
                  boxShadow: assistantAvatarFrame === 'badge' && assistantAccentColor ? `0 0 0 2px ${assistantAccentColor}55` : undefined,
                }}
                aria-label={`${assistantAgentName}, ${roleLabel}`}
              >
                <AgentAvatarIcon
                  avatar={assistantAgentAvatar}
                  color={assistantAgentAvatarColor || 'hsl(var(--primary))'}
                  imageDataUrl={assistantAgentAvatarImageDataUrl}
                  className={avatarIsPicture ? 'h-full w-full' : 'h-7 w-7'}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" align="start" sideOffset={10} className="w-64 p-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn('flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden border border-border/70 bg-muted/70', assistantFrameClass)}
                  style={{ backgroundColor: assistantAgentAvatarColor ? `${assistantAgentAvatarColor}18` : undefined }}
                >
                  <AgentAvatarIcon
                    avatar={assistantAgentAvatar}
                    color={assistantAgentAvatarColor || 'hsl(var(--primary))'}
                    imageDataUrl={assistantAgentAvatarImageDataUrl}
                    className={avatarIsPicture ? 'h-full w-full' : 'h-12 w-12'}
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-popover-foreground">{assistantAgentName}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{roleLabel}</div>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  };

  const renderAssistantFooter = () => (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        {assistantReactions.length > 0 ? (
          <div className="mr-1 flex min-w-0 flex-wrap items-center gap-1">
            {assistantReactions.map((reaction) => (
              <span
                key={reaction.id}
                className={cn(
                  'inline-flex max-w-[150px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  reaction.tone === 'success'
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                    : reaction.tone === 'warning'
                      ? 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                      : 'border-primary/20 bg-primary/10 text-primary'
                )}
                title={reaction.label}
              >
                <Sparkles className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{reaction.label}</span>
              </span>
            ))}
          </div>
        ) : null}
        {onSaveAnswerAsProjectNote ? (
          <button
            type="button"
            onClick={() => onSaveAnswerAsProjectNote({ messageId: message.id, content: assistantCopyContent, sourceElement: contentRef.current })}
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Save this answer as a note on a project work item"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onSaveAnswerAsRtf ? (
          <button
            type="button"
            onClick={() => onSaveAnswerAsRtf({ messageId: message.id, content: assistantCopyContent, sourceElement: contentRef.current })}
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Save this answer as an RTF file and optionally attach it to a work item"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {onCreatePostcard ? (
          <button
            type="button"
            onClick={() => onCreatePostcard({ messageId: message.id, content: assistantCopyContent, sourceElement: contentRef.current })}
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Create a postcard from this answer"
          >
            <Image className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {isAssistant && onToggleDecisionPin ? (
          <button
            type="button"
            onClick={() => onToggleDecisionPin({ messageId: message.id, content: assistantCopyContent })}
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
            title={decisionPinned ? 'Remove pinned decision from Conversation map' : 'Pin this answer as a decision in the Conversation map'}
            aria-label={decisionPinned ? 'Remove pinned decision from Conversation map' : 'Pin this answer as a decision in the Conversation map'}
          >
            {decisionPinned ? (
              <BookmarkCheck className="h-3.5 w-3.5" />
            ) : (
              <Bookmark className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleCopyToClipboard(true)}
          className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
          title={copied ? 'Copied!' : 'Copy final answer'}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        {isAssistant && onToggleAssistantAvatar ? (
          <button
            type="button"
            onClick={() => onToggleAssistantAvatar(!showAssistantAvatar)}
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
            title={showAssistantAvatar ? 'Hide agent avatar on answers' : 'Show agent avatar on answers'}
            aria-label={showAssistantAvatar ? 'Hide agent avatar on answers' : 'Show agent avatar on answers'}
          >
            {showAssistantAvatar ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatMessageDateTime(message.timestamp)}
      </p>
    </div>
  );

  const renderContinueButton = () => (
    isAssistant && showContinueButton && onContinue ? (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="mt-3 inline-flex">
              <Button
                size="sm"
                onClick={onContinue}
                disabled={isLoading}
                className="gap-1.5"
              >
                <Play className="h-3 w-3" />
                {continueLabel || 'Continue'}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-relaxed">
            Continue the same AI session from this answer. Use it if the AI paused, asked a question, or you want it to carry on with the same context. If the answer is already complete, you do not need to press this.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : null
  );

  const renderAssistantReasoningBubble = (
    reasoning: string,
    includeFooter = false
  ): ReactElement | null => {
    if (!reasoning.trim()) return null;
    return (
      <div className="rounded-2xl border border-border/70 bg-muted/90 px-4 py-3 text-muted-foreground shadow-sm backdrop-blur-sm">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Brain className="h-3.5 w-3.5" />
          Reasoning
        </div>
        <div
          ref={includeFooter ? contentRef : undefined}
          className={cn(
            proseClasses,
            'text-muted-foreground',
            'prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-muted-foreground prose-em:text-muted-foreground'
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {normalizeMarkdownTables(reasoning)}
          </ReactMarkdown>
        </div>
        {includeFooter && renderAssistantFooter()}
        {includeFooter && renderContinueButton()}
      </div>
    );
  };

  const renderAssistantAnswerContent = (
    content: string,
    planItems: ParsedPlanItem[] | null,
    linkPreviews?: AssistantLinkPreviews
  ): ReactElement => (
    planItems ? (
      <div ref={contentRef} className="space-y-2 text-sm">
        {planItems.map((item, index) => (
          <div key={`${message.id}:${item.id}:${index}`} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0">
                {item.status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : item.status === 'in_progress' ? (
                  <Clock className="h-4 w-4 text-amber-600" />
                ) : item.status === 'failed' || item.status === 'blocked' ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="whitespace-pre-wrap break-words text-foreground">{item.content}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                  <span className="rounded border border-border/60 bg-background px-1 py-0.5 text-muted-foreground">#{item.id}</span>
                  <span className={cn('rounded px-1 py-0.5', getPlanStatusBadgeClasses(item.status))}>
                    {formatPlanStatus(item.status)}
                  </span>
                  {item.priority ? (
                    <span className={cn('rounded px-1 py-0.5', getPlanPriorityBadgeClasses(item.priority))}>
                      {item.priority}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div ref={contentRef} className={proseClasses}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(linkPreviews?.imageLinks)}>
          {normalizeMarkdownTables(content)}
        </ReactMarkdown>
      </div>
    )
  );

  const renderRelayedSubagentCompletionHeader = (): ReactElement | null => {
    if (!isRelayedSubagentCompletion) return null;
    const subagentName = relayedSubagentAgentName || relayedSubagentMeta?.childAgentId || 'Subagent';
    const subagentDetail = [
      relayedSubagentAgentRoleName,
      relayedSubagentLabel,
    ].filter(Boolean).join(' • ') || 'Subagent';
    const avatarIsPicture = isPictureAvatar(relayedSubagentAgentAvatar, relayedSubagentAgentAvatarImageDataUrl);
    return (
      <div className="mb-3 space-y-2">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Relayed child completion
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-background/75 px-2.5 py-2 text-card-foreground">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden border border-border/70 bg-muted/70',
              relayedSubagentFrameClass
            )}
            style={{ backgroundColor: relayedSubagentAgentAvatarColor ? `${relayedSubagentAgentAvatarColor}18` : undefined }}
            aria-hidden="true"
          >
            <AgentAvatarIcon
              avatar={relayedSubagentAgentAvatar}
              color={relayedSubagentAgentAvatarColor || 'hsl(var(--primary))'}
              imageDataUrl={relayedSubagentAgentAvatarImageDataUrl}
              className={avatarIsPicture ? 'h-full w-full' : 'h-5 w-5'}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{subagentName}</div>
            <div className="truncate text-xs text-muted-foreground">{subagentDetail}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderAssistantAnswerBubble = (
    content: string,
    planItems: ParsedPlanItem[] | null
  ): ReactElement | null => {
    if (!content.trim()) return null;
    const linkPreviews = extractAssistantLinkPreviews(content);
    return (
      <div
        className={cn(
          'rounded-2xl border border-border bg-card transition-colors duration-150 group',
          assistantBubbleClass,
          isRelayedSubagentCompletion
            && 'border-emerald-500/45 bg-card text-card-foreground shadow-[0_10px_34px_rgba(16,185,129,0.16)] ring-1 ring-emerald-500/15'
        )}
        style={assistantAccentStyle}
      >
        {renderAssistantAvatarHeader()}
        {renderRelayedSubagentCompletionHeader()}
        {renderAssistantAnswerContent(content, planItems, linkPreviews)}
        {renderAssistantLinkPreviewStrip(content, linkPreviews)}
        {renderAssistantFooter()}
        {renderContinueButton()}
      </div>
    );
  };

  const renderSplitAssistantContent = (rawContent: string, planItems: ParsedPlanItem[] | null) => {
    const parts = splitAssistantReasoningContent(rawContent);
    const answer = parts.hasReasoning ? parts.answer : rawContent;
    const hasAnswer = answer.trim().length > 0;
    return (
      <>
        {parts.hasReasoning && renderAssistantReasoningBubble(parts.reasoning, !hasAnswer)}
        {hasAnswer && renderAssistantAnswerBubble(answer, planItems)}
      </>
    );
  };

  const renderStandardAssistantContent = (): ReactElement => {
    const linkPreviews = extractAssistantLinkPreviews(message.content);
    return (
      <>
        {renderAssistantAvatarHeader()}
        {shouldStream && !streamComplete ? (
          <StreamingText
            text={message.content}
            speed={120}
            isComplete={streamComplete}
            onComplete={() => setStreamComplete(true)}
          >
            {(streamedText) => {
              const streamedPreviews = extractAssistantLinkPreviews(streamedText);
              return (
                <div ref={contentRef} className={proseClasses}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(streamedPreviews.imageLinks)}>
                    {normalizeMarkdownTables(streamedText)}
                  </ReactMarkdown>
                </div>
              );
            }}
          </StreamingText>
        ) : (
          <>
            {renderRelayedSubagentCompletionHeader()}
            {renderAssistantAnswerContent(message.content, parsedAssistantPlan, linkPreviews)}
          </>
        )}
        {(!shouldStream || streamComplete) && renderAssistantLinkPreviewStrip(message.content, linkPreviews)}
        {renderAssistantFooter()}
        {renderContinueButton()}
      </>
    );
  };

  return (
    <>
      <motion.div
        initial={false}
        className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
      >
        <div
          className={cn(
            'max-w-[85%] transition-colors duration-150',
            assistantHasReasoning
              ? 'space-y-2'
              : cn(
                  'rounded-2xl px-4 py-3',
                  isUser
                    ? 'bg-primary text-primary-foreground'
                    : isTool
                      ? 'bg-muted border border-border'
                      : isSystem
                      ? 'bg-muted/50 border border-border'
                      : cn(
                          'bg-card border border-border',
                          assistantBubbleClass,
                          isRelayedSubagentCompletion
                            && 'border-emerald-500/45 bg-card text-card-foreground shadow-[0_10px_34px_rgba(16,185,129,0.16)] ring-1 ring-emerald-500/15'
                        )
                ),
            (isAssistant || isUser) && 'group'
          )}
          style={isAssistant && !assistantHasReasoning ? assistantAccentStyle : undefined}
        >
        {/* Tool messages: show only label and loading animation */}
        {isTool ? (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
              {ToolIcon ? <ToolIcon className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
              <span>{TOOL_PROGRESS_MAP[toolName || '']?.label || toolName || 'Processing'}</span>
              {isLastMessage && isRunning && (
                <TypingDots />
              )}
            </div>
            {showToolOutput && (
              <>
                <div className="mt-2 relative">
                  <pre
                    ref={(el) => { expandableMeasureRef.current = el; }}
                    className="text-xs text-foreground/90 whitespace-pre-wrap break-words bg-background/70 rounded-md p-2"
                    style={!expanded && canExpand ? { maxHeight: `${collapsedMaxHeight}px`, overflow: 'hidden' } : undefined}
                  >
                    {toolContent}
                  </pre>
                  {!expanded && canExpand && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-muted to-transparent rounded-b-md" />
                  )}
                </div>
                {canExpand && (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-1 text-xs font-medium text-primary hover:text-primary/80"
                  >
                    {expanded ? 'Show less' : 'Show full message'}
                  </button>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {isSystem && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5 font-medium">
                <Terminal className="h-3.5 w-3.5" />
                System
              </div>
            )}
            {isUser ? (
              <>
              <p
                className={cn(
                  'text-sm whitespace-pre-wrap break-words flex-1',
                  'text-primary-foreground'
                )}
              >
                {message.content}
              </p>
              {/* Debug: Attachment processing meta (collapsed) */}
              {debugMode && message.attachments?.some((a) => a.type === 'json' && a.label?.includes('attachment')) && (
                <details className="mt-2 text-[10px]">
                  <summary className="cursor-pointer text-primary-foreground/50 hover:text-primary-foreground/80">
                    Attachment processing details
                  </summary>
                  <div className="mt-1 p-2 rounded bg-black/20 overflow-x-auto">
                    {(() => {
                      const jsonAttachment = message.attachments?.find((a) => a.type === 'json' && a.label?.includes('attachment'));
                      if (!jsonAttachment) return null;
                      try {
                        const meta = JSON.parse(jsonAttachment.data) as Array<{ id?: string; fileName: string; filePath?: string; size: number; contentHash?: string; mode: string; status: string }>;
                        return (
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-primary-foreground/40">
                                <th className="pr-3 pb-1">File</th>
                                <th className="pr-3 pb-1">Size</th>
                                <th className="pr-3 pb-1">Mode</th>
                                <th className="pr-3 pb-1">Status</th>
                                <th className="pb-1">Hash</th>
                              </tr>
                            </thead>
                            <tbody>
                              {meta.map((m, i) => (
                                <tr key={m.id || i} className="text-primary-foreground/70">
                                  <td className="pr-3 py-0.5 font-mono" title={m.filePath || m.fileName}>{m.fileName}</td>
                                  <td className="pr-3 py-0.5">{m.size > 0 ? `${(m.size / 1024).toFixed(1)} KB` : '-'}</td>
                                  <td className="pr-3 py-0.5">{m.mode}</td>
                                  <td className="pr-3 py-0.5">{m.status}</td>
                                  <td className="py-0.5 font-mono" title={m.contentHash}>{m.contentHash ? m.contentHash.slice(0, 8) : '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        );
                      } catch { return <span className="text-primary-foreground/40">Failed to parse meta</span>; }
                    })()}
                  </div>
                </details>
              )}
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {onSavePrompt && (
                    <button
                      type="button"
                      onClick={() => {
                        onSavePrompt(message.content);
                        setSaved(true);
                        setTimeout(() => setSaved(false), 2000);
                      }}
                      className="shrink-0 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-primary-foreground/20 text-primary-foreground/70 hover:text-primary-foreground transition-all duration-200"
                      title={saved ? 'Saved!' : 'Save this prompt'}
                    >
                      {saved ? (
                        <BookmarkCheck className="h-4 w-4" />
                      ) : (
                        <Bookmark className="h-4 w-4" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCopyToClipboard(false)}
                    className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-primary-foreground/20 text-primary-foreground/70 hover:text-primary-foreground"
                    title={copied ? 'Copied!' : 'Copy to clipboard'}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-primary-foreground/70">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </p>
              </div>
              </>
            ) : isAssistant ? (
              assistantHasReasoning ? (
                shouldStream && !streamComplete ? (
                  <StreamingText
                    text={message.content}
                    speed={120}
                    isComplete={streamComplete}
                    onComplete={() => setStreamComplete(true)}
                  >
                    {(streamedText) => renderSplitAssistantContent(streamedText, null)}
                  </StreamingText>
                ) : (
                  renderSplitAssistantContent(message.content, parsedAssistantPlan)
                )
              ) : (
                renderStandardAssistantContent()
              )
            ) : (
              <>
                <div className={proseClasses}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {normalizeMarkdownTables(message.content)}
                  </ReactMarkdown>
                </div>
                <p className="text-xs mt-1.5 text-muted-foreground">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </p>
              </>
            )}
          </>
        )}
        </div>
      </motion.div>
      <Dialog
        open={Boolean(imagePreview)}
        onOpenChange={(open) => {
          if (!open) setImagePreview(null);
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-[min(92vw,1100px)] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-4 py-3 pr-12">
            <DialogTitle className="truncate text-base">Image preview</DialogTitle>
            <DialogDescription className="truncate">
              {currentPreviewImage?.label || currentPreviewImage?.url || 'Image'}
              {imagePreview && imagePreview.images.length > 1
                ? ` (${imagePreview.index + 1} of ${imagePreview.images.length})`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div
            className={cn(
              'relative flex h-[calc(88vh-13rem)] min-h-[280px] select-none items-center justify-center overflow-hidden bg-black/70 p-3',
              imageZoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
            )}
            onWheel={handleImageWheel}
            onPointerDown={handleImagePointerDown}
            onPointerMove={handleImagePointerMove}
            onPointerUp={handleImagePointerEnd}
            onPointerCancel={handleImagePointerEnd}
            onDoubleClick={() => {
              if (imageZoom > 1) {
                resetImageViewport();
              } else {
                setImageZoom(2);
              }
            }}
          >
            {imagePreview && imagePreview.images.length > 1 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="absolute left-3 top-1/2 z-10 h-9 w-9 -translate-y-1/2 rounded-full bg-background/85 px-0 backdrop-blur"
                  title="Previous image"
                  aria-label="Previous image"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    showPreviousImagePreview();
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="absolute right-3 top-1/2 z-10 h-9 w-9 -translate-y-1/2 rounded-full bg-background/85 px-0 backdrop-blur"
                  title="Next image"
                  aria-label="Next image"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    showNextImagePreview();
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            ) : null}
            {currentPreviewImage ? (
              <img
                src={currentPreviewImage.url}
                alt={currentPreviewImage.label}
                draggable={false}
                className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
                referrerPolicy="no-referrer"
                style={{
                  transform: `translate3d(${imagePan.x}px, ${imagePan.y}px, 0) scale(${imageZoom})`,
                  transformOrigin: 'center',
                }}
              />
            ) : null}
          </div>
          {imagePreview && imagePreview.images.length > 1 ? (
            <div className="flex gap-1.5 overflow-x-auto border-t border-border bg-background px-4 py-2">
              {imagePreview.images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  className={cn(
                    'relative h-10 w-10 shrink-0 overflow-hidden rounded border bg-muted',
                    index === imagePreview.index ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/60'
                  )}
                  title={image.label}
                  aria-label={`Show image ${index + 1}: ${image.label}`}
                  onClick={() => showImagePreviewIndex(index)}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Image className="h-3.5 w-3.5" />
                  </span>
                  <img
                    src={image.url}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                </button>
              ))}
            </div>
          ) : null}
          <DialogFooter className="items-center justify-between gap-2 border-t border-border bg-background px-4 pb-5 pt-3 sm:justify-between sm:space-x-0">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 px-0"
                title="Zoom out"
                aria-label="Zoom out"
                onClick={() => zoomImageBy(-0.25)}
                disabled={imageZoom <= 0.5}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(imageZoom * 100)}%
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 px-0"
                title="Zoom in"
                aria-label="Zoom in"
                onClick={() => zoomImageBy(0.25)}
                disabled={imageZoom >= 6}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 px-0"
                title="Reset view"
                aria-label="Reset view"
                onClick={resetImageViewport}
                disabled={imageZoom === 1 && imagePan.x === 0 && imagePan.y === 0}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (currentPreviewImage?.url && isHttpUrl(currentPreviewImage.url)) {
                    void getAccomplish().openExternal(currentPreviewImage.url);
                  }
                }}
                disabled={!currentPreviewImage?.url || !isHttpUrl(currentPreviewImage.url)}
              >
                Open externally
              </Button>
              <Button type="button" onClick={() => setImagePreview(null)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}, (prev, next) => (
  prev.message.id === next.message.id
  && prev.message.type === next.message.type
  && prev.message.content === next.message.content
  && prev.message.timestamp === next.message.timestamp
  && prev.message.toolName === next.message.toolName
  && prev.message.toolInput === next.message.toolInput
  && prev.shouldStream === next.shouldStream
  && prev.isLastMessage === next.isLastMessage
  && prev.isRunning === next.isRunning
  && prev.showContinueButton === next.showContinueButton
  && prev.isLoading === next.isLoading
  && prev.debugMode === next.debugMode
  && prev.onSaveAnswerAsProjectNote === next.onSaveAnswerAsProjectNote
  && prev.onSaveAnswerAsRtf === next.onSaveAnswerAsRtf
  && prev.assistantAgentName === next.assistantAgentName
  && prev.assistantAgentRoleName === next.assistantAgentRoleName
  && prev.assistantAgentAvatar === next.assistantAgentAvatar
  && prev.assistantAgentAvatarColor === next.assistantAgentAvatarColor
  && prev.assistantAgentAvatarImageDataUrl === next.assistantAgentAvatarImageDataUrl
  && prev.assistantAvatarFrame === next.assistantAvatarFrame
  && prev.assistantAccentColor === next.assistantAccentColor
  && prev.assistantAnswerStyle === next.assistantAnswerStyle
  && areAssistantReactionsEqual(prev.assistantReactions, next.assistantReactions)
  && areSavedNoteAssetsEqual(prev.savedNoteAssets, next.savedNoteAssets)
  && prev.showAssistantAvatar === next.showAssistantAvatar
  && prev.onToggleAssistantAvatar === next.onToggleAssistantAvatar
  && prev.onCreatePostcard === next.onCreatePostcard
  && prev.decisionPinned === next.decisionPinned
  && prev.onToggleDecisionPin === next.onToggleDecisionPin
  && prev.onSaveAssetAsProjectNote === next.onSaveAssetAsProjectNote
  && prev.onSaveSourceToWorkboard === next.onSaveSourceToWorkboard
  && prev.onAttachAssetToWorkboard === next.onAttachAssetToWorkboard
));
