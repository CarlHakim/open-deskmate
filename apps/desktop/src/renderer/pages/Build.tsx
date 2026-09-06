import { preserveEquivalentSubagentRunReferences, preserveEquivalentSubagentTreeReferences } from '../lib/subagent-presentation';
import { AnswerActions, AnswerActionsProvider } from '../components/chat/AnswerActions';
import { focusSceneBackground } from '../components/chat/FocusScene';
import { useFocusSceneStore } from '../stores/focusSceneStore';
import { getChatBackground, readChatBackgroundId } from '../lib/chat-backgrounds';
import { AgentCharacterButton, AgentCharacterProvider } from '../components/agents/AgentCharacterCard';
import { TaskJourney, AnswerHighlight } from '../components/chat/TaskJourney';
import { GuidanceContext } from '../components/chat/GuidanceChoices';
import BuildSubagentTreeList from '../components/subagents/SubagentTreeList';
import { useSubagentRefresh } from '../hooks/useSubagentRefresh';
import { isBuildTaskActive, useBuildTaskActivity } from '../hooks/useBuildTaskActivity';
import { BuildTooltip, canonicalizeWorkspaceRelativePath, getFileExtension, getFileIcon, TreeNode, WorkspaceTreeClipboardEntry } from '../components/build/BuildFileTree';
import { BuildPresetFieldHelp, BuildPromptComposer } from '../components/build/BuildPromptComposer';
import { BuildTerminalPane } from '../components/build/BuildTerminalPane';
import { useVisiblePolling } from '../hooks/useVisiblePolling';
import { buildSubagentPartSignature, canRequestSubagentRecovery, compactSubagentTextSignature, formatSubagentElapsed, formatSubagentModeLabel, formatSubagentProgressEvent, formatSubagentRunStatus, formatSubagentUpdatedAge, getRelayedSubagentCompletionMeta, getSubagentBuildHandoffSignature, getSubagentBuildHandoffSummary, getSubagentInheritedContextSignature, getSubagentLatestActivitySummary, getSubagentProgressEventsSignature, getSubagentRecoveryHistorySignature, getSubagentRecoverySummary, getSubagentResultBundleSignature, getSubagentResultBundleSummary, getSubagentRunIndicators, getSubagentRunStatusClasses, getSubagentSharedContextSignature, getSubagentSupervisorSignature, hashForRenderVersion, isActiveSubagentRun, isRelayedSubagentCompletionMessage } from '../lib/subagent-presentation';
import { normalizeFsPath, pathLeaf } from '../lib/workspace-paths';
'use client';

import BuildProjectWorkPopup from '@/components/build/BuildProjectWorkPopup';
import AgentToolStateIndicator, {
getLatestToolPresenceFromMessages,
getToolActivityStepsFromMessages,
} from '@/components/chat/AgentToolStateIndicator';
import PromptNavigator, { createPromptPreview, type PromptNavigatorEntry } from '@/components/chat/PromptNavigator';
import { AgentAvatarIcon } from '@/components/layout/AgentAvatarPicker';
import ModeSwitch from '@/components/layout/ModeSwitch';
import SavedPromptsDialog from '@/components/layout/SavedPromptsDialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/contexts/ThemeContext';
import { usePluginSlashCommands } from '@/hooks/usePluginSlashCommands';
import { getAccomplish } from '@/lib/accomplish';
import { isAgentCharacterAvatar } from '@/lib/agent-character-gallery';
import { APP_COMMAND_EVENTS, createAppSlashCommands } from '@/lib/app-commands';
import { buildAiTestsInstruction } from '@/lib/build-ai-tests-instruction';
import {
BUILD_RECIPE_CATEGORIES,
BUILD_RECIPES,
type BuildRecipeCategory,
} from '@/lib/build-recipes';
import { normalizeMarkdownTables } from '@/lib/markdown-tables';
import { mergePromptCategories } from '@/lib/prompt-categories';
import { buildWordFriendlyRtfWithRenderedIcons } from '@/lib/rich-text-export';
import {
normalizeSelectedModel,
SELECTED_MODEL_CHANGED_EVENT,
} from '@/lib/selected-model-events';
import { type SlashCommandDefinition } from '@/lib/slash-commands';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';
import { useSavedPromptsStore } from '@/stores/savedPromptsStore';
import { useTopBarControls } from '@/stores/topBarControlsStore';
import { useUsageProjectStore } from '@/stores/usageProjectStore';
import type {
BuildDiffEnforcementMode,
BuildEnvProfile,
BuildFileTreeNode,
BuildGitConflictFile,
BuildGitMismatchSummary,
BuildGitRemoteProvider,
BuildGitResolveMismatchAction,
BuildGitStashEntry,
BuildGitSummary,
BuildLogEntry,
BuildProjectPreset,
BuildQualityCheckRun,
BuildSessionSnapshot,
BuildStartEntry,
BuildTaskSession,
BuildTaskSessionListItem,
BuildTerminalSessionSummary,
BuildTerminalSnapshot,
BuildWorkspaceDiff,
BuildWorkspaceDiffFileContent,
BuildWorkspaceFingerprint,
ContextWindowEstimateResponse,
ProviderConfig,
SelectedModel,
SubagentRunRecord,
SubagentRunTreeNode,
Task,
TaskMessage,
TaskStatus,
UsageProject,
UsageProjectWorkItem,
UsageProjectWorkItemDocumentLink,
UsageProjectWorkItemNote
} from '@accomplish/shared';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import type { Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import {
AlertCircle,
Archive,
ArrowRight,
Brain,
Check,
CheckCircle2,
ChevronDown,
ChevronRight,
ChevronsUpDown,
Circle,
Clipboard,
ClipboardList,
Code,
Copy,
Download,
Edit3,
ExternalLink,
Eye,
FileDiff,
FilePlus,
FileText,
Folder,
FolderOpen,
FolderPlus,
GitBranch,
Github,
GripVertical,
History,
Info,
Loader2,
Lock,
Maximize2,
Minimize2,
Minus,
MousePointer2,
PanelBottomClose,
Paperclip,
Play,
Plus,
Redo2,
RefreshCw,
RotateCcw,
Save,
Scissors,
Search,
Square,
Star,
Terminal as TerminalIcon,
Trash2,
Triangle,
Type,
Undo2,
UploadCloud,
Wrench,
X,
ZoomIn,
ZoomOut
} from 'lucide-react';
import type { ComponentProps, ReactElement, MouseEvent as ReactMouseEvent, ReactNode, UIEvent as ReactUIEvent } from 'react';
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { AnswerScope, interactiveMarkdownComponents } from '../components/chat/InteractiveAnswer';
import PreviewComparison from '../components/build/PreviewComparison';
import { useLocation, useNavigate } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import remarkGfm from 'remark-gfm';
import 'xterm/css/xterm.css';

const TERMINAL_TASK_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const BUILD_PROMPT_NAVIGATOR_STORAGE_KEY = 'opendeskmate:prompt-navigator:build-visible';

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
  xai: 'xAI',
  ollama: 'Ollama',
};
const BUILD_CENTER_PANEL_MIN_HEIGHT = 180;
const BUILD_LOWER_PANEL_MIN_HEIGHT = 160;
const BUILD_CENTER_PANEL_SPLITTER_HEIGHT = 8;
const BUILD_WORKSPACE_PANEL_DEFAULT_WIDTH = 280;
const BUILD_WORKSPACE_PANEL_MIN_WIDTH = 220;
const BUILD_WORKSPACE_PANEL_MAX_WIDTH = 520;
const BUILD_OPERATOR_PANEL_DEFAULT_WIDTH = 420;
const BUILD_OPERATOR_PANEL_MIN_WIDTH = 320;
const BUILD_OPERATOR_PANEL_MAX_WIDTH = 720;
const BUILD_TERMINAL_PANEL_DEFAULT_WIDTH = 460;
const BUILD_TERMINAL_PANEL_MIN_WIDTH = 280;
const BUILD_RUNTIME_LOGS_PANEL_DEFAULT_WIDTH = 340;
const BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH = 260;
const BUILD_DIFF_PANEL_MIN_WIDTH = 320;
const BUILD_RUNNING_GIT_SUMMARY_REFRESH_INTERVAL_MS = 6000;
const BUILD_RUNNING_GIT_DIFF_MAX_CHARS = 80_000;
const BUILD_TOOL_STATE_MESSAGE_SCAN_LIMIT = 80;
const BUILD_LOWER_PANEL_GRID_GAP = 12;
const BUILD_RUNTIME_GET_WORKSPACE_SWITCH_ERROR = "Error invoking remote method 'build-mode:runtime:get': Error: Cannot switch workspace path while process is running. Stop runtime first.";
const BUILD_HOVER_TOOLTIP_ATTR = 'data-build-hover-tooltip';
const BUILD_RESTORED_RUNTIME_LOG_LIMIT = 250;
const BUILD_SUBAGENTS_PANEL_MAX_HEIGHT = 136;

type BuildSectionKey = 'workspace' | 'runtimePreview' | 'terminal' | 'runtimeLogs' | 'diff';
type BuildHiddenSectionLocks = Partial<Record<BuildSectionKey, boolean>>;
const BUILD_SECTION_KEYS: BuildSectionKey[] = ['workspace', 'runtimePreview', 'terminal', 'runtimeLogs', 'diff'];

type RuntimeScreenshotSelection = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type RuntimeScreenshotLineStyle = 'solid' | 'dashed' | 'dotted';
type RuntimeScreenshotTool = 'select' | 'draw' | 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'text';
type RuntimeScreenshotResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';
const RUNTIME_SCREENSHOT_STROKE_WIDTH_PRESETS = [
  { label: 'Thin', value: 1 },
  { label: 'Regular', value: 2 },
  { label: 'Thick', value: 4 },
  { label: 'Heavy', value: 8 },
];
const RUNTIME_SCREENSHOT_COLOR_SWATCHES = [
  '#000000',
  '#ffffff',
  '#64748b',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
];

type RuntimeScreenshotAnnotation =
  | {
      id: string;
      type: 'freehand';
      outlineColor: string;
      strokeWidth: number;
      strokeStyle: RuntimeScreenshotLineStyle;
      points: Array<{ x: number; y: number }>;
    }
  | {
      id: string;
      type: 'shape';
      shape: 'rectangle' | 'ellipse' | 'triangle';
      outlineColor: string;
      fillColor: string;
      fillOpacity: number;
      strokeWidth: number;
      strokeStyle: RuntimeScreenshotLineStyle;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      id: string;
      type: 'connector';
      connector: 'line' | 'arrow';
      outlineColor: string;
      strokeWidth: number;
      strokeStyle: RuntimeScreenshotLineStyle;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | { id: string; type: 'text'; color: string; text: string; x: number; y: number; fontSize: number; width: number; height: number };

type RuntimeScreenshotEditorState = {
  baseDataUrl: string;
  annotations: RuntimeScreenshotAnnotation[];
  tool: RuntimeScreenshotTool;
  selectedAnnotationId: string | null;
  outlineColor: string;
  outlineEnabled: boolean;
  fillColor: string;
  fillOpacity: number;
  strokeWidth: number;
  strokeStyle: RuntimeScreenshotLineStyle;
  text: string;
  width: number;
  height: number;
  notice: string | null;
  busy: boolean;
};

type RuntimeScreenshotEditorHistorySnapshot = Pick<
  RuntimeScreenshotEditorState,
  | 'annotations'
  | 'tool'
  | 'selectedAnnotationId'
  | 'outlineColor'
  | 'outlineEnabled'
  | 'fillColor'
  | 'fillOpacity'
  | 'strokeWidth'
  | 'strokeStyle'
  | 'text'
>;

const RUNTIME_SCREENSHOT_HISTORY_LIMIT = 60;
const RUNTIME_SCREENSHOT_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const RUNTIME_SCREENSHOT_TEXT_BOX_MIN_WIDTH = 96;
const RUNTIME_SCREENSHOT_TEXT_BOX_MIN_HEIGHT = 34;
const RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_X = 6;
const RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_TOP = 6;

function cloneRuntimeScreenshotAnnotation(annotation: RuntimeScreenshotAnnotation): RuntimeScreenshotAnnotation {
  if (annotation.type === 'freehand') {
    return { ...annotation, points: annotation.points.map((point) => ({ ...point })) };
  }
  return { ...annotation };
}

function runtimeScreenshotTextBoxHeight(annotation: Extract<RuntimeScreenshotAnnotation, { type: 'text' }>): number {
  return Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_HEIGHT, annotation.height || RUNTIME_SCREENSHOT_TEXT_BOX_MIN_HEIGHT);
}

function runtimeScreenshotTextBoxWidth(annotation: Extract<RuntimeScreenshotAnnotation, { type: 'text' }>): number {
  return Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_WIDTH, annotation.width || RUNTIME_SCREENSHOT_TEXT_BOX_MIN_WIDTH);
}

function runtimeScreenshotWrapTextLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/(\s+)/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine}${word}` : word.trimStart();
      if (currentLine && context.measureText(candidate).width > maxWidth) {
        lines.push(currentLine.trimEnd());
        currentLine = word.trimStart();
      } else {
        currentLine = candidate;
      }
    }
    lines.push(currentLine.trimEnd());
  }
  return lines;
}

function runtimeScreenshotEditorHistorySnapshot(editor: RuntimeScreenshotEditorState): RuntimeScreenshotEditorHistorySnapshot {
  return {
    annotations: editor.annotations.map(cloneRuntimeScreenshotAnnotation),
    tool: editor.tool,
    selectedAnnotationId: editor.selectedAnnotationId,
    outlineColor: editor.outlineColor,
    outlineEnabled: editor.outlineEnabled,
    fillColor: editor.fillColor,
    fillOpacity: editor.fillOpacity,
    strokeWidth: editor.strokeWidth,
    strokeStyle: editor.strokeStyle,
    text: editor.text,
  };
}

function runtimeScreenshotEditorFromHistorySnapshot(
  editor: RuntimeScreenshotEditorState,
  snapshot: RuntimeScreenshotEditorHistorySnapshot
): RuntimeScreenshotEditorState {
  return {
    ...editor,
    ...snapshot,
    annotations: snapshot.annotations.map(cloneRuntimeScreenshotAnnotation),
    notice: null,
  };
}

function runtimeScreenshotHistorySnapshotKey(snapshot: RuntimeScreenshotEditorHistorySnapshot): string {
  return JSON.stringify(snapshot);
}

function runtimeScreenshotDashPattern(style: RuntimeScreenshotLineStyle, width: number): number[] {
  if (style === 'dashed') return [Math.max(4, width * 4), Math.max(3, width * 2.5)];
  if (style === 'dotted') return [Math.max(1, width), Math.max(3, width * 2.5)];
  return [];
}

function applyRuntimeScreenshotStrokeStyle(
  context: CanvasRenderingContext2D,
  style: RuntimeScreenshotLineStyle,
  width: number
) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash(runtimeScreenshotDashPattern(style, width));
}

function runtimeScreenshotTrianglePath(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  context.moveTo((left + right) / 2, top);
  context.lineTo(right, bottom);
  context.lineTo(left, bottom);
  context.closePath();
}

function drawRuntimeScreenshotArrowHead(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(8, width * 4);
  context.save();
  context.setLineDash([]);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  context.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
  context.restore();
}

function runtimeScreenshotAnnotationBounds(annotation: RuntimeScreenshotAnnotation): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  if (annotation.type === 'freehand') {
    const pad = Math.max(8, annotation.strokeWidth + 4);
    const xs = annotation.points.map((point) => point.x);
    const ys = annotation.points.map((point) => point.y);
    return {
      left: Math.min(...xs) - pad,
      top: Math.min(...ys) - pad,
      right: Math.max(...xs) + pad,
      bottom: Math.max(...ys) + pad,
    };
  }
  if (annotation.type === 'text') {
    const width = runtimeScreenshotTextBoxWidth(annotation);
    const height = runtimeScreenshotTextBoxHeight(annotation);
    return {
      left: annotation.x - RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_X,
      top: annotation.y - annotation.fontSize - RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_TOP,
      right: annotation.x - RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_X + width,
      bottom: annotation.y - annotation.fontSize - RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_TOP + height,
    };
  }
  return {
    left: Math.min(annotation.x1, annotation.x2) - Math.max(6, annotation.strokeWidth + 3),
    top: Math.min(annotation.y1, annotation.y2) - Math.max(6, annotation.strokeWidth + 3),
    right: Math.max(annotation.x1, annotation.x2) + Math.max(6, annotation.strokeWidth + 3),
    bottom: Math.max(annotation.y1, annotation.y2) + Math.max(6, annotation.strokeWidth + 3),
  };
}

function runtimeScreenshotPointToSegmentDistance(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function runtimeScreenshotPointDistance(
  first: { x: number; y: number },
  second: { x: number; y: number }
): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function appendRuntimeScreenshotFreehandPoints(
  existingPoints: Array<{ x: number; y: number }>,
  nextPoints: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (nextPoints.length === 0) return existingPoints;
  const points = [...existingPoints];
  for (const point of nextPoints) {
    const previous = points[points.length - 1];
    if (!previous) {
      points.push(point);
      continue;
    }
    const distance = runtimeScreenshotPointDistance(previous, point);
    if (distance < 1.25) continue;
    const steps = distance > 8 ? Math.max(1, Math.ceil(distance / 5)) : 1;
    for (let index = 1; index <= steps; index += 1) {
      points.push({
        x: previous.x + ((point.x - previous.x) * index) / steps,
        y: previous.y + ((point.y - previous.y) * index) / steps,
      });
    }
  }
  return points;
}

function runtimeScreenshotAnnotationContainsPoint(
  annotation: RuntimeScreenshotAnnotation,
  point: { x: number; y: number }
): boolean {
  const bounds = runtimeScreenshotAnnotationBounds(annotation);
  if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return false;
  if (annotation.type === 'connector') {
    return runtimeScreenshotPointToSegmentDistance(point.x, point.y, annotation.x1, annotation.y1, annotation.x2, annotation.y2) <= Math.max(10, annotation.strokeWidth + 6);
  }
  if (annotation.type === 'freehand') {
    for (let index = 1; index < annotation.points.length; index += 1) {
      const previous = annotation.points[index - 1];
      const current = annotation.points[index];
      if (runtimeScreenshotPointToSegmentDistance(point.x, point.y, previous.x, previous.y, current.x, current.y) <= Math.max(10, annotation.strokeWidth + 6)) {
        return true;
      }
    }
    return annotation.points.length <= 1;
  }
  return true;
}

function runtimeScreenshotResizeHandlePoints(annotation: RuntimeScreenshotAnnotation): Array<[RuntimeScreenshotResizeHandle, number, number]> {
  if (annotation.type === 'connector') {
    return [
      ['start', annotation.x1, annotation.y1],
      ['end', annotation.x2, annotation.y2],
    ];
  }
  if (annotation.type !== 'shape') return [];

  const left = Math.min(annotation.x1, annotation.x2);
  const right = Math.max(annotation.x1, annotation.x2);
  const top = Math.min(annotation.y1, annotation.y2);
  const bottom = Math.max(annotation.y1, annotation.y2);
  return [
    ['nw', left, top],
    ['ne', right, top],
    ['sw', left, bottom],
    ['se', right, bottom],
  ];
}

function runtimeScreenshotResizeHandleAtPoint(
  annotation: RuntimeScreenshotAnnotation,
  point: { x: number; y: number },
  tolerance: number
): RuntimeScreenshotResizeHandle | null {
  if (annotation.type === 'freehand' || annotation.type === 'text') return null;
  for (const [handle, x, y] of runtimeScreenshotResizeHandlePoints(annotation)) {
    const isConnectorHandle = handle === 'start' || handle === 'end';
    const hit = isConnectorHandle
      ? Math.hypot(point.x - x, point.y - y) <= tolerance
      : Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance;
    if (hit) {
      return handle;
    }
  }
  return null;
}

function resizeRuntimeScreenshotAnnotation(
  annotation: RuntimeScreenshotAnnotation,
  handle: RuntimeScreenshotResizeHandle,
  point: { x: number; y: number }
): RuntimeScreenshotAnnotation {
  if (annotation.type === 'connector') {
    if (handle === 'start') return { ...annotation, x1: point.x, y1: point.y };
    if (handle === 'end') return { ...annotation, x2: point.x, y2: point.y };
    return annotation;
  }
  if (annotation.type !== 'shape') return annotation;

  const x1IsLeft = annotation.x1 <= annotation.x2;
  const y1IsTop = annotation.y1 <= annotation.y2;
  const patch: Partial<Extract<RuntimeScreenshotAnnotation, { type: 'shape' }>> = {};
  if (handle === 'nw' || handle === 'sw') {
    if (x1IsLeft) patch.x1 = point.x;
    else patch.x2 = point.x;
  }
  if (handle === 'ne' || handle === 'se') {
    if (x1IsLeft) patch.x2 = point.x;
    else patch.x1 = point.x;
  }
  if (handle === 'nw' || handle === 'ne') {
    if (y1IsTop) patch.y1 = point.y;
    else patch.y2 = point.y;
  }
  if (handle === 'sw' || handle === 'se') {
    if (y1IsTop) patch.y2 = point.y;
    else patch.y1 = point.y;
  }
  return { ...annotation, ...patch };
}

function offsetRuntimeScreenshotAnnotation(
  annotation: RuntimeScreenshotAnnotation,
  dx: number,
  dy: number
): RuntimeScreenshotAnnotation {
  if (annotation.type === 'freehand') {
    return { ...annotation, points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  }
  if (annotation.type === 'text') {
    return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
  return { ...annotation, x1: annotation.x1 + dx, y1: annotation.y1 + dy, x2: annotation.x2 + dx, y2: annotation.y2 + dy };
}

function duplicateRuntimeScreenshotAnnotation(annotation: RuntimeScreenshotAnnotation, offset: number): RuntimeScreenshotAnnotation {
  return {
    ...offsetRuntimeScreenshotAnnotation(cloneRuntimeScreenshotAnnotation(annotation), offset, offset),
    id: `copy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  } as RuntimeScreenshotAnnotation;
}

function runtimeScreenshotControlPatchForAnnotation(annotation: RuntimeScreenshotAnnotation): Partial<RuntimeScreenshotEditorState> {
  if (annotation.type === 'text') {
    return {
      fillColor: annotation.color,
      strokeWidth: Math.max(1, Math.round(annotation.fontSize / 5)),
      text: annotation.text,
    };
  }
  if (annotation.type === 'shape') {
    return {
      outlineColor: annotation.outlineColor,
      outlineEnabled: annotation.outlineColor !== 'transparent' && annotation.strokeWidth > 0,
      fillColor: annotation.fillColor,
      fillOpacity: annotation.fillOpacity,
      strokeWidth: annotation.strokeWidth,
      strokeStyle: annotation.strokeStyle,
    };
  }
  return {
    outlineColor: annotation.outlineColor,
    outlineEnabled: annotation.outlineColor !== 'transparent' && annotation.strokeWidth > 0,
    strokeWidth: annotation.strokeWidth,
    strokeStyle: annotation.strokeStyle,
  };
}

function drawRuntimeScreenshotAnnotations(
  context: CanvasRenderingContext2D,
  editor: RuntimeScreenshotEditorState,
  showSelection = true,
  hiddenAnnotationId: string | null = null
) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const annotation of editor.annotations) {
    if (annotation.id === hiddenAnnotationId) continue;
    if (annotation.type === 'freehand') {
      if (annotation.points.length === 0) continue;
      if (annotation.outlineColor === 'transparent' || annotation.strokeWidth <= 0) continue;
      context.beginPath();
      context.strokeStyle = annotation.outlineColor;
      context.lineWidth = annotation.strokeWidth;
      applyRuntimeScreenshotStrokeStyle(context, annotation.strokeStyle, annotation.strokeWidth);
      context.moveTo(annotation.points[0].x, annotation.points[0].y);
      for (let pointIndex = 1; pointIndex < annotation.points.length; pointIndex += 1) {
        const point = annotation.points[pointIndex];
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    } else if (annotation.type === 'shape') {
      const left = Math.min(annotation.x1, annotation.x2);
      const top = Math.min(annotation.y1, annotation.y2);
      const width = Math.abs(annotation.x2 - annotation.x1);
      const height = Math.abs(annotation.y2 - annotation.y1);
      context.beginPath();
      if (annotation.shape === 'rectangle') {
        context.rect(left, top, width, height);
      } else if (annotation.shape === 'ellipse') {
        context.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      } else {
        runtimeScreenshotTrianglePath(context, annotation.x1, annotation.y1, annotation.x2, annotation.y2);
      }
      if (annotation.fillColor !== 'transparent' && annotation.fillOpacity > 0) {
        context.save();
        context.globalAlpha = annotation.fillOpacity;
        context.fillStyle = annotation.fillColor;
        context.fill();
        context.restore();
      }
      if (annotation.outlineColor !== 'transparent' && annotation.strokeWidth > 0) {
        context.strokeStyle = annotation.outlineColor;
        context.lineWidth = annotation.strokeWidth;
        applyRuntimeScreenshotStrokeStyle(context, annotation.strokeStyle, annotation.strokeWidth);
        context.stroke();
      }
    } else if (annotation.type === 'connector') {
      if (annotation.outlineColor === 'transparent' || annotation.strokeWidth <= 0) continue;
      context.beginPath();
      context.strokeStyle = annotation.outlineColor;
      context.lineWidth = annotation.strokeWidth;
      applyRuntimeScreenshotStrokeStyle(context, annotation.strokeStyle, annotation.strokeWidth);
      context.moveTo(annotation.x1, annotation.y1);
      context.lineTo(annotation.x2, annotation.y2);
      context.stroke();
      if (annotation.connector === 'arrow') {
        drawRuntimeScreenshotArrowHead(context, annotation.x1, annotation.y1, annotation.x2, annotation.y2, annotation.outlineColor, annotation.strokeWidth);
      }
    } else {
      context.setLineDash([]);
      context.font = `${annotation.fontSize}px Arial, sans-serif`;
      context.fillStyle = annotation.color;
      const lineHeight = annotation.fontSize * 1.2;
      const bounds = runtimeScreenshotAnnotationBounds(annotation);
      const maxTextWidth = Math.max(12, runtimeScreenshotTextBoxWidth(annotation) - RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_X * 2);
      context.save();
      context.beginPath();
      context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      context.clip();
      for (const [lineIndex, line] of runtimeScreenshotWrapTextLines(context, annotation.text, maxTextWidth).entries()) {
        const y = annotation.y + lineIndex * lineHeight;
        context.fillText(line, annotation.x, y);
      }
      context.restore();
    }
  }
  if (showSelection && editor.selectedAnnotationId) {
    const selectedAnnotation = editor.annotations.find((annotation) => annotation.id === editor.selectedAnnotationId);
    if (selectedAnnotation && selectedAnnotation.id !== hiddenAnnotationId) {
      const bounds = runtimeScreenshotAnnotationBounds(selectedAnnotation);
      context.save();
      context.setLineDash([6, 4]);
      context.lineWidth = 1.5;
      context.strokeStyle = '#14b8a6';
      context.strokeRect(bounds.left, bounds.top, Math.max(1, bounds.right - bounds.left), Math.max(1, bounds.bottom - bounds.top));
      context.setLineDash([]);
      context.fillStyle = '#14b8a6';
      const resizeHandlePoints = runtimeScreenshotResizeHandlePoints(selectedAnnotation);
      const handlePoints = resizeHandlePoints.length > 0 ? resizeHandlePoints.map(([, x, y]) => [x, y] as const) : [
        [bounds.left, bounds.top],
        [bounds.right, bounds.top],
        [bounds.left, bounds.bottom],
        [bounds.right, bounds.bottom],
      ] as const;
      for (const [x, y] of handlePoints) {
        context.fillRect(x - 3, y - 3, 6, 6);
      }
      context.restore();
    }
  }
}

function normalizeBuildHiddenSectionLocks(value: unknown): BuildHiddenSectionLocks {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  return BUILD_SECTION_KEYS.reduce<BuildHiddenSectionLocks>((next, key) => {
    if (input[key] === true) {
      next[key] = true;
    }
    return next;
  }, {});
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

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
  workspacePanelWidth?: number;
  operatorPanelWidth?: number;
  terminalPanelWidth?: number;
  runtimeLogsPanelWidth?: number;
  hiddenSectionLocks?: BuildHiddenSectionLocks;
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

type WorkspaceSetupSuggestions = {
  presetName: string;
  startEntries: BuildStartEntry[];
  buildCommand: string;
  runCommand: string;
  typecheckCommand: string;
  lintCommand: string;
  testCommand: string;
  protectedFiles: string[];
  agentRole: string;
};

type BuildPromptLibraryItem = {
  id: string;
  source: 'recipe' | 'saved';
  category: BuildRecipeCategory;
  title: string;
  description: string;
  prompt: string;
  tags: string[];
};

const BUILD_EDITOR_LAYOUT_STORAGE_PREFIX = 'opendeskmate:build-editor-layout:v1';
const BUILD_VIEW_STATE_STORAGE_PREFIX = 'opendeskmate:build-view-state:v1';
const BUILD_ACTIVE_HISTORY_SESSION_STORAGE_PREFIX = 'opendeskmate:build-active-history-session:v1';

type PersistedBuildActiveHistorySessionState = {
  sessionId: string | null;
  historyDropdownOpen?: boolean;
};

function escapeClipboardHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeSuggestedFileBaseName(value: string, fallback = 'Final answer', maxLength = 64): string {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  return (normalized || fallback).slice(0, maxLength).trim().replace(/[. ]+$/g, '') || fallback;
}

function formatDateForFileBaseName(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}`;
}

function defaultFinalAnswerFileBaseName(): string {
  return `final-answer_${formatDateForFileBaseName()}`;
}

function defaultRuntimeScreenshotFileBaseName(): string {
  return `runtime-preview-screenshot_${formatDateForFileBaseName()}`;
}

function markdownInlineToNoteHtml(value: string): string {
  const linkPlaceholders: string[] = [];
  const withPlaceholders = String(value || '').replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)]+)\)/g,
    (_match, label: string, url: string) => {
      const token = `__NOTE_LINK_${linkPlaceholders.length}__`;
      linkPlaceholders.push(`<a href="${escapeClipboardHtml(url)}">${escapeClipboardHtml(label)}</a>`);
      return token;
    }
  );
  let html = escapeClipboardHtml(withPlaceholders);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  linkPlaceholders.forEach((linkHtml, index) => {
    html = html.replace(`__NOTE_LINK_${index}__`, linkHtml);
  });
  return html;
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line?: string): boolean {
  if (!line) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function markdownToNoteHtmlFragment(markdownText: string): string {
  const lines = normalizeMarkdownTables(markdownText).split(/\r?\n/);
  const blocks: string[] = [];
  let index = 0;

  const isBlockStart = (line: string, nextLine?: string) => (
    !line.trim()
    || /^#{1,6}\s+/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+[.)]\s+/.test(line)
    || /^```/.test(line)
    || (line.includes('|') && isMarkdownTableSeparator(nextLine))
  );

  while (index < lines.length) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```/);
    if (fenceMatch) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^```/.test(lines[index]?.trim() || '')) {
        codeLines.push(lines[index] || '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeClipboardHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${markdownInlineToNoteHtml(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (trimmed.includes('|') && isMarkdownTableSeparator(lines[index + 1])) {
      const headers = parseMarkdownTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] || '').includes('|') && (lines[index] || '').trim()) {
        rows.push(parseMarkdownTableRow(lines[index] || ''));
        index += 1;
      }
      blocks.push([
        '<table><thead><tr>',
        headers.map((cell) => `<th>${markdownInlineToNoteHtml(cell)}</th>`).join(''),
        '</tr></thead><tbody>',
        rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${markdownInlineToNoteHtml(row[cellIndex] || '')}</td>`).join('')}</tr>`).join(''),
        '</tbody></table>',
      ].join(''));
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length) {
        const itemLine = (lines[index] || '').trim();
        const match = ordered ? itemLine.match(/^\d+[.)]\s+(.+)$/) : itemLine.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${markdownInlineToNoteHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] || '').trim())) {
        quoteLines.push((lines[index] || '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${quoteLines.map((quoteLine) => `<p>${markdownInlineToNoteHtml(quoteLine)}</p>`).join('')}</blockquote>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlockStart(lines[index] || '', lines[index + 1])) {
      paragraphLines.push((lines[index] || '').trim());
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(trimmed);
      index += 1;
    }
    blocks.push(`<p>${markdownInlineToNoteHtml(paragraphLines.join(' '))}</p>`);
  }

  return blocks.join('');
}

function appendClipboardStyle(element: HTMLElement, style: string): void {
  const existing = element.getAttribute('style');
  element.setAttribute('style', existing ? `${existing}; ${style}` : style);
}

function escapeClipboardRtf(value: string): string {
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

function getClipboardRtfInlineContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeClipboardRtf(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes).map(getClipboardRtfInlineContent).join('');

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
      return href ? `${children} (${escapeClipboardRtf(href)})` : children;
    }
    case 'IMG': {
      const alt = element.getAttribute('alt') || element.getAttribute('src') || 'image';
      return `[Image: ${escapeClipboardRtf(alt)}]`;
    }
    default:
      return children;
  }
}

function getClipboardRtfTable(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  const maxCells = rows.reduce((max, row) => Math.max(max, row.cells.length), 1);
  const cellBorder = '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\clpadl80\\clpadr80\\clpadft3\\clpadfb3';
  const columnWidths = getClipboardRtfTableColumnWidths(table, maxCells);
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  return rows.map((row) => {
    const cells = Array.from(row.cells);
    let rightBoundary = 0;
    const cellDefinitions = columnWidths.map((width) => {
      rightBoundary += width;
      return `${cellBorder}\\clftsWidth3\\clwWidth${width}\\cellx${rightBoundary}`;
    }).join('');
    const cellContents = Array.from({ length: maxCells }, (_unused, index) => {
      const cell = cells[index];
      const isHeader = cell?.tagName === 'TH';
      const content = cell ? getClipboardRtfInlineContent(cell) : '';
      return `\\pard\\intbl\\plain\\fs20 ${isHeader ? `\\b ${content}\\b0` : content}\\cell`;
    }).join('');
    return `\\trowd\\trautofit0\\trgaph108\\trleft0\\trftsWidth3\\trwWidth${tableWidth}${cellDefinitions}${cellContents}\\row\n`;
  }).join('');
}

function getClipboardRtfTableColumnWidths(table: HTMLTableElement, maxCells: number): number[] {
  const defaultTableWidth = 9000;
  const minTableWidth = 3600;
  const maxTableWidth = 10800;
  const minColumnWidth = 720;
  const measuredWidths = Array.from({ length: maxCells }, () => 0);
  const contentWeights = Array.from({ length: maxCells }, () => 1);

  for (const row of Array.from(table.rows)) {
    let columnIndex = 0;
    for (const cell of Array.from(row.cells)) {
      if (columnIndex >= maxCells) break;
      const colSpan = Math.max(1, Math.min(maxCells - columnIndex, Number(cell.colSpan) || 1));
      const rect = cell.getBoundingClientRect();
      const measuredWidth = Number.isFinite(rect.width) && rect.width > 0 ? rect.width / colSpan : 0;
      const contentWeight = Math.max(3, (cell.textContent || '').trim().length) / colSpan;
      for (let offset = 0; offset < colSpan; offset += 1) {
        measuredWidths[columnIndex + offset] = Math.max(measuredWidths[columnIndex + offset], measuredWidth);
        contentWeights[columnIndex + offset] = Math.max(contentWeights[columnIndex + offset], contentWeight);
      }
      columnIndex += colSpan;
    }
  }

  const measuredTotal = measuredWidths.reduce((sum, width) => sum + width, 0);
  const tableRect = table.getBoundingClientRect();
  const tablePixelWidth = Number.isFinite(tableRect.width) && tableRect.width > 0
    ? tableRect.width
    : measuredTotal;
  const tableWidth = measuredTotal > 0
    ? Math.max(minTableWidth, Math.min(maxTableWidth, Math.round(tablePixelWidth * 15)))
    : defaultTableWidth;
  const weights = measuredTotal > 0
    ? measuredWidths.map((width) => Math.max(1, width))
    : contentWeights;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || maxCells;
  const widths = weights.map((weight) => Math.max(minColumnWidth, Math.round((tableWidth * weight) / totalWeight)));
  const widthTotal = widths.reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] = Math.max(minColumnWidth, widths[widths.length - 1] + (tableWidth - widthTotal));
  return widths;
}

function getClipboardRtfBlocksFromMarkdown(markdownText: string): string {
  if (typeof document === 'undefined') {
    return `\\pard\\plain\\fs22 ${escapeClipboardRtf(markdownText)}\\par\n`;
  }
  const container = document.createElement('div');
  container.innerHTML = markdownToNoteHtmlFragment(markdownText);
  const content = getClipboardRtfBlocksFromNodes(Array.from(container.childNodes));
  return content.trim() ? content : `\\pard\\plain\\fs22 ${escapeClipboardRtf(markdownText)}\\par\n`;
}

function getClipboardRtfBlocksFromNodes(nodes: Node[]): string {
  return nodes.map((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      return text ? `\\pard\\plain\\fs22 ${escapeClipboardRtf(text)}\\par\n` : '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node as HTMLElement;
    const tagName = element.tagName;

    if (/^H[1-6]$/.test(tagName)) {
      const level = Number(tagName.slice(1));
      const fontSize = [0, 40, 32, 28, 24, 22, 20][level] || 24;
      return `\\pard\\plain\\s${level}\\outlinelevel${level - 1}\\b\\fs${fontSize} ${getClipboardRtfInlineContent(element)}\\b0\\par\n`;
    }

    if (tagName === 'TABLE') {
      return getClipboardRtfTable(element as HTMLTableElement);
    }

    if (tagName === 'UL' || tagName === 'OL') {
      return Array.from(element.children)
        .filter((child) => child.tagName === 'LI')
        .map((child, index) => {
          const marker = tagName === 'OL' ? `${index + 1}.` : '\\bullet';
          return `\\pard\\plain\\fi-240\\li480\\fs22 ${marker}\\tab ${getClipboardRtfInlineContent(child)}\\par\n`;
        })
        .join('');
    }

    if (tagName === 'PRE') {
      return `\\pard\\plain\\f1\\fs20 ${escapeClipboardRtf(element.textContent || '')}\\par\n`;
    }

    if (tagName === 'BLOCKQUOTE') {
      return `\\pard\\plain\\li360\\fs22\\i ${getClipboardRtfInlineContent(element)}\\i0\\par\n`;
    }

    if (tagName === 'P') {
      return `\\pard\\plain\\fs22 ${getClipboardRtfInlineContent(element)}\\par\n`;
    }

    const blockChildren = Array.from(element.childNodes);
    if (blockChildren.some((child) => child.nodeType === Node.ELEMENT_NODE && /^(H[1-6]|P|UL|OL|TABLE|PRE|BLOCKQUOTE|DIV)$/i.test((child as HTMLElement).tagName))) {
      return getClipboardRtfBlocksFromNodes(blockChildren);
    }

    const inline = getClipboardRtfInlineContent(element).trim();
    return inline ? `\\pard\\plain\\fs22 ${inline}\\par\n` : '';
  }).join('');
}

function buildWordFriendlyClipboardRtf(source: HTMLElement | null, fallbackText: string): Promise<string> {
  return buildWordFriendlyRtfWithRenderedIcons(source, fallbackText);
}

function buildWordFriendlyClipboardHtml(source: HTMLElement | null, fallbackText: string): string {
  const cloned = source?.cloneNode(true) as HTMLElement | undefined;
  const bodyHtml = cloned?.innerHTML?.trim()
    || markdownToNoteHtmlFragment(fallbackText);

  const container = document.createElement('div');
  container.innerHTML = bodyHtml;

  container.querySelectorAll('button,svg,[data-copy-ignore="true"]').forEach((element) => element.remove());

  container.querySelectorAll('table').forEach((element) => {
    const table = element as HTMLTableElement;
    table.setAttribute('border', '1');
    table.setAttribute('cellpadding', '0');
    table.setAttribute('cellspacing', '0');
    appendClipboardStyle(table, 'border-collapse:collapse;width:100%;margin:8px 0;font-family:Arial,sans-serif;font-size:11pt');
  });

  container.querySelectorAll('th').forEach((element) => {
    appendClipboardStyle(element as HTMLElement, 'border:1px solid #a8a8a8;background:#f1f3f5;padding:6px 8px;text-align:left;font-weight:bold;vertical-align:top');
  });

  container.querySelectorAll('td').forEach((element) => {
    appendClipboardStyle(element as HTMLElement, 'border:1px solid #a8a8a8;padding:6px 8px;vertical-align:top');
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
    appendClipboardStyle(heading, headingStyles[heading.tagName] || headingStyles.H3);
  });

  container.querySelectorAll('p').forEach((element) => {
    appendClipboardStyle(element as HTMLElement, 'margin:0 0 8px 0');
  });

  container.querySelectorAll('ul,ol').forEach((element) => {
    appendClipboardStyle(element as HTMLElement, 'margin:0 0 8px 24px;padding:0');
  });

  container.querySelectorAll('pre').forEach((element) => {
    appendClipboardStyle(element as HTMLElement, 'white-space:pre-wrap;background:#f6f8fa;border:1px solid #d0d7de;padding:8px;font-family:Consolas,monospace;font-size:10pt');
  });

  container.querySelectorAll('code').forEach((element) => {
    appendClipboardStyle(element as HTMLElement, 'font-family:Consolas,monospace');
  });

  container.querySelectorAll('a').forEach((element) => {
    appendClipboardStyle(element as HTMLElement, 'color:#0563c1;text-decoration:underline');
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

function buildWorkItemNoteHtmlFragment(source: HTMLElement | null, fallbackText: string): string {
  const cloned = source?.cloneNode(true) as HTMLElement | undefined;
  const container = document.createElement('div');
  container.innerHTML = cloned?.innerHTML?.trim()
    || markdownToNoteHtmlFragment(fallbackText);
  container.querySelectorAll('button,svg,[data-copy-ignore="true"]').forEach((element) => element.remove());
  return container.innerHTML.trim().slice(0, 12000);
}

function GitHelpInfo({ label, children, enabled = true }: { label: string; children: ReactNode; enabled?: boolean }): ReactElement | null {
  if (!enabled) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Git help: ${label}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
          }}
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
        <div className="mb-1 text-xs font-medium text-foreground">{label}</div>
        {children}
      </PopoverContent>
    </Popover>
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

function getTaskMessageRenderVersion(message: TaskMessage): string {
  return [
    message.id,
    message.type,
    message.timestamp,
    hashForRenderVersion(message.content || ''),
    message.attachments?.length || 0,
  ].join(':');
}

function collectWorkspaceFilePaths(node: BuildFileTreeNode | null): string[] {
  if (!node) return [];
  const paths: string[] = [];
  const visit = (entry: BuildFileTreeNode) => {
    if (entry.type === 'file') {
      paths.push(entry.relativePath);
    }
    for (const child of entry.children || []) {
      visit(child);
    }
  };
  visit(node);
  return paths;
}

function suggestProtectedFiles(tree: BuildFileTreeNode | null): string[] {
  const paths = collectWorkspaceFilePaths(tree);
  const protectedPatterns = [
    /(^|\/)\.env(\..*)?$/i,
    /(^|\/)package\.json$/i,
    /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lock)$/i,
    /(^|\/)tsconfig(?:\.[^/]+)?\.json$/i,
    /(^|\/)(vite|next|electron\.vite|tailwind|postcss)\.config\.(js|mjs|cjs|ts)$/i,
    /(^|\/)(electron-builder\.json|forge\.config\.(js|ts)|Dockerfile|docker-compose\.ya?ml)$/i,
  ];
  return paths
    .filter((filePath) => protectedPatterns.some((pattern) => pattern.test(filePath)))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 12);
}

function suggestBuildAgentRole(snapshot: BuildSessionSnapshot | null): string {
  const category = snapshot?.detection.category;
  const projectType = String(snapshot?.detection.projectType || '').toLowerCase();
  if (category === 'web' || projectType.includes('next') || projectType.includes('vite')) {
    return 'Frontend Build Agent: preserve the current design system, use the preview for visual checks, and run typecheck/build after edits.';
  }
  if (category === 'backend' || projectType.includes('api') || projectType.includes('server')) {
    return 'Backend Build Agent: prioritize API behavior, data safety, logs, and focused tests around changed endpoints.';
  }
  if (category === 'desktop' || projectType.includes('electron')) {
    return 'Desktop Build Agent: respect Electron main/preload/renderer boundaries and verify packaged-app assumptions where relevant.';
  }
  if (category === 'node') {
    return 'Node Build Agent: keep changes small, verify scripts from package.json, and avoid broad dependency churn.';
  }
  return 'General Build Agent: inspect existing patterns first, make scoped edits, run available checks, and summarize the final diff.';
}

function buildWorkspaceSetupSuggestions(
  snapshot: BuildSessionSnapshot | null,
  tree: BuildFileTreeNode | null,
  workspaceRelativePath: string
): WorkspaceSetupSuggestions | null {
  if (!snapshot) return null;
  const commands = snapshot.detection.commands;
  const startEntries = (commands.startEntries || []).length > 0
    ? (commands.startEntries || [])
    : commands.startCommand
      ? [{ command: commands.startCommand, role: 'preview' as const }]
      : [];
  const workspaceLabel = workspaceRelativePath && workspaceRelativePath !== '.'
    ? pathLeaf(workspaceRelativePath)
    : pathLeaf(snapshot.workspaceRoot) || 'Workspace';
  return {
    presetName: `${workspaceLabel} setup`,
    startEntries,
    buildCommand: commands.buildCommand || '',
    runCommand: commands.runCommand || '',
    typecheckCommand: commands.typecheckCommand || '',
    lintCommand: commands.lintCommand || '',
    testCommand: commands.testCommand || '',
    protectedFiles: suggestProtectedFiles(tree),
    agentRole: suggestBuildAgentRole(snapshot),
  };
}

function getRuntimeStatusClasses(status: BuildSessionSnapshot['runtime']['status'] | undefined): string {
  if (status === 'running') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'starting') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'error') return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

function getQualityCheckStatusClasses(status: BuildQualityCheckRun['checks'][number]['status'] | BuildQualityCheckRun['status'] | undefined): string {
  if (status === 'success') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed') return 'bg-destructive/10 text-destructive';
  if (status === 'running') return 'bg-primary/10 text-primary';
  if (status === 'skipped') return 'bg-muted text-muted-foreground';
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

function getBuildReviewDiffSignature(diff: BuildWorkspaceDiff | null): string | undefined {
  const files = diff?.files || [];
  if (files.length === 0) return undefined;
  return [
    diff?.mode || 'none',
    diff?.baselineId || '',
    files
      .map((file) => [
        file.relativePath,
        file.changeType,
        file.beforeContent?.length || 0,
        file.afterContent?.length || 0,
        file.beforeTruncated ? 'bt' : '',
        file.afterTruncated ? 'at' : '',
      ].join(':'))
      .sort()
      .join('|'),
  ].join('::');
}

type BuildWorkspaceDiffFileEntry = NonNullable<BuildWorkspaceDiff['files']>[number];

interface BuildChangedFileSummary {
  relativePath: string;
  changeType?: BuildWorkspaceDiffFileEntry['changeType'];
  addedLines: number;
  deletedLines: number;
}

type BuildDiffLineKind = 'context' | 'added' | 'deleted' | 'empty';

interface BuildSideBySideDiffLine {
  lineNumber?: number;
  text: string;
  kind: BuildDiffLineKind;
}

interface BuildSideBySideDiffRow {
  id: string;
  before: BuildSideBySideDiffLine;
  after: BuildSideBySideDiffLine;
}

interface BuildChangedFilesSummaryResult {
  files: BuildChangedFileSummary[];
  totalAddedLines: number;
  totalDeletedLines: number;
}

interface BuildChangedFilesSummaryMessagePayload {
  kind: 'build_changed_files_summary';
  runId: string;
  diffSignature?: string;
  createdAt: string;
  summary: BuildChangedFilesSummaryResult;
}

const BUILD_CHANGED_FILES_SUMMARY_MESSAGE_PREFIX = 'opendeskmate:build-changed-files-summary:';

function normalizeDiffPathForSummary(input: string): string {
  const cleaned = input
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\\"/g, '"');
  if (!cleaned || cleaned === '/dev/null') return '';
  return cleaned.replace(/^[ab]\//, '');
}

function parseDiffHeaderTokens(input: string): string[] {
  const tokens: string[] = [];
  const matcher = /"((?:\\"|[^"])*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(input))) {
    tokens.push(match[1] ? match[1].replace(/\\"/g, '"') : match[2]);
  }
  return tokens;
}

function extractDiffHeaderPath(line: string): string | null {
  const headerMatch = /^diff --(?:git|synthetic)\s+(.+)$/.exec(line.trim());
  if (!headerMatch) return null;
  const tokens = parseDiffHeaderTokens(headerMatch[1]);
  if (tokens.length < 2) return null;
  return normalizeDiffPathForSummary(tokens[1]) || normalizeDiffPathForSummary(tokens[0]) || null;
}

function splitContentLinesForDiff(content: string | undefined): string[] {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized) return [];
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

function countContentLines(content: string | undefined): number {
  return splitContentLinesForDiff(content).length;
}

function computeLineDiffStats(beforeContent: string | undefined, afterContent: string | undefined): { addedLines: number; deletedLines: number } {
  let beforeLines = splitContentLinesForDiff(beforeContent);
  let afterLines = splitContentLinesForDiff(afterContent);

  while (beforeLines.length > 0 && afterLines.length > 0 && beforeLines[0] === afterLines[0]) {
    beforeLines = beforeLines.slice(1);
    afterLines = afterLines.slice(1);
  }

  while (
    beforeLines.length > 0
    && afterLines.length > 0
    && beforeLines[beforeLines.length - 1] === afterLines[afterLines.length - 1]
  ) {
    beforeLines = beforeLines.slice(0, -1);
    afterLines = afterLines.slice(0, -1);
  }

  if (beforeLines.length === 0 || afterLines.length === 0) {
    return {
      addedLines: afterLines.length,
      deletedLines: beforeLines.length,
    };
  }

  const comparisonSize = beforeLines.length * afterLines.length;
  if (comparisonSize > 200_000) {
    const beforeCounts = new Map<string, number>();
    for (const line of beforeLines) {
      beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1);
    }
    let commonLines = 0;
    for (const line of afterLines) {
      const count = beforeCounts.get(line) || 0;
      if (count > 0) {
        commonLines += 1;
        beforeCounts.set(line, count - 1);
      }
    }
    return {
      addedLines: Math.max(0, afterLines.length - commonLines),
      deletedLines: Math.max(0, beforeLines.length - commonLines),
    };
  }

  const previous = new Array(afterLines.length + 1).fill(0);
  const current = new Array(afterLines.length + 1).fill(0);
  for (let beforeIndex = 1; beforeIndex <= beforeLines.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= afterLines.length; afterIndex += 1) {
      current[afterIndex] = beforeLines[beforeIndex - 1] === afterLines[afterIndex - 1]
        ? previous[afterIndex - 1] + 1
        : Math.max(previous[afterIndex], current[afterIndex - 1]);
    }
    for (let index = 0; index <= afterLines.length; index += 1) {
      previous[index] = current[index];
      current[index] = 0;
    }
  }

  const commonLines = previous[afterLines.length] || 0;
  return {
    addedLines: Math.max(0, afterLines.length - commonLines),
    deletedLines: Math.max(0, beforeLines.length - commonLines),
  };
}

function createDiffLine(
  lineNumber: number | undefined,
  text: string,
  kind: BuildDiffLineKind
): BuildSideBySideDiffLine {
  return { lineNumber, text, kind };
}

function createEmptyDiffLine(): BuildSideBySideDiffLine {
  return { text: '', kind: 'empty' };
}

function buildSideBySideDiffRowsFromContents(
  beforeContent: string | undefined,
  afterContent: string | undefined
): BuildSideBySideDiffRow[] {
  const beforeLines = splitContentLinesForDiff(beforeContent);
  const afterLines = splitContentLinesForDiff(afterContent);
  if (beforeLines.length === 0 && afterLines.length === 0) return [];

  const fallbackRows = () => {
    const rows: BuildSideBySideDiffRow[] = [];
    const maxRows = Math.max(beforeLines.length, afterLines.length);
    for (let index = 0; index < maxRows; index += 1) {
      const beforeText = beforeLines[index];
      const afterText = afterLines[index];
      if (beforeText !== undefined && afterText !== undefined && beforeText === afterText) {
        rows.push({
          id: `same-${index}`,
          before: createDiffLine(index + 1, beforeText, 'context'),
          after: createDiffLine(index + 1, afterText, 'context'),
        });
      } else {
        rows.push({
          id: `changed-${index}`,
          before: beforeText !== undefined ? createDiffLine(index + 1, beforeText, 'deleted') : createEmptyDiffLine(),
          after: afterText !== undefined ? createDiffLine(index + 1, afterText, 'added') : createEmptyDiffLine(),
        });
      }
    }
    return rows;
  };

  const comparisonSize = beforeLines.length * afterLines.length;
  if (comparisonSize > 250_000) {
    return fallbackRows();
  }

  const dp = Array.from({ length: beforeLines.length + 1 }, () => new Array<number>(afterLines.length + 1).fill(0));
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      dp[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? dp[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(dp[beforeIndex + 1][afterIndex], dp[beforeIndex][afterIndex + 1]);
    }
  }

  type DiffOperation =
    | { kind: 'equal'; beforeLineNumber: number; afterLineNumber: number; text: string }
    | { kind: 'delete'; beforeLineNumber: number; text: string }
    | { kind: 'insert'; afterLineNumber: number; text: string };

  const operations: DiffOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      operations.push({
        kind: 'equal',
        beforeLineNumber: beforeIndex + 1,
        afterLineNumber: afterIndex + 1,
        text: beforeLines[beforeIndex],
      });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]) {
      operations.push({ kind: 'delete', beforeLineNumber: beforeIndex + 1, text: beforeLines[beforeIndex] });
      beforeIndex += 1;
    } else {
      operations.push({ kind: 'insert', afterLineNumber: afterIndex + 1, text: afterLines[afterIndex] });
      afterIndex += 1;
    }
  }
  while (beforeIndex < beforeLines.length) {
    operations.push({ kind: 'delete', beforeLineNumber: beforeIndex + 1, text: beforeLines[beforeIndex] });
    beforeIndex += 1;
  }
  while (afterIndex < afterLines.length) {
    operations.push({ kind: 'insert', afterLineNumber: afterIndex + 1, text: afterLines[afterIndex] });
    afterIndex += 1;
  }

  const rows: BuildSideBySideDiffRow[] = [];
  let operationIndex = 0;
  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];
    if (operation.kind === 'equal') {
      rows.push({
        id: `equal-${operation.beforeLineNumber}-${operation.afterLineNumber}`,
        before: createDiffLine(operation.beforeLineNumber, operation.text, 'context'),
        after: createDiffLine(operation.afterLineNumber, operation.text, 'context'),
      });
      operationIndex += 1;
      continue;
    }

    const deletions: Extract<DiffOperation, { kind: 'delete' }>[] = [];
    const insertions: Extract<DiffOperation, { kind: 'insert' }>[] = [];
    while (operationIndex < operations.length && operations[operationIndex].kind !== 'equal') {
      const next = operations[operationIndex];
      if (next.kind === 'delete') deletions.push(next);
      if (next.kind === 'insert') insertions.push(next);
      operationIndex += 1;
    }

    const maxChangedRows = Math.max(deletions.length, insertions.length);
    for (let index = 0; index < maxChangedRows; index += 1) {
      const deletedLine = deletions[index];
      const insertedLine = insertions[index];
      rows.push({
        id: `changed-${deletedLine?.beforeLineNumber ?? 'x'}-${insertedLine?.afterLineNumber ?? 'x'}-${index}`,
        before: deletedLine ? createDiffLine(deletedLine.beforeLineNumber, deletedLine.text, 'deleted') : createEmptyDiffLine(),
        after: insertedLine ? createDiffLine(insertedLine.afterLineNumber, insertedLine.text, 'added') : createEmptyDiffLine(),
      });
    }
  }

  return rows;
}

function extractPatchSectionForPath(patch: string | undefined, relativePath?: string | null): string {
  const normalizedTarget = normalizeDiffPathForSummary(relativePath || '');
  if (!patch || !normalizedTarget) return '';

  const lines = patch.split(/\r?\n/);
  const sections: string[][] = [];
  let currentSection: string[] = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --synthetic ')) {
      if (currentSection.length > 0) sections.push(currentSection);
      currentSection = [line];
    } else if (currentSection.length > 0) {
      currentSection.push(line);
    }
  }
  if (currentSection.length > 0) sections.push(currentSection);

  const section = sections.find((candidate) => {
    const headerPath = extractDiffHeaderPath(candidate[0]);
    if (headerPath === normalizedTarget) return true;
    return candidate.some((line) => {
      if (!line.startsWith('+++ ') && !line.startsWith('--- ')) return false;
      return normalizeDiffPathForSummary(line.slice(4)) === normalizedTarget;
    });
  });

  return section?.join('\n') || '';
}

function buildSideBySideDiffRowsFromPatchSection(patchSection: string): BuildSideBySideDiffRow[] {
  if (!patchSection.trim()) return [];
  const rows: BuildSideBySideDiffRow[] = [];
  let beforeLineNumber = 0;
  let afterLineNumber = 0;

  for (const line of patchSection.split(/\r?\n/)) {
    const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hunkMatch) {
      beforeLineNumber = Number(hunkMatch[1]);
      afterLineNumber = Number(hunkMatch[2]);
      rows.push({
        id: `hunk-${beforeLineNumber}-${afterLineNumber}`,
        before: createDiffLine(undefined, line, 'context'),
        after: createDiffLine(undefined, line, 'context'),
      });
      continue;
    }

    if (!line || line.startsWith('diff --') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }
    if (line.startsWith('\\ No newline')) {
      continue;
    }

    if (line.startsWith('-')) {
      rows.push({
        id: `delete-${beforeLineNumber}-${rows.length}`,
        before: createDiffLine(beforeLineNumber, line.slice(1), 'deleted'),
        after: createEmptyDiffLine(),
      });
      beforeLineNumber += 1;
    } else if (line.startsWith('+')) {
      rows.push({
        id: `insert-${afterLineNumber}-${rows.length}`,
        before: createEmptyDiffLine(),
        after: createDiffLine(afterLineNumber, line.slice(1), 'added'),
      });
      afterLineNumber += 1;
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line;
      rows.push({
        id: `context-${beforeLineNumber}-${afterLineNumber}-${rows.length}`,
        before: createDiffLine(beforeLineNumber, text, 'context'),
        after: createDiffLine(afterLineNumber, text, 'context'),
      });
      beforeLineNumber += 1;
      afterLineNumber += 1;
    }
  }

  return rows;
}

interface BuildSideBySideDiffViewerProps {
  filePath?: string | null;
  beforeContent?: string;
  afterContent?: string;
  beforeUnavailableReason?: string;
  afterUnavailableReason?: string;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
  patchSection?: string;
  fullscreen?: boolean;
  loading?: boolean;
  error?: string | null;
}

function getDiffLineClasses(line: BuildSideBySideDiffLine): string {
  if (line.kind === 'added') return 'border-l-emerald-500/70 bg-emerald-500/10';
  if (line.kind === 'deleted') return 'border-l-red-500/70 bg-red-500/10';
  if (line.kind === 'empty') return 'border-l-transparent bg-muted/20 text-muted-foreground/50';
  return 'border-l-transparent hover:bg-muted/20';
}

function renderDiffLine(line: BuildSideBySideDiffLine, key: string): ReactElement {
  return (
    <div
      key={key}
      className={cn(
        'grid min-w-max grid-cols-[3.5rem_minmax(max-content,1fr)] border-l-2 text-[11px] leading-5',
        getDiffLineClasses(line)
      )}
    >
      <span className="select-none border-r border-border/40 bg-background/35 px-2 text-right font-mono text-[10px] text-muted-foreground/70">
        {line.lineNumber ?? ''}
      </span>
      <code className="px-2 font-mono whitespace-pre text-foreground">
        {line.text || ' '}
      </code>
    </div>
  );
}

function BuildSideBySideDiffViewer({
  filePath,
  beforeContent,
  afterContent,
  beforeUnavailableReason,
  afterUnavailableReason,
  beforeTruncated,
  afterTruncated,
  patchSection,
  fullscreen = false,
  loading = false,
  error,
}: BuildSideBySideDiffViewerProps): ReactElement {
  const beforePaneRef = useRef<HTMLDivElement | null>(null);
  const afterPaneRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);
  const [scrollLocked, setScrollLocked] = useState(true);
  const [viewport, setViewport] = useState({ top: 0, height: 100 });
  const hasFullContent = beforeContent !== undefined || afterContent !== undefined;
  const rows = useMemo(
    () => (hasFullContent
      ? buildSideBySideDiffRowsFromContents(beforeContent, afterContent)
      : buildSideBySideDiffRowsFromPatchSection(patchSection || '')),
    [afterContent, beforeContent, hasFullContent, patchSection]
  );
  const addedLines = useMemo(() => rows.filter((row) => row.after.kind === 'added').length, [rows]);
  const deletedLines = useMemo(() => rows.filter((row) => row.before.kind === 'deleted').length, [rows]);
  const minimapMarkers = useMemo(() => {
    if (rows.length === 0) return [];
    const binCount = Math.min(220, Math.max(1, rows.length));
    const bins = new Map<number, { added: boolean; deleted: boolean }>();
    rows.forEach((row, index) => {
      const added = row.after.kind === 'added';
      const deleted = row.before.kind === 'deleted';
      if (!added && !deleted) return;
      const bin = Math.min(binCount - 1, Math.floor((index / rows.length) * binCount));
      const current = bins.get(bin) || { added: false, deleted: false };
      bins.set(bin, { added: current.added || added, deleted: current.deleted || deleted });
    });
    return Array.from(bins.entries()).map(([bin, marker]) => ({
      bin,
      top: `${(bin / binCount) * 100}%`,
      height: `${Math.max(0.8, 100 / binCount)}%`,
      kind: marker.added && marker.deleted ? 'mixed' : marker.added ? 'added' : 'deleted',
    }));
  }, [rows]);

  const updateViewportFromElement = useCallback((element: HTMLDivElement) => {
    const scrollHeight = Math.max(1, element.scrollHeight);
    const clientHeight = Math.max(1, element.clientHeight);
    if (scrollHeight <= clientHeight) {
      setViewport((current) => (current.top === 0 && current.height === 100 ? current : { top: 0, height: 100 }));
      return;
    }
    const height = Math.max(7, Math.min(100, (clientHeight / scrollHeight) * 100));
    const scrollable = Math.max(1, scrollHeight - clientHeight);
    const top = Math.min(100 - height, (element.scrollTop / scrollable) * (100 - height));
    setViewport((current) => (
      Math.abs(current.top - top) < 0.3 && Math.abs(current.height - height) < 0.3
        ? current
        : { top, height }
    ));
  }, []);

  useEffect(() => {
    const pane = afterPaneRef.current || beforePaneRef.current;
    if (pane) updateViewportFromElement(pane);
  }, [rows.length, updateViewportFromElement]);

  const handlePaneScroll = useCallback((event: ReactUIEvent<HTMLDivElement>, side: 'before' | 'after') => {
    const source = event.currentTarget;
    updateViewportFromElement(source);
    if (!scrollLocked || syncingScrollRef.current) return;
    const target = side === 'before' ? afterPaneRef.current : beforePaneRef.current;
    if (!target) return;
    syncingScrollRef.current = true;
    target.scrollTop = source.scrollTop;
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, [scrollLocked, updateViewportFromElement]);

  const scrollToRatio = useCallback((ratio: number) => {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    for (const pane of [beforePaneRef.current, afterPaneRef.current]) {
      if (!pane) continue;
      pane.scrollTop = clampedRatio * Math.max(0, pane.scrollHeight - pane.clientHeight);
      updateViewportFromElement(pane);
    }
  }, [updateViewportFromElement]);

  const handleMinimapClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = minimapRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    scrollToRatio((event.clientY - rect.top) / rect.height);
  }, [scrollToRatio]);

  const renderPane = (side: 'before' | 'after') => {
    const unavailableReason = side === 'before' ? beforeUnavailableReason : afterUnavailableReason;
    const content = side === 'before' ? beforeContent : afterContent;
    const ref = side === 'before' ? beforePaneRef : afterPaneRef;
    return (
      <div className="min-w-0 min-h-0 flex flex-col">
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/50 px-2 text-[10px] font-medium uppercase text-muted-foreground">
          <span>{side === 'before' ? 'Before' : 'After'}</span>
          {content === undefined && unavailableReason ? (
            <span className="truncate normal-case" title={unavailableReason}>{unavailableReason}</span>
          ) : null}
        </div>
        <div
          ref={ref}
          className={cn(
            'min-h-0 flex-1 overflow-auto bg-background/55',
            fullscreen ? 'max-h-none' : 'max-h-[58vh]'
          )}
          onScroll={(event) => handlePaneScroll(event, side)}
        >
          <div className="min-w-full py-1">
            {rows.length > 0 ? rows.map((row) => renderDiffLine(side === 'before' ? row.before : row.after, `${side}-${row.id}`)) : (
              <div className="p-3 text-[11px] text-muted-foreground">
                {unavailableReason || 'No file content available for this side.'}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };
  const truncatedPreviewStillVisible = Boolean(
    (beforeTruncated && beforeContent === undefined)
    || (afterTruncated && afterContent === undefined)
  );

  return (
    <div className={cn('min-h-0 rounded-md border border-border/60 bg-muted/10', fullscreen ? 'flex h-full flex-col' : 'flex flex-col')}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-foreground" title={filePath || undefined}>
            {filePath || 'Select a changed file'}
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span>{hasFullContent ? 'Full file view' : 'Patch view'}</span>
            <span><span className="text-emerald-500">+{addedLines}</span> <span className="text-red-500">-{deletedLines}</span></span>
            <span
              className="inline-flex items-center gap-1.5"
              title="Mini preview colors: green means added lines, red means deleted lines, orange means additions and deletions in the same area, and blank means unchanged lines."
            >
              <span className="h-2 w-2 rounded-sm bg-emerald-500" />
              <span className="h-2 w-2 rounded-sm bg-red-500" />
              <span className="h-2 w-2 rounded-sm bg-amber-500" />
              <span>mini preview</span>
            </span>
            {truncatedPreviewStillVisible ? (
              <span
                className="text-amber-500"
                title="The full file could not be loaded for at least one side, so this side is still using a shortened preview."
              >
                Large file preview truncated
              </span>
            ) : null}
            {error ? <span className="text-destructive">{error}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          <Button
            type="button"
            size="sm"
            variant={scrollLocked ? 'secondary' : 'outline'}
            className="h-7 gap-1 px-2 text-[10px]"
            onClick={() => setScrollLocked((current) => !current)}
            title={scrollLocked ? 'Before and after panes scroll together.' : 'Before and after panes scroll independently.'}
          >
            {scrollLocked ? <Lock className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3" />}
            {scrollLocked ? 'Locked' : 'Unlocked'}
          </Button>
        </div>
      </div>
      <div className={cn('grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_48px]', fullscreen ? 'h-full' : '')}>
        {renderPane('before')}
        {renderPane('after')}
        <div
          ref={minimapRef}
          className="relative cursor-pointer border-l border-border/60 bg-background/50"
          onClick={handleMinimapClick}
          title="Mini preview. Green means added lines, red means deleted lines, orange means additions and deletions in the same area, and blank means unchanged lines. Click to jump through the selected file."
        >
          {minimapMarkers.map((marker) => (
            <div
              key={`${marker.bin}-${marker.kind}`}
              className={cn(
                'absolute left-2 right-2 rounded-sm',
                marker.kind === 'added'
                  ? 'bg-emerald-500'
                  : marker.kind === 'deleted'
                    ? 'bg-red-500'
                    : 'bg-amber-500'
              )}
              style={{ top: marker.top, height: marker.height }}
            />
          ))}
          <div
            className="absolute left-0 right-0 rounded-sm border border-primary/80 bg-primary/15"
            style={{ top: `${viewport.top}%`, height: `${viewport.height}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function getUnifiedDiffLineClasses(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'border-l-emerald-500/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'border-l-red-500/70 bg-red-500/10 text-red-700 dark:text-red-300';
  }
  if (line.startsWith('@@')) {
    return 'border-l-primary/60 bg-primary/10 text-primary';
  }
  if (line.startsWith('diff --')) {
    return 'border-l-transparent bg-muted/20 font-semibold text-foreground';
  }
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) {
    return 'border-l-transparent text-muted-foreground';
  }
  return 'border-l-transparent text-foreground';
}

function BuildUnifiedDiffViewer({
  patch,
  fullscreen = false,
  compact = false,
}: {
  patch?: string;
  fullscreen?: boolean;
  compact?: boolean;
}): ReactElement {
  const lines = useMemo(() => (patch || '').split(/\r?\n/), [patch]);
  if (!patch?.trim()) {
    return (
      <div className={cn(
        'overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground',
        fullscreen ? 'h-full max-h-none' : compact ? 'max-h-36' : 'max-h-[60vh]'
      )}>
        No patch available.
      </div>
    );
  }

  return (
    <div className={cn(
      'overflow-auto rounded-md border border-border/60 bg-muted/30 font-mono text-[11px] leading-relaxed',
      fullscreen ? 'h-full max-h-none' : compact ? 'max-h-36' : 'max-h-[60vh]'
    )}>
      <div className="min-w-max py-1">
        {lines.map((line, index) => (
          <div
            key={`unified-diff-line-${index}`}
            className={cn('grid grid-cols-[3.5rem_minmax(max-content,1fr)] border-l-2', getUnifiedDiffLineClasses(line))}
          >
            <span className="select-none border-r border-border/40 bg-background/35 px-2 text-right text-[10px] text-muted-foreground/70">
              {index + 1}
            </span>
            <code className="px-2 whitespace-pre">{line || ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function extractPatchLineStats(patch: string | undefined): Map<string, { addedLines: number; deletedLines: number }> {
  const stats = new Map<string, { addedLines: number; deletedLines: number }>();
  let currentPath = '';

  const ensureStats = (relativePath: string) => {
    const existing = stats.get(relativePath);
    if (existing) return existing;
    const next = { addedLines: 0, deletedLines: 0 };
    stats.set(relativePath, next);
    return next;
  };

  for (const line of (patch || '').split(/\r?\n/)) {
    const headerPath = extractDiffHeaderPath(line);
    if (headerPath) {
      currentPath = headerPath;
      ensureStats(currentPath);
      continue;
    }

    if (line.startsWith('+++ ')) {
      const plusPath = normalizeDiffPathForSummary(line.slice(4));
      if (plusPath) {
        currentPath = plusPath;
        ensureStats(currentPath);
      }
      continue;
    }

    if (line.startsWith('--- ')) {
      const minusPath = normalizeDiffPathForSummary(line.slice(4));
      if (!currentPath && minusPath) {
        currentPath = minusPath;
        ensureStats(currentPath);
      }
      continue;
    }

    if (!currentPath) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      ensureStats(currentPath).addedLines += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      ensureStats(currentPath).deletedLines += 1;
    }
  }

  return stats;
}

function mapGitStatusToBuildChangeType(
  status?: BuildGitSummary['files'][number]['status']
): BuildChangedFileSummary['changeType'] {
  if (status === 'added' || status === 'untracked' || status === 'copied') return 'added';
  if (status === 'deleted') return 'deleted';
  return 'modified';
}

function buildChangedFilesSummaryFromGitSummary(gitSummary: BuildGitSummary | null | undefined): BuildChangedFilesSummaryResult {
  if (!gitSummary?.files?.length) {
    return { files: [], totalAddedLines: 0, totalDeletedLines: 0 };
  }
  const files = gitSummary.files.map((file) => ({
    relativePath: file.relativePath,
    changeType: mapGitStatusToBuildChangeType(file.status),
    addedLines: file.addedLines,
    deletedLines: file.deletedLines,
  }));
  return {
    files,
    totalAddedLines: gitSummary.totalAddedLines,
    totalDeletedLines: gitSummary.totalDeletedLines,
  };
}

function buildChangedFilesSummary(diff: BuildWorkspaceDiff | null, gitSummary?: BuildGitSummary | null): {
  files: BuildChangedFileSummary[];
  totalAddedLines: number;
  totalDeletedLines: number;
} {
  const gitChangedSummary = buildChangedFilesSummaryFromGitSummary(gitSummary);
  if (!diff) return gitChangedSummary;

  const patchStats = extractPatchLineStats(diff.patch);
  const filesFromDiff = diff.files || [];
  const files: BuildChangedFileSummary[] = filesFromDiff.length > 0
    ? filesFromDiff.map((file) => {
      const hasContentPreview = typeof file.beforeContent === 'string' || typeof file.afterContent === 'string';
      if (hasContentPreview) {
        const contentStats = computeLineDiffStats(file.beforeContent, file.afterContent);
        return {
          relativePath: file.relativePath,
          changeType: file.changeType,
          addedLines: contentStats.addedLines,
          deletedLines: contentStats.deletedLines,
        };
      }
      const stats = patchStats.get(file.relativePath);
      if (stats) {
        return {
          relativePath: file.relativePath,
          changeType: file.changeType,
          addedLines: stats.addedLines,
          deletedLines: stats.deletedLines,
        };
      }
      return {
        relativePath: file.relativePath,
        changeType: file.changeType,
        addedLines: file.changeType === 'added' ? countContentLines(file.afterContent) : 0,
        deletedLines: file.changeType === 'deleted' ? countContentLines(file.beforeContent) : 0,
      };
    })
    : Array.from(patchStats.entries()).map(([relativePath, stats]) => ({
      relativePath,
      addedLines: stats.addedLines,
      deletedLines: stats.deletedLines,
    }));

  const diffChangedSummary = {
    files,
    totalAddedLines: files.reduce((sum, file) => sum + file.addedLines, 0),
    totalDeletedLines: files.reduce((sum, file) => sum + file.deletedLines, 0),
  };

  if (gitChangedSummary.files.length === 0) return diffChangedSummary;
  if (diff.mode === 'git' || diffChangedSummary.files.length === 0 || gitChangedSummary.files.length > diffChangedSummary.files.length) {
    return gitChangedSummary;
  }

  const gitStatsByPath = new Map(gitChangedSummary.files.map((file) => [normalizeDiffPathForSummary(file.relativePath), file]));
  const filesWithGitLineStats = diffChangedSummary.files.map((file) => {
    const gitFile = gitStatsByPath.get(normalizeDiffPathForSummary(file.relativePath));
    return gitFile
      ? { ...file, addedLines: gitFile.addedLines, deletedLines: gitFile.deletedLines }
      : file;
  });

  return {
    files: filesWithGitLineStats,
    totalAddedLines: filesWithGitLineStats.reduce((sum, file) => sum + file.addedLines, 0),
    totalDeletedLines: filesWithGitLineStats.reduce((sum, file) => sum + file.deletedLines, 0),
  };
}

function createBuildChangedFilesSummaryMessage(params: {
  runId: string;
  summary: BuildChangedFilesSummaryResult;
  diffSignature?: string;
}): TaskMessage {
  const createdAt = new Date().toISOString();
  const payload: BuildChangedFilesSummaryMessagePayload = {
    kind: 'build_changed_files_summary',
    runId: params.runId,
    diffSignature: params.diffSignature,
    createdAt,
    summary: params.summary,
  };
  return {
    id: `local-build-diff-summary-${params.runId}`,
    type: 'system',
    content: `${BUILD_CHANGED_FILES_SUMMARY_MESSAGE_PREFIX}${JSON.stringify(payload)}`,
    timestamp: createdAt,
  };
}

function parseBuildChangedFilesSummaryMessage(message: TaskMessage): BuildChangedFilesSummaryMessagePayload | null {
  if (message.type !== 'system') return null;
  if (!message.content.startsWith(BUILD_CHANGED_FILES_SUMMARY_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(message.content.slice(BUILD_CHANGED_FILES_SUMMARY_MESSAGE_PREFIX.length)) as Partial<BuildChangedFilesSummaryMessagePayload>;
    if (parsed.kind !== 'build_changed_files_summary') return null;
    if (!parsed.runId || !parsed.summary || !Array.isArray(parsed.summary.files)) return null;
    return {
      kind: 'build_changed_files_summary',
      runId: String(parsed.runId),
      diffSignature: typeof parsed.diffSignature === 'string' ? parsed.diffSignature : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : message.timestamp,
      summary: {
        files: parsed.summary.files.map((file) => ({
          relativePath: String(file.relativePath || ''),
          changeType: file.changeType,
          addedLines: Number.isFinite(file.addedLines) ? Number(file.addedLines) : 0,
          deletedLines: Number.isFinite(file.deletedLines) ? Number(file.deletedLines) : 0,
        })).filter((file) => file.relativePath),
        totalAddedLines: Number.isFinite(parsed.summary.totalAddedLines) ? Number(parsed.summary.totalAddedLines) : 0,
        totalDeletedLines: Number.isFinite(parsed.summary.totalDeletedLines) ? Number(parsed.summary.totalDeletedLines) : 0,
      },
    };
  } catch {
    return null;
  }
}

function isBuildChangedFilesSummaryMessage(message: TaskMessage): boolean {
  return parseBuildChangedFilesSummaryMessage(message) !== null;
}

function appendBuildChangedFilesSummaryMessage(
  messages: TaskMessage[],
  params: {
    runId: string;
    diff: BuildWorkspaceDiff | null;
    gitSummary?: BuildGitSummary | null;
  }
): TaskMessage[] {
  const summary = buildChangedFilesSummary(params.diff, params.gitSummary);
  if (summary.files.length === 0) return messages;
  if (messages.some((message) => parseBuildChangedFilesSummaryMessage(message)?.runId === params.runId)) {
    return messages;
  }
  return [
    ...messages,
    createBuildChangedFilesSummaryMessage({
      runId: params.runId,
      summary,
      diffSignature: getBuildReviewDiffSignature(params.diff),
    }),
  ];
}

function BuildChangedFilesSummaryCard({
  summary,
  canUndo,
  undoBusy,
  onUndo,
  onReview,
  className,
}: {
  summary: BuildChangedFilesSummaryResult;
  canUndo: boolean;
  undoBusy: boolean;
  onUndo: () => void;
  onReview: (relativePath?: string) => void;
  className?: string;
}) {
  if (summary.files.length === 0) return null;

  return (
    <div className={cn('rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <FileDiff className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              Edited {summary.files.length} file{summary.files.length === 1 ? '' : 's'}
            </div>
            <div className="mt-0.5 text-xs font-medium">
              <span className="text-emerald-500">+{summary.totalAddedLines}</span>
              <span className="mx-1 text-muted-foreground"> </span>
              <span className="text-red-500">-{summary.totalDeletedLines}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs"
            disabled={!canUndo || undoBusy}
            onClick={onUndo}
            title={canUndo ? 'Undo pending Build changes and restore the captured baseline.' : 'Undo is available while a Build preview or approval baseline is active.'}
          >
            {undoBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Undo
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={() => onReview()}
            title="Open the Changes & Git review panel."
          >
            Review
          </Button>
        </div>
      </div>
      <div className="mt-3 divide-y divide-border/50 overflow-hidden rounded-md border border-border/50 bg-muted/10">
        {summary.files.slice(0, 6).map((file) => (
          <button
            key={`changed-summary-${file.relativePath}`}
            type="button"
            className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-xs hover:bg-muted/40"
            onClick={() => onReview(file.relativePath)}
            title={file.relativePath}
          >
            <span className="min-w-0 truncate text-foreground">{file.relativePath}</span>
            <span className="shrink-0 font-medium">
              <span className="text-emerald-500">+{file.addedLines}</span>
              <span className="text-muted-foreground"> </span>
              <span className="text-red-500">-{file.deletedLines}</span>
            </span>
          </button>
        ))}
        {summary.files.length > 6 ? (
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            onClick={() => onReview()}
          >
            +{summary.files.length - 6} more file{summary.files.length - 6 === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatBuildGitRepositoryState(summary: BuildGitSummary | null): string {
  if (!summary) return 'Checking Git';
  if (!summary.git.available) return 'Git unavailable';
  if (!summary.isRepository) return 'No Git repository';
  if (!summary.remoteName) return summary.dirty ? 'Local Git changes' : 'Local Git only';
  if (summary.dirty) return 'Local changes';
  if (summary.ahead > 0) return 'Ready to push';
  return 'Clean';
}

function getBuildGitRepositoryStateClasses(summary: BuildGitSummary | null): string {
  if (!summary) return 'bg-muted text-muted-foreground';
  if (!summary.git.available || !summary.isRepository) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (!summary.remoteName) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (summary.dirty) return 'bg-sky-500/10 text-sky-700 dark:text-sky-300';
  if (summary.ahead > 0) return 'bg-primary/10 text-primary';
  return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
}

function formatBuildGitSyncStatus(summary: BuildGitSummary | null): string {
  if (!summary) return 'Checking sync';
  if (summary.syncStatus === 'up-to-date') return 'Up to date';
  if (summary.syncStatus === 'ahead') return 'Ready to push';
  if (summary.syncStatus === 'behind') return 'Behind remote';
  if (summary.syncStatus === 'diverged') return 'Out of sync';
  if (summary.syncStatus === 'remote-changed') return 'Remote changed';
  if (summary.syncStatus === 'not-configured') return summary.remoteName ? 'No upstream' : 'Local only';
  return 'Sync unknown';
}

function getBuildGitSyncStatusClasses(summary: BuildGitSummary | null): string {
  if (!summary) return 'bg-muted text-muted-foreground';
  if (summary.syncStatus === 'up-to-date') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (summary.syncStatus === 'ahead') return 'bg-primary/10 text-primary';
  if (summary.syncStatus === 'behind' || summary.syncStatus === 'remote-changed') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (summary.syncStatus === 'diverged') return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

function formatBuildGitAuthStatus(summary: BuildGitSummary | null): string {
  if (!summary) return 'Auth unknown';
  if (summary.authStatus === 'not-required') return 'Auth not needed';
  if (summary.authStatus === 'configured') return 'Auth ready';
  if (summary.authStatus === 'missing') return 'Auth setup needed';
  if (summary.authStatus === 'failed') return 'Auth failed';
  return 'Auth unknown';
}

function getBuildGitAuthStatusClasses(summary: BuildGitSummary | null): string {
  if (!summary) return 'bg-muted text-muted-foreground';
  if (summary.authStatus === 'not-required') return 'bg-muted text-muted-foreground';
  if (summary.authStatus === 'configured') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (summary.authStatus === 'missing' || summary.authStatus === 'unknown') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'bg-destructive/10 text-destructive';
}

function formatBuildGitFileStatus(file: { status: string; staged?: boolean; unstaged?: boolean; untracked?: boolean }): string {
  if (file.untracked) return 'untracked';
  const parts = [file.status];
  if (file.staged) parts.push('staged');
  if (file.unstaged) parts.push('unstaged');
  return parts.join(' · ');
}

function getBuildGitPrimaryActionDisabled(summary: BuildGitSummary | null): boolean {
  if (!summary) return true;
  return Boolean(summary.nextAction.disabled);
}

function getBuildGitPrimaryCta(summary: BuildGitSummary | null): { label: string; detail: string; disabledReason?: string } {
  if (!summary) {
    return { label: 'Checking Git', detail: 'Checking the selected workspace.', disabledReason: 'Git status is still loading.' };
  }
  if (!summary.git.available) {
    return { label: 'Install Git', detail: summary.nextAction.detail, disabledReason: 'Git is not available on this computer.' };
  }
  if (!summary.isRepository) {
    return { label: 'Initialize Git', detail: summary.nextAction.detail };
  }
  if (summary.conflictedCount > 0) {
    return { label: 'Resolve conflicts', detail: summary.nextAction.detail, disabledReason: 'Conflicted files must be resolved first.' };
  }
  if (summary.hasChanges) {
    if (summary.remoteName && summary.upstream && summary.authStatus !== 'missing') {
      return { label: 'Commit & push updates', detail: 'Create a local commit for the changed files, then push the branch after the commit succeeds.' };
    }
    return { label: 'Commit updates', detail: summary.nextAction.detail };
  }
  if (summary.ahead > 0 && summary.behind === 0) {
    return { label: 'Push updates', detail: summary.nextAction.detail };
  }
  if (summary.behind > 0 || summary.syncStatus === 'diverged' || summary.syncStatus === 'remote-changed') {
    return { label: 'Resolve mismatch', detail: summary.syncDetail };
  }
  if (!summary.remoteName) {
    return { label: 'Add remote', detail: summary.nextAction.detail };
  }
  return { label: 'No Git action needed', detail: summary.nextAction.detail, disabledReason: 'There are no local changes or unpushed commits.' };
}

function getBuildGitMismatchActionLabel(action: BuildGitResolveMismatchAction): string {
  if (action === 'backup') return 'Create backup branch';
  if (action === 'merge') return 'Merge remote changes';
  if (action === 'rebase') return 'Rebase local commits';
  if (action === 'reset-to-remote') return 'Reset to remote';
  if (action === 'force-push') return 'Force push with lease';
  if (action === 'abort-merge') return 'Abort merge';
  if (action === 'abort-rebase') return 'Abort rebase';
  if (action === 'continue-rebase') return 'Continue rebase';
  return 'Resolve mismatch';
}

function getBuildGitMismatchActionDescription(action: BuildGitResolveMismatchAction): string {
  if (action === 'backup') return 'Save the current branch position before trying another action.';
  if (action === 'merge') return 'Keeps local commits and adds a merge commit containing remote changes.';
  if (action === 'rebase') return 'Replays local commits on top of the remote branch for a linear history.';
  if (action === 'reset-to-remote') return 'Makes local match remote. A backup branch is created first.';
  if (action === 'force-push') return 'Overwrites the remote branch only if it has not changed since fetch.';
  if (action === 'abort-merge') return 'Stop the active merge and return to the previous branch state.';
  if (action === 'abort-rebase') return 'Stop the active rebase and return to the previous branch state.';
  if (action === 'continue-rebase') return 'Continue after conflicts have been resolved and staged.';
  return '';
}

function isBuildGitMismatchActionAvailable(summary: BuildGitMismatchSummary | null, action: BuildGitResolveMismatchAction): boolean {
  if (!summary?.isRepository) return false;
  if (action === 'backup') return summary.inProgressOperation === 'none';
  if (action === 'merge') return summary.canMerge;
  if (action === 'rebase') return summary.canRebase;
  if (action === 'reset-to-remote') return summary.canResetToRemote;
  if (action === 'force-push') return summary.canForcePush;
  if (action === 'abort-merge') return summary.inProgressOperation === 'merge';
  if (action === 'abort-rebase' || action === 'continue-rebase') return summary.inProgressOperation === 'rebase';
  return false;
}

function buildDefaultCommitMessage(summary: BuildGitSummary | null, fallback: BuildChangedFilesSummaryResult): string {
  const count = summary?.changedFileCount || fallback.files.length;
  if (count <= 0) return 'Update build workspace';
  const firstFile = summary?.files[0]?.relativePath || fallback.files[0]?.relativePath;
  if (count === 1 && firstFile) return `Update ${firstFile}`;
  if (firstFile) return `Update ${firstFile} and ${count - 1} more file${count - 1 === 1 ? '' : 's'}`;
  return `Update ${count} build files`;
}

function getBuildGitRemoteUrlPlaceholder(provider: BuildGitRemoteProvider): string {
  if (provider === 'github') return 'https://github.com/your-name/your-repo.git';
  if (provider === 'gitlab') return 'https://gitlab.com/your-name/your-repo.git';
  if (provider === 'bitbucket') return 'https://bitbucket.org/your-name/your-repo.git';
  return 'https://example.com/your-name/your-repo.git or git@example.com:your-name/your-repo.git';
}

function formatQualityCheckSummary(run: BuildQualityCheckRun | null): string {
  if (!run) return 'Not run';
  const failed = run.checks.filter((check) => check.status === 'failed').length;
  const passed = run.checks.filter((check) => check.status === 'success').length;
  const skipped = run.checks.filter((check) => check.status === 'skipped').length;
  if (run.status === 'running') return 'Running checks';
  if (run.status === 'failed') return `${failed} failed, ${passed} passed`;
  if (run.status === 'success') return `${passed} passed${skipped > 0 ? `, ${skipped} skipped` : ''}`;
  return `${skipped || run.checks.length} skipped`;
}

function buildLocalArtifactSrc(filePath: string | null | undefined): string | undefined {
  const trimmed = filePath?.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/\\/g, '/').replace(/#/g, '%23').replace(/ /g, '%20');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function formatStream(stream: BuildLogEntry['stream']): string {
  if (stream === 'stdout') return 'OUT';
  if (stream === 'stderr') return 'ERR';
  return 'SYS';
}

function isPictureAvatar(avatar: string | undefined, imageDataUrl: string | undefined): boolean {
  return Boolean(imageDataUrl || isAgentCharacterAvatar(avatar));
}









function isBuildModeGoalPanelMessage(message: TaskMessage): boolean {
  const content = String(message.content || '');
  return message.type === 'user' && content.startsWith('Build Mode goal:');
}

function formatBuildAssistantPanelMessageType(message: TaskMessage): string {
  if (isBuildModeGoalPanelMessage(message)) {
    return 'Build Mode Goal';
  }
  if (isRelayedSubagentCompletionMessage(message)) {
    return 'Relayed Child Completion';
  }
  if (message.type === 'assistant') return 'Assistant';
  if (message.type === 'tool') return 'Tool';
  if (message.type === 'system') return 'System';
  if (message.type === 'user') return 'User';
  return message.type;
}

function extractBuildPromptNavigatorText(message: TaskMessage): string {
  const content = String(message.content || '').trim();
  if (!content) return '';
  if (!isBuildModeGoalPanelMessage(message)) return content;

  const lines = content.split(/\r?\n/);
  const workspaceLineIndex = lines.findIndex((line, index) => (
    index > 0 && line.trim().startsWith('Workspace:')
  ));
  const goalLines = lines.slice(1, workspaceLineIndex > 1 ? workspaceLineIndex : undefined);
  return goalLines.join('\n').trim() || lines[1]?.trim() || content;
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

function hasVisibleBuildUserPromptMessage(messages: TaskMessage[]): boolean {
  return messages.some((message) => message.type === 'user' && !isBuildModeGoalPanelMessage(message));
}

function isLocalBuildGoalMessage(message: TaskMessage): boolean {
  return message.type === 'user' && message.id.startsWith('local-build-goal-');
}

function isLocalBuildAutoRepairAttemptMessage(message: TaskMessage): boolean {
  return message.type === 'system' && message.id.startsWith('local-auto-repair-attempt-');
}

function isLocalBuildTimelineMessage(message: TaskMessage): boolean {
  return isLocalBuildGoalMessage(message)
    || isLocalBuildAutoRepairAttemptMessage(message)
    || isBuildChangedFilesSummaryMessage(message);
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

function areTaskAttachmentsEquivalent(a: TaskMessage['attachments'], b: TaskMessage['attachments']): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  return a.every((attachment, index) => {
    const other = b[index];
    return attachment.type === other?.type
      && attachment.data === other?.data
      && attachment.label === other?.label;
  });
}

function areTaskMessagesRenderEquivalent(a: TaskMessage, b: TaskMessage): boolean {
  return a.id === b.id
    && a.type === b.type
    && a.content === b.content
    && a.toolName === b.toolName
    && a.timestamp === b.timestamp
    && areTaskAttachmentsEquivalent(a.attachments, b.attachments);
}

function preserveEquivalentTaskMessageReferences(existing: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] {
  if (incoming.length === 0) return incoming;
  const existingById = new Map(existing.map((message) => [message.id, message]));
  let changed = incoming.length !== existing.length;
  const next = incoming.map((message, index) => {
    const existingMessage = existingById.get(message.id);
    if (existingMessage && areTaskMessagesRenderEquivalent(existingMessage, message)) {
      if (existing[index] !== existingMessage) changed = true;
      return existingMessage;
    }
    changed = true;
    return message;
  });

  if (!changed && existing.every((message, index) => message === next[index])) {
    return existing;
  }

  return next;
}

function mergeIncomingWithLocalBuildGoalMessages(existing: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] {
  const normalizedIncoming = collectAssistantMessages(incoming);
  const merged = [...normalizedIncoming];
  const localGoalMessages = existing.filter((message) => {
    if (!isLocalBuildGoalMessage(message)) return false;
    return !normalizedIncoming.some((incomingMessage) => (
      incomingMessage.type === 'user'
      && String(incomingMessage.content || '').trim() === String(message.content || '').trim()
    ));
  });
  const localAutoRepairMessages = existing.filter((message) => isLocalBuildAutoRepairAttemptMessage(message));
  const localChangedFilesSummaryMessages = existing.filter((message) => isBuildChangedFilesSummaryMessage(message));

  for (const localMessage of localGoalMessages) {
    merged.push(localMessage);
  }

  for (const localMessage of localAutoRepairMessages) {
    merged.push(localMessage);
  }

  for (const localMessage of localChangedFilesSummaryMessages) {
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
  return preserveEquivalentTaskMessageReferences(existing, deduped);
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

type BuildAssistantMessageItemProps = {
  message: TaskMessage;
  messageVersion: string;
  copied: boolean;
  expandedToolMessage: boolean;
  savingProjectNote: boolean;
  savingRtf: boolean;
  proseClasses: string;
  relayedSubagentAgentName?: string;
  relayedSubagentAgentRoleName?: string;
  relayedSubagentAgentAvatar?: string;
  relayedSubagentAgentAvatarColor?: string;
  relayedSubagentAgentAvatarImageDataUrl?: string;
  relayedSubagentAvatarFrame?: string;
  relayedSubagentLabel?: string;
  onCopy: (messageId: string, content: string, sourceElement?: HTMLElement | null) => void;
  onSaveAsProjectNote: (messageId: string, content: string, sourceElement?: HTMLElement | null) => void;
  onSaveAsRtf: (messageId: string, content: string, sourceElement?: HTMLElement | null) => void;
  onToggleToolMessage: (messageId: string) => void;
  onContentRef: (messageId: string, element: HTMLDivElement | null) => void;
};

type BuildRuntimeLogRowProps = {
  entry: BuildLogEntry;
};

const BuildAssistantMessageItem = memo(function BuildAssistantMessageItem({
  message,
  copied,
  expandedToolMessage,
  savingProjectNote,
  savingRtf,
  proseClasses,
  relayedSubagentAgentName,
  relayedSubagentAgentRoleName,
  relayedSubagentAgentAvatar,
  relayedSubagentAgentAvatarColor,
  relayedSubagentAgentAvatarImageDataUrl,
  relayedSubagentAvatarFrame = 'none',
  relayedSubagentLabel,
  onCopy,
  onSaveAsProjectNote,
  onSaveAsRtf,
  onToggleToolMessage,
  onContentRef,
}: BuildAssistantMessageItemProps) {
  const isAssistantMessage = message.type === 'assistant';
  const relayedSubagentMeta = getRelayedSubagentCompletionMeta(message);
  const isRelayedSubagentCompletion = Boolean(relayedSubagentMeta);
  const assistantReasoningParts = isAssistantMessage
    ? splitAssistantReasoningContent(message.content || '')
    : null;
  const assistantAnswerContent = assistantReasoningParts?.hasReasoning
    ? assistantReasoningParts.answer
    : message.content || '';
  const assistantReasoningContent = assistantReasoningParts?.reasoning || '';
  const hasAssistantReasoning = Boolean(assistantReasoningParts?.hasReasoning);
  const hasAssistantAnswer = assistantAnswerContent.trim().length > 0;
  const planItems = parsePlanItemsFromAssistantContent(
    isAssistantMessage ? assistantAnswerContent : message.content || ''
  );
  const isUserPanelMessage = message.type === 'user' && !isBuildModeGoalPanelMessage(message);
  const isToolMessage = message.type === 'tool';
  const toolPreview = isToolMessage ? getCollapsedToolMessageContent(message.content || '') : null;
  const renderedToolContent = isToolMessage && !expandedToolMessage && toolPreview
    ? toolPreview.preview
    : (isAssistantMessage ? assistantAnswerContent : (message.content || ''));
  const canExpandToolMessage = Boolean(isToolMessage && toolPreview?.truncated);
  const [answerPopoutOpen, setAnswerPopoutOpen] = useState(false);
  const [answerPopoutFullscreen, setAnswerPopoutFullscreen] = useState(false);
  const answerPopoutContentRef = useRef<HTMLDivElement | null>(null);
  const messageContentElementRef = useRef<HTMLDivElement | null>(null);
  const relayedSubagentFrameClass = relayedSubagentAvatarFrame === 'circle'
    ? 'rounded-full'
    : relayedSubagentAvatarFrame === 'badge'
      ? 'rounded-2xl ring-2 ring-offset-2 ring-offset-card'
      : relayedSubagentAvatarFrame === 'soft'
        ? 'rounded-2xl'
        : 'rounded-xl';

  const renderCopyButton = (content: string) => (
    <BuildTooltip content={copied ? 'Copied' : 'Copy message'}>
      <button
        type="button"
        className="rounded p-1 text-muted-foreground/80 opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100"
        onClick={() => onCopy(message.id, content)}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </BuildTooltip>
  );

  const renderPopoutButton = () => (
    <BuildTooltip content="Open final answer in a larger view">
      <button
        type="button"
        className="rounded p-1 text-muted-foreground/80 opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100"
        onClick={() => setAnswerPopoutOpen(true)}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </BuildTooltip>
  );

  const renderSaveProjectNoteButton = (content: string) => (
    <BuildTooltip content="Save final answer as a note on a project work item">
      <button
        type="button"
        className={cn(
          'rounded p-1 text-muted-foreground/80 opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100',
          savingProjectNote ? 'opacity-100' : null
        )}
        disabled={savingProjectNote}
        onClick={() => onSaveAsProjectNote(message.id, content, messageContentElementRef.current)}
      >
        {savingProjectNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
      </button>
    </BuildTooltip>
  );

  const renderSaveRtfButton = (content: string) => (
    <BuildTooltip content="Save final answer as a Rich Text File">
      <button
        type="button"
        className={cn(
          'rounded p-1 text-muted-foreground/80 opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100',
          savingRtf ? 'opacity-100' : null
        )}
        disabled={savingRtf}
        onClick={() => onSaveAsRtf(message.id, content, messageContentElementRef.current)}
      >
        {savingRtf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      </button>
    </BuildTooltip>
  );

  const renderPlanOrMarkdown = (
    content: string,
    items: ParsedPlanItem[] | null,
    attachContentRef: boolean,
    muted = false
  ) => (
    <div
      ref={(element) => {
        if (attachContentRef) {
          messageContentElementRef.current = element;
          onContentRef(message.id, element);
        }
      }}
    >
      {!items ? (
        <div
          className={cn(
            proseClasses,
            muted
              ? 'text-muted-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-muted-foreground prose-em:text-muted-foreground'
              : null
          )}
        >
          <AnswerScope.Provider value={message.id}><AnswerHighlight messageId={message.id}><ReactMarkdown remarkPlugins={[remarkGfm]} components={isToolMessage ? undefined : interactiveMarkdownComponents}>
            {normalizeMarkdownTables(content)}
          </ReactMarkdown></AnswerHighlight></AnswerScope.Provider>
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
          {items.map((item) => (
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
  );

  const renderCard = (
    label: string,
    content: string,
    items: ParsedPlanItem[] | null,
    attachContentRef: boolean,
    muted = false,
    showCopy = true
  ) => (
    <div
      className={cn(
        'group rounded-md border border-border/60 bg-background px-2 py-1.5',
        isUserPanelMessage ? 'ml-3 border-primary/35 bg-primary/10' : null,
        isRelayedSubagentCompletion
          ? 'border-emerald-500/45 bg-card text-card-foreground shadow-[0_10px_34px_rgba(16,185,129,0.16)] ring-1 ring-emerald-500/15'
          : null,
        muted ? 'bg-muted/30 text-muted-foreground' : null,
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div
          className={cn(
            'flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground',
            isUserPanelMessage ? 'text-primary/90' : null,
            isRelayedSubagentCompletion ? 'font-semibold text-emerald-700 dark:text-emerald-300' : null,
          )}
        >
          {muted ? <Brain className="h-3.5 w-3.5" /> : null}
          {isRelayedSubagentCompletion ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {label}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isAssistantMessage && !muted && content.trim() ? renderSaveProjectNoteButton(content) : null}
          {isAssistantMessage && !muted && content.trim() ? renderSaveRtfButton(content) : null}
          {isAssistantMessage && !muted && content.trim() ? renderPopoutButton() : null}
          {showCopy ? renderCopyButton(content) : null}
        </div>
      </div>
      {isRelayedSubagentCompletion ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-background/75 px-2.5 py-2 text-card-foreground">
          <AgentCharacterButton target={{ ...relayedSubagentMeta!, messageId: message.id }} aria-label={`Open agent card for ${relayedSubagentAgentName || relayedSubagentMeta?.childAgentId || 'Subagent'}`}
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden border border-border/70 bg-muted/70',
              relayedSubagentFrameClass
            )}
            style={{ backgroundColor: relayedSubagentAgentAvatarColor ? `${relayedSubagentAgentAvatarColor}18` : undefined }}
          >
            <AgentAvatarIcon
              avatar={relayedSubagentAgentAvatar}
              color={relayedSubagentAgentAvatarColor || 'hsl(var(--primary))'}
              imageDataUrl={relayedSubagentAgentAvatarImageDataUrl}
              className={isPictureAvatar(relayedSubagentAgentAvatar, relayedSubagentAgentAvatarImageDataUrl) ? 'h-full w-full' : 'h-5 w-5'}
            />
          </AgentCharacterButton>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {relayedSubagentAgentName || relayedSubagentMeta?.childAgentId || 'Subagent'}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {[relayedSubagentAgentRoleName, relayedSubagentLabel].filter(Boolean).join(' • ') || 'Subagent'}
            </div>
          </div>
        </div>
      ) : null}
      {renderPlanOrMarkdown(content, items, attachContentRef, muted)}
      {isAssistantMessage && !muted && <AnswerActions messageId={message.id} content={content} />}
    </div>
  );

  const renderAnswerPopoutDialog = () => {
    if (!isAssistantMessage || !assistantAnswerContent.trim()) return null;
    return (
      <Dialog
        open={answerPopoutOpen}
        onOpenChange={(open) => {
          setAnswerPopoutOpen(open);
          if (!open) {
            setAnswerPopoutFullscreen(false);
          }
        }}
      >
        <DialogContent
          className={cn(
            'flex flex-col overflow-hidden',
            answerPopoutFullscreen
              ? 'h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-none p-4'
              : 'max-h-[88vh] w-[92vw] max-w-4xl'
          )}
        >
          <DialogHeader className="pr-8">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <DialogTitle>Answer</DialogTitle>
                <DialogDescription>Build mode answer from this message.</DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  disabled={savingProjectNote}
                  onClick={() => onSaveAsProjectNote(message.id, assistantAnswerContent, answerPopoutContentRef.current)}
                  title="Save final answer as a note on a project work item"
                >
                  {savingProjectNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                  Save note
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  disabled={savingRtf}
                  onClick={() => onSaveAsRtf(message.id, assistantAnswerContent, answerPopoutContentRef.current)}
                  title="Save final answer as a Rich Text File"
                >
                  {savingRtf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Save RTF
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  onClick={() => onCopy(message.id, assistantAnswerContent, answerPopoutContentRef.current)}
                  title={copied ? 'Copied' : 'Copy final answer'}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  onClick={() => setAnswerPopoutFullscreen((current) => !current)}
                  title={answerPopoutFullscreen ? 'Exit full screen answer view' : 'Open answer full screen'}
                >
                  {answerPopoutFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {answerPopoutFullscreen ? 'Exit full screen' : 'Full screen'}
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div ref={answerPopoutContentRef} className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/60 bg-background p-4">
            {planItems ? (
              <div className="space-y-2">
                {planItems.map((item) => (
                  <div key={`popout:${message.id}:${item.id}:${item.content}`} className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                    <div className="mt-0.5 shrink-0">{renderPlanStatusIcon(item.status)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground">{item.content}</div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="rounded border border-border/60 bg-background px-1.5 py-0.5">#{item.id}</span>
                        <span className="rounded border border-border/60 bg-background px-1.5 py-0.5">{formatPlanStatusLabel(item.status)}</span>
                        {item.priority ? (
                          <span className="rounded border border-border/60 bg-background px-1.5 py-0.5">priority {item.priority}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={cn(
                  proseClasses,
                  'text-sm leading-relaxed prose-p:my-2 prose-li:my-1 prose-code:text-xs'
                )}
              >
                <AnswerScope.Provider value={message.id}><AnswerHighlight messageId={message.id}><ReactMarkdown remarkPlugins={[remarkGfm]} components={interactiveMarkdownComponents}>
                  {normalizeMarkdownTables(assistantAnswerContent)}
                </ReactMarkdown></AnswerHighlight></AnswerScope.Provider>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  if (hasAssistantReasoning) {
    return (
      <>
        <div className="space-y-1.5">
          {renderCard('Reasoning', assistantReasoningContent, null, !hasAssistantAnswer, true, !hasAssistantAnswer)}
          {hasAssistantAnswer ? renderCard('Answer', assistantAnswerContent, planItems, true) : null}
        </div>
        {renderAnswerPopoutDialog()}
      </>
    );
  }

  return (
    <>
      {renderCard(
        formatBuildAssistantPanelMessageType(message),
        renderedToolContent,
        planItems,
        true,
      )}
      {renderAnswerPopoutDialog()}
    </>
  );
}, (prev, next) => (
  prev.message === next.message
  && prev.messageVersion === next.messageVersion
  && prev.copied === next.copied
  && prev.expandedToolMessage === next.expandedToolMessage
  && prev.savingProjectNote === next.savingProjectNote
  && prev.savingRtf === next.savingRtf
  && prev.proseClasses === next.proseClasses
  && prev.relayedSubagentAgentName === next.relayedSubagentAgentName
  && prev.relayedSubagentAgentRoleName === next.relayedSubagentAgentRoleName
  && prev.relayedSubagentAgentAvatar === next.relayedSubagentAgentAvatar
  && prev.relayedSubagentAgentAvatarColor === next.relayedSubagentAgentAvatarColor
  && prev.relayedSubagentAgentAvatarImageDataUrl === next.relayedSubagentAgentAvatarImageDataUrl
  && prev.relayedSubagentAvatarFrame === next.relayedSubagentAvatarFrame
  && prev.relayedSubagentLabel === next.relayedSubagentLabel
  && prev.onCopy === next.onCopy
  && prev.onSaveAsProjectNote === next.onSaveAsProjectNote
  && prev.onSaveAsRtf === next.onSaveAsRtf
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

function areBuildFileTreesEquivalent(a: BuildFileTreeNode | null, b: BuildFileTreeNode | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.name !== b.name || a.relativePath !== b.relativePath || a.type !== b.type) return false;

  const leftChildren = a.children || [];
  const rightChildren = b.children || [];
  if (leftChildren.length !== rightChildren.length) return false;

  for (let index = 0; index < leftChildren.length; index += 1) {
    if (!areBuildFileTreesEquivalent(leftChildren[index], rightChildren[index])) {
      return false;
    }
  }

  return true;
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

function areBuildWorkspaceDiffFilesEquivalent(
  a: BuildWorkspaceDiff['files'],
  b: BuildWorkspaceDiff['files']
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  return a.every((file, index) => {
    const other = b[index];
    return file.relativePath === other?.relativePath
      && file.changeType === other?.changeType
      && file.beforeContent === other?.beforeContent
      && file.afterContent === other?.afterContent
      && file.beforeTruncated === other?.beforeTruncated
      && file.afterTruncated === other?.afterTruncated;
  });
}

function areBuildWorkspaceDiffsEquivalent(a: BuildWorkspaceDiff | null, b: BuildWorkspaceDiff | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.available === b.available
    && a.summary === b.summary
    && a.patch === b.patch
    && a.truncated === b.truncated
    && a.mode === b.mode
    && a.baselineId === b.baselineId
    && a.needsApproval === b.needsApproval
    && areBuildWorkspaceDiffFilesEquivalent(a.files, b.files);
}

function areGeneratedBuildObjectsEquivalent<T extends { generatedAt?: string }>(a: T | null, b: T | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return JSON.stringify({ ...a, generatedAt: '' }) === JSON.stringify({ ...b, generatedAt: '' });
}

function mergeLiveBuildGitSummary(current: BuildGitSummary | null, live: BuildGitSummary): BuildGitSummary {
  if (
    !current
    || current.workspaceRoot !== live.workspaceRoot
    || current.workspaceRelativePath !== live.workspaceRelativePath
    || current.isRepository !== live.isRepository
  ) {
    return live;
  }

  return {
    ...current,
    generatedAt: live.generatedAt,
    available: live.available,
    isRepository: live.isRepository,
    git: live.git,
    branch: live.branch ?? current.branch,
    commit: live.commit ?? current.commit,
    shortCommit: live.shortCommit ?? current.shortCommit,
    remoteName: live.remoteName ?? current.remoteName,
    remoteUrl: live.remoteUrl ?? current.remoteUrl,
    remoteProvider: live.remoteProvider ?? current.remoteProvider,
    repositoryHost: live.repositoryHost ?? current.repositoryHost,
    repositoryOwner: live.repositoryOwner ?? current.repositoryOwner,
    repositoryName: live.repositoryName ?? current.repositoryName,
    repositoryWebUrl: live.repositoryWebUrl ?? current.repositoryWebUrl,
    upstream: live.upstream ?? current.upstream,
    ahead: live.ahead,
    behind: live.behind,
    syncStatus: live.syncStatus,
    syncDetail: live.syncDetail,
    conflictedCount: live.conflictedCount,
    dirty: live.dirty,
    hasChanges: live.hasChanges,
    changedFileCount: live.changedFileCount,
    stagedCount: live.stagedCount,
    unstagedCount: live.unstagedCount,
    untrackedCount: live.untrackedCount,
    totalAddedLines: live.totalAddedLines,
    totalDeletedLines: live.totalDeletedLines,
    files: live.files,
    nextAction: live.nextAction,
  };
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
  const focusScene = useFocusSceneStore(state => state.active);
  const accomplish = getAccomplish();
  const navigate = useNavigate();
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  const { activeAgentId, agents, loadAgents } = useAgentStore();
  const { savePrompt, prompts, categories, loadPrompts } = useSavedPromptsStore();
  const selectedBuildProjectId = useUsageProjectStore((state) => state.selectedBuildProjectId);
  const setSelectedUsageProject = useUsageProjectStore((state) => state.setSelectedProject);
  const usageProjects = useUsageProjectStore((state) => state.projects);
  const usageAssignees = useUsageProjectStore((state) => state.assignees);
  const loadUsageProjects = useUsageProjectStore((state) => state.loadProjects);
  const createUsageProject = useUsageProjectStore((state) => state.createProject);
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const focusBackground = focusScene ? getChatBackground(activeAgent?.appearance?.chatBackgroundId ?? readChatBackgroundId()) : null;

  const [workspaceRelativePath, setWorkspaceRelativePath] = useState('.');
  const [agentWorkspaceRoot, setAgentWorkspaceRoot] = useState<string | null>(null);
  const [presets, setPresets] = useState<BuildProjectPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | undefined>(undefined);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [sectionsDropdownOpen, setSectionsDropdownOpen] = useState(false);
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [workspacePathReady, setWorkspacePathReady] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [presetStartEntriesInput, setPresetStartEntriesInput] = useState<EditableBuildStartEntry[]>([]);
  const [presetBuildCommandInput, setPresetBuildCommandInput] = useState('');
  const [presetRunCommandInput, setPresetRunCommandInput] = useState('');
  const [presetTypecheckCommandInput, setPresetTypecheckCommandInput] = useState('');
  const [presetLintCommandInput, setPresetLintCommandInput] = useState('');
  const [presetTestCommandInput, setPresetTestCommandInput] = useState('');
  const [askAiToRunTests, setAskAiToRunTests] = useState(false);
  const [presetUsageProjectIdInput, setPresetUsageProjectIdInput] = useState<string | null>(null);
  const [presetUsageProjectDirty, setPresetUsageProjectDirty] = useState(false);
  const [presetEnvProfiles, setPresetEnvProfiles] = useState<BuildEnvProfile[]>([createDefaultEnvProfile()]);
  const [presetActiveEnvProfileId, setPresetActiveEnvProfileId] = useState<string | undefined>(undefined);
  const [presetEnvEditorText, setPresetEnvEditorText] = useState('');
  const [workspaceSetupOpen, setWorkspaceSetupOpen] = useState(false);
  const [workspaceSetupScanning, setWorkspaceSetupScanning] = useState(false);
  const [workspaceSetupLastScanAt, setWorkspaceSetupLastScanAt] = useState<string | null>(null);
  const [recipeCatalogOpen, setRecipeCatalogOpen] = useState(false);
  const [selectedRecipeCategory, setSelectedRecipeCategory] = useState<BuildRecipeCategory>('Build');
  const [recipeNotice, setRecipeNotice] = useState<string | null>(null);
  const [savedPromptsOpen, setSavedPromptsOpen] = useState(false);
  const [savedPromptsMode, setSavedPromptsMode] = useState<'select' | 'manage'>('select');
  const [projectWorkPopupOpen, setProjectWorkPopupOpen] = useState(false);
  const [projectWorkPopupInitialProjectId, setProjectWorkPopupInitialProjectId] = useState<string | null>(null);
  const [projectWorkPopupAnchorRect, setProjectWorkPopupAnchorRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
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
  const [runtimeScreenshotSelecting, setRuntimeScreenshotSelecting] = useState(false);
  const [runtimeScreenshotCapturing, setRuntimeScreenshotCapturing] = useState(false);
  const [runtimeScreenshotCaptureMenuOpen, setRuntimeScreenshotCaptureMenuOpen] = useState(false);
  const [runtimeScreenshotEditor, setRuntimeScreenshotEditor] = useState<RuntimeScreenshotEditorState | null>(null);
  const [runtimeScreenshotEditorFullscreen, setRuntimeScreenshotEditorFullscreen] = useState(false);
  const [runtimeScreenshotEditorZoom, setRuntimeScreenshotEditorZoom] = useState(1);
  const [runtimeScreenshotHistoryCounts, setRuntimeScreenshotHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [runtimeScreenshotAnnotationClipboardReady, setRuntimeScreenshotAnnotationClipboardReady] = useState(false);
  const [diff, setDiff] = useState<BuildWorkspaceDiff | null>(null);
  const [buildDiffEnforcementMode, setBuildDiffEnforcementMode] = useState<BuildDiffEnforcementMode>('preview-only');
  const [pendingDiffBaselineId, setPendingDiffBaselineId] = useState<string | null>(null);
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<string | null>(null);
  const [selectedDiffFileContent, setSelectedDiffFileContent] = useState<BuildWorkspaceDiffFileContent | null>(null);
  const [selectedDiffFileContentBusy, setSelectedDiffFileContentBusy] = useState(false);
  const [selectedDiffFileContentError, setSelectedDiffFileContentError] = useState<string | null>(null);
  const [diffPanelHost, setDiffPanelHost] = useState<HTMLDivElement | null>(null);
  const [resolvingDiffDecision, setResolvingDiffDecision] = useState<'approve' | 'reject' | null>(null);
  const [gitSummary, setGitSummary] = useState<BuildGitSummary | null>(null);
  const [gitSummaryBusy, setGitSummaryBusy] = useState(false);
  const [gitActionBusy, setGitActionBusy] = useState<
    'init'
    | 'commit'
    | 'push'
    | 'add-remote'
    | 'update-remote'
    | 'fetch'
    | 'pull'
    | 'switch-branch'
    | 'create-branch'
    | 'discard'
    | 'resolve-mismatch'
    | 'stage-files'
    | 'finish-merge'
    | 'stash-create'
    | 'stash-apply'
    | 'stash-drop'
    | 'checkout-remote'
    | 'restore-backup'
    | null
  >(null);
  const [gitActionNotice, setGitActionNotice] = useState<string | null>(null);
  const [gitActionHints, setGitActionHints] = useState<string[]>([]);
  const [gitCommitMessage, setGitCommitMessage] = useState('');
  const [gitCommitPushAfter, setGitCommitPushAfter] = useState(false);
  const [gitCommitDialogOpen, setGitCommitDialogOpen] = useState(false);
  const [gitRemoteDialogOpen, setGitRemoteDialogOpen] = useState(false);
  const [gitRemoteProvider, setGitRemoteProvider] = useState<BuildGitRemoteProvider>('github');
  const [gitRemoteName, setGitRemoteName] = useState('origin');
  const [gitRemoteUrl, setGitRemoteUrl] = useState('');
  const [gitRemoteEditDialogOpen, setGitRemoteEditDialogOpen] = useState(false);
  const [gitRemoteEditName, setGitRemoteEditName] = useState('origin');
  const [gitRemoteEditUrl, setGitRemoteEditUrl] = useState('');
  const [gitPushBranchName, setGitPushBranchName] = useState('');
  const [gitPushDialogOpen, setGitPushDialogOpen] = useState(false);
  const [gitPullDialogOpen, setGitPullDialogOpen] = useState(false);
  const [gitBranchDialogOpen, setGitBranchDialogOpen] = useState(false);
  const [gitBranchMode, setGitBranchMode] = useState<'switch' | 'create'>('switch');
  const [gitBranchName, setGitBranchName] = useState('');
  const [gitDiscardDialogOpen, setGitDiscardDialogOpen] = useState(false);
  const [gitDiscardPath, setGitDiscardPath] = useState('');
  const [gitMismatchDialogOpen, setGitMismatchDialogOpen] = useState(false);
  const [gitMismatchSummary, setGitMismatchSummary] = useState<BuildGitMismatchSummary | null>(null);
  const [gitMismatchBusy, setGitMismatchBusy] = useState(false);
  const [gitMismatchAction, setGitMismatchAction] = useState<BuildGitResolveMismatchAction>('merge');
  const [gitMismatchCreateBackup, setGitMismatchCreateBackup] = useState(true);
  const [gitMismatchBackupBranchName, setGitMismatchBackupBranchName] = useState('');
  const [gitMismatchView, setGitMismatchView] = useState<'resolve' | 'history' | 'recover'>('resolve');
  const [gitMergeCommitMessage, setGitMergeCommitMessage] = useState('Merge remote changes');
  const [gitSelectedConflictPaths, setGitSelectedConflictPaths] = useState<string[]>([]);
  const [gitStashes, setGitStashes] = useState<BuildGitStashEntry[]>([]);
  const [gitRemoteCreateDialogOpen, setGitRemoteCreateDialogOpen] = useState(false);
  const [gitRemoteCreateProvider, setGitRemoteCreateProvider] = useState<BuildGitRemoteProvider>('github');
  const [gitRemoteCreateName, setGitRemoteCreateName] = useState('');
  const [gitRemoteCreateVisibility, setGitRemoteCreateVisibility] = useState<'private' | 'public'>('private');
  const [gitRemoteCreateSteps, setGitRemoteCreateSteps] = useState<string[]>([]);
  const [gitPrDialogOpen, setGitPrDialogOpen] = useState(false);
  const [gitPrTitle, setGitPrTitle] = useState('');
  const [gitPrBody, setGitPrBody] = useState('');
  const [gitPrSteps, setGitPrSteps] = useState<string[]>([]);
  const [showGitHelpTips, setShowGitHelpTips] = useState(() => window.localStorage.getItem('opendeskmate:build-git-help-tips') !== 'off');
  const [gitInitDialogOpen, setGitInitDialogOpen] = useState(false);
  const [gitReviewDialogOpen, setGitReviewDialogOpen] = useState(false);
  const [gitReviewDialogFullscreen, setGitReviewDialogFullscreen] = useState(false);
  const [gitReviewTab, setGitReviewTab] = useState<'overview' | 'files' | 'diff' | 'git' | 'sources'>('overview');
  const [diffPanelWidth, setDiffPanelWidth] = useState(0);
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
  const [journeyTask, setJourneyTask] = useState<Task | null>(null);
  const [activeBuildPromptNavigatorId, setActiveBuildPromptNavigatorId] = useState<string | null>(null);
  const [qualityCheckRun, setQualityCheckRun] = useState<BuildQualityCheckRun | null>(null);
  const [qualityChecksBusy, setQualityChecksBusy] = useState(false);
  const [dismissedQualityCheckSuggestionKey, setDismissedQualityCheckSuggestionKey] = useState<string | null>(null);
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
  const [projectNoteSavingMessageId, setProjectNoteSavingMessageId] = useState<string | null>(null);
  const [rtfSavingMessageId, setRtfSavingMessageId] = useState<string | null>(null);
  const [projectNoteNotice, setProjectNoteNotice] = useState<string | null>(null);
  const [projectNoteDialogOpen, setProjectNoteDialogOpen] = useState(false);
  const [projectNoteDialogMode, setProjectNoteDialogMode] = useState<'existing-project' | 'new-project'>('existing-project');
  const [projectNoteTargetProjectId, setProjectNoteTargetProjectId] = useState('');
  const [projectNoteTargetWorkItemId, setProjectNoteTargetWorkItemId] = useState('');
  const [projectNoteTitle, setProjectNoteTitle] = useState('');
  const [projectNoteNewProjectName, setProjectNoteNewProjectName] = useState('');
  const [projectNoteNewWorkItemTitle, setProjectNoteNewWorkItemTitle] = useState('');
  const [projectNoteWorkItems, setProjectNoteWorkItems] = useState<UsageProjectWorkItem[]>([]);
  const [projectNoteWorkItemsProjectId, setProjectNoteWorkItemsProjectId] = useState('');
  const [projectNoteWorkItemsLoading, setProjectNoteWorkItemsLoading] = useState(false);
  const [projectNotePending, setProjectNotePending] = useState<{ messageId: string; content: string; html?: string } | null>(null);
  const [rtfDialogOpen, setRtfDialogOpen] = useState(false);
  const [rtfAttachToWorkItem, setRtfAttachToWorkItem] = useState(false);
  const [rtfDialogMode, setRtfDialogMode] = useState<'existing-project' | 'new-project'>('existing-project');
  const [rtfTargetProjectId, setRtfTargetProjectId] = useState('');
  const [rtfTargetWorkItemId, setRtfTargetWorkItemId] = useState('');
  const [rtfFileTitle, setRtfFileTitle] = useState('');
  const [rtfNewProjectName, setRtfNewProjectName] = useState('');
  const [rtfNewWorkItemTitle, setRtfNewWorkItemTitle] = useState('');
  const [rtfWorkItems, setRtfWorkItems] = useState<UsageProjectWorkItem[]>([]);
  const [rtfWorkItemsProjectId, setRtfWorkItemsProjectId] = useState('');
  const [rtfWorkItemsLoading, setRtfWorkItemsLoading] = useState(false);
  const [rtfPending, setRtfPending] = useState<{ messageId: string; content: string; rtf: string } | null>(null);
  const [runtimeScreenshotDocumentDialogOpen, setRuntimeScreenshotDocumentDialogOpen] = useState(false);
  const [runtimeScreenshotDocumentPending, setRuntimeScreenshotDocumentPending] = useState<{ dataUrl: string } | null>(null);
  const [runtimeScreenshotDocumentSaving, setRuntimeScreenshotDocumentSaving] = useState(false);
  const [runtimeScreenshotDocumentFileTitle, setRuntimeScreenshotDocumentFileTitle] = useState('');
  const [runtimeScreenshotDocumentDialogMode, setRuntimeScreenshotDocumentDialogMode] = useState<'existing-project' | 'new-project'>('existing-project');
  const [runtimeScreenshotDocumentTargetProjectId, setRuntimeScreenshotDocumentTargetProjectId] = useState('');
  const [runtimeScreenshotDocumentTargetWorkItemId, setRuntimeScreenshotDocumentTargetWorkItemId] = useState('');
  const [runtimeScreenshotDocumentNewProjectName, setRuntimeScreenshotDocumentNewProjectName] = useState('');
  const [runtimeScreenshotDocumentNewWorkItemTitle, setRuntimeScreenshotDocumentNewWorkItemTitle] = useState('');
  const [runtimeScreenshotDocumentWorkItems, setRuntimeScreenshotDocumentWorkItems] = useState<UsageProjectWorkItem[]>([]);
  const [runtimeScreenshotDocumentWorkItemsProjectId, setRuntimeScreenshotDocumentWorkItemsProjectId] = useState('');
  const [runtimeScreenshotDocumentWorkItemsLoading, setRuntimeScreenshotDocumentWorkItemsLoading] = useState(false);
  const [runtimeScreenshotDocumentError, setRuntimeScreenshotDocumentError] = useState<string | null>(null);
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
  const [runtimePreviewSectionHidden, setRuntimePreviewSectionHidden] = useState(false);
  const [buildFingerprintCollapsed, setBuildFingerprintCollapsed] = useState(false);
  const [terminalSectionHidden, setTerminalSectionHidden] = useState(false);
  const [runtimeLogsSectionHidden, setRuntimeLogsSectionHidden] = useState(false);
  const [diffSectionHidden, setDiffSectionHidden] = useState(false);
  const [hiddenSectionLocks, setHiddenSectionLocks] = useState<BuildHiddenSectionLocks>({});
  const [buildLowerPanelHeight, setBuildLowerPanelHeight] = useState(192);
  const [workspacePanelWidth, setWorkspacePanelWidth] = useState(BUILD_WORKSPACE_PANEL_DEFAULT_WIDTH);
  const [operatorPanelWidth, setOperatorPanelWidth] = useState(BUILD_OPERATOR_PANEL_DEFAULT_WIDTH);
  const [terminalPanelWidth, setTerminalPanelWidth] = useState(BUILD_TERMINAL_PANEL_DEFAULT_WIDTH);
  const [runtimeLogsPanelWidth, setRuntimeLogsPanelWidth] = useState(BUILD_RUNTIME_LOGS_PANEL_DEFAULT_WIDTH);
  const [lowerPanelsAvailableWidth, setLowerPanelsAvailableWidth] = useState(0);

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem('opendeskmate:build-git-help-tips', showGitHelpTips ? 'on' : 'off');
  }, [showGitHelpTips]);

  const buildPageRef = useRef<HTMLDivElement | null>(null);
  const terminalSnapshotRequestIdRef = useRef(0);
  const assistantMessagesVirtuosoRef = useRef<VirtuosoHandle | null>(null);
  const assistantMessageContentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const restoringHistoryRef = useRef(false);
  const pendingHistoryRestoreScrollRef = useRef(false);
  const historyRowRef = useRef<HTMLDivElement | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const projectNoteNoticeTimeoutRef = useRef<number | null>(null);
  const projectNoteTitleRef = useRef('');
  const rtfFileTitleRef = useRef('');
  const projectNoteWorkItemsRequestRef = useRef(0);
  const rtfWorkItemsRequestRef = useRef(0);
  const runtimeScreenshotDocumentFileTitleRef = useRef('');
  const runtimeScreenshotDocumentWorkItemsRequestRef = useRef(0);
  const assistantNearBottomRef = useRef(true);
  const restoringEditorLayoutRef = useRef(false);
  const pendingWorkspaceCreateInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkspaceRenameInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceTreeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const centerColumnRef = useRef<HTMLDivElement | null>(null);
  const lowerPanelsGridRef = useRef<HTMLDivElement | null>(null);
  const workspacePanelCardRef = useRef<HTMLDivElement | null>(null);
  const runtimePreviewCaptureRef = useRef<HTMLDivElement | null>(null);
  const runtimeScreenshotSelectionRef = useRef<RuntimeScreenshotSelection | null>(null);
  const runtimeScreenshotSelectionRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const runtimeScreenshotSelectionDraggingRef = useRef(false);
  const runtimeScreenshotFrameRef = useRef<number | null>(null);
  const runtimeScreenshotSelectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeScreenshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeScreenshotInlineTextInputRef = useRef<HTMLTextAreaElement | null>(null);
  const runtimeScreenshotTextBoxMoveHandleRef = useRef<HTMLButtonElement | null>(null);
  const runtimeScreenshotTextBoxResizeHandleRef = useRef<HTMLButtonElement | null>(null);
  const runtimeScreenshotEditorRef = useRef<RuntimeScreenshotEditorState | null>(null);
  const runtimeScreenshotCanvasFrameRef = useRef<number | null>(null);
  const runtimeScreenshotBaseImageRef = useRef<{ dataUrl: string; image: HTMLImageElement; loaded: boolean } | null>(null);
  const runtimeScreenshotUndoStackRef = useRef<RuntimeScreenshotEditorHistorySnapshot[]>([]);
  const runtimeScreenshotRedoStackRef = useRef<RuntimeScreenshotEditorHistorySnapshot[]>([]);
  const runtimeScreenshotAnnotationClipboardRef = useRef<RuntimeScreenshotAnnotation | null>(null);
  const runtimeScreenshotAnnotationPasteCountRef = useRef(0);
  const runtimeScreenshotTextEditBaseRef = useRef<RuntimeScreenshotEditorState | null>(null);
  const runtimeScreenshotTextEditHistoryPushedRef = useRef(false);
  const runtimeScreenshotDrawingBaseRef = useRef<RuntimeScreenshotEditorState | null>(null);
  const runtimeScreenshotLastFocusedTextIdRef = useRef<string | null>(null);
  const runtimeScreenshotTextBoxDragRef = useRef<{
    mode: 'move' | 'resize';
    annotationId: string;
    startX: number;
    startY: number;
    original: Extract<RuntimeScreenshotAnnotation, { type: 'text' }>;
    baseEditor: RuntimeScreenshotEditorState;
    changed: boolean;
  } | null>(null);
  const runtimeScreenshotDrawingIdRef = useRef<string | null>(null);
  const runtimeScreenshotAnnotationDragRef = useRef<{
    mode: 'move' | 'resize';
    annotationId: string;
    startX: number;
    startY: number;
    original: RuntimeScreenshotAnnotation;
    baseEditor: RuntimeScreenshotEditorState;
    handle?: RuntimeScreenshotResizeHandle;
    moved: boolean;
  } | null>(null);
  const diffPanelRef = useRef<HTMLDivElement | null>(null);
  const activeRunDiffBaselineIdRef = useRef<string | null>(null);
  const activeRunSummaryIdRef = useRef<string | null>(null);
  const lastRunningGitSummaryRefreshAtRef = useRef(0);
  const runningChangeRefreshInFlightRef = useRef(false);
  const workspaceTreeRequestIdRef = useRef(0);
  const buildLowerPanelHeightRef = useRef(buildLowerPanelHeight);
  const workspacePanelWidthRef = useRef(workspacePanelWidth);
  const operatorPanelWidthRef = useRef(operatorPanelWidth);
  const terminalPanelWidthRef = useRef(terminalPanelWidth);
  const runtimeLogsPanelWidthRef = useRef(runtimeLogsPanelWidth);
  const aiBusyRef = useRef(aiBusy);
  const aiTaskIdRef = useRef<string | null>(aiTaskId);
  const buildActivityVersionRef = useRef(0);
  const submittingBuildPromptRef = useRef(false);
  const goalPromptDraftRef = useRef('');
  const aiMessagesRef = useRef<TaskMessage[]>([]);
  const restoreHistorySessionRef = useRef<(sessionId: string) => Promise<void>>(async () => {});
  const activeBuildTooltipElementRef = useRef<HTMLElement | null>(null);
  const buildTooltipElementRef = useRef<HTMLDivElement | null>(null);
  const runAiGoalActionRef = useRef<(value: string) => void>(() => {});
  const interruptBuildTaskActionRef = useRef<() => void>(() => {});

  useEffect(() => {
    const root = buildPageRef.current;
    if (!root) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'pointer-events-none fixed z-[90] hidden max-w-xs rounded-md border border-border/70 bg-popover px-2 py-1.5 text-[11px] leading-relaxed text-popover-foreground shadow-md whitespace-pre-line';
    document.body.appendChild(tooltip);
    buildTooltipElementRef.current = tooltip;

    const hideTooltip = () => {
      activeBuildTooltipElementRef.current = null;
      tooltip.classList.add('hidden');
      tooltip.textContent = '';
    };

    const showTooltip = (element: HTMLElement, content: string) => {
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth || 1280;
      const tooltipHalfWidth = 160;
      const clampedLeft = Math.min(
        Math.max(rect.left + rect.width / 2, tooltipHalfWidth + 12),
        viewportWidth - tooltipHalfWidth - 12
      );
      const showBelow = rect.top < 120;

      activeBuildTooltipElementRef.current = element;
      tooltip.textContent = content;
      tooltip.style.left = `${clampedLeft}px`;
      tooltip.style.top = `${showBelow ? rect.top + 18 : Math.max(12, rect.top - 12)}px`;
      tooltip.style.transform = showBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)';
      tooltip.classList.remove('hidden');
    };

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
        hideTooltip();
        return;
      }

      const content = element.getAttribute(BUILD_HOVER_TOOLTIP_ATTR);
      if (!content) {
        hideTooltip();
        return;
      }

      if (activeBuildTooltipElementRef.current === element) {
        return;
      }

      showTooltip(element, content);
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
        hideTooltip();
        return;
      }
      if (relatedTarget && currentTarget.contains(relatedTarget)) {
        return;
      }
      hideTooltip();
    };
    const handleScroll = () => {
      if (!activeBuildTooltipElementRef.current) return;
      hideTooltip();
    };

    root.addEventListener('mouseover', handleMouseOver);
    root.addEventListener('mouseout', handleMouseOut);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      root.removeEventListener('mouseover', handleMouseOver);
      root.removeEventListener('mouseout', handleMouseOut);
      window.removeEventListener('scroll', handleScroll, true);
      buildTooltipElementRef.current = null;
      tooltip.remove();
      activeBuildTooltipElementRef.current = null;
    };
  }, []);

  useEffect(() => {
    aiMessagesRef.current = aiMessages;
  }, [aiMessages]);

  useEffect(() => {
    aiBusyRef.current = aiBusy;
    aiTaskIdRef.current = aiTaskId;
  }, [aiBusy, aiTaskId]);

  useEffect(() => () => {
    if (projectNoteNoticeTimeoutRef.current !== null) {
      window.clearTimeout(projectNoteNoticeTimeoutRef.current);
      projectNoteNoticeTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    void loadUsageProjects(true);
  }, [loadUsageProjects]);

  const assistantMessages = useMemo(() => collectAssistantMessages(aiMessages), [aiMessages]);
  const buildToolStateMessages = useMemo(
    () => assistantMessages.length > BUILD_TOOL_STATE_MESSAGE_SCAN_LIMIT
      ? assistantMessages.slice(-BUILD_TOOL_STATE_MESSAGE_SCAN_LIMIT)
      : assistantMessages,
    [assistantMessages]
  );
  const buildAgentPresence = useMemo(
    () => getLatestToolPresenceFromMessages(buildToolStateMessages, aiBusy ? 'running' : undefined, false),
    [aiBusy, buildToolStateMessages]
  );
  const buildToolActivitySteps = useMemo(
    () => getToolActivityStepsFromMessages(buildToolStateMessages, aiBusy),
    [aiBusy, buildToolStateMessages]
  );
  const buildPromptNavigatorEntries = useMemo<PromptNavigatorEntry[]>(() => {
    const cleanEntries = assistantMessages
      .flatMap((message, index): PromptNavigatorEntry[] => {
        if (message.type !== 'user' || isBuildModeGoalPanelMessage(message)) return [];
        const content = extractBuildPromptNavigatorText(message);
        return [{
          id: message.id,
          messageIndex: index,
          preview: createPromptPreview(content),
          fullText: content,
          timestamp: message.timestamp,
        }];
      });

    if (cleanEntries.length > 0) return cleanEntries;

    return assistantMessages
      .flatMap((message, index): PromptNavigatorEntry[] => {
        if (!isBuildModeGoalPanelMessage(message)) return [];
        const content = extractBuildPromptNavigatorText(message);
        return [{
          id: message.id,
          messageIndex: index,
          preview: createPromptPreview(content),
          fullText: content,
          timestamp: message.timestamp,
        }];
      });
  }, [assistantMessages]);

  useEffect(() => {
    const next = activeBuildPromptNavigatorId && buildPromptNavigatorEntries.some(entry => entry.id === activeBuildPromptNavigatorId)
      ? activeBuildPromptNavigatorId
      : buildPromptNavigatorEntries[0]?.id ?? null;
    if (next !== activeBuildPromptNavigatorId) setActiveBuildPromptNavigatorId(next);
  }, [activeBuildPromptNavigatorId, buildPromptNavigatorEntries]);

  const handleBuildPromptNavigatorRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (buildPromptNavigatorEntries.length === 0) return;
    const midpoint = (range.startIndex + range.endIndex) / 2;
    let activeEntry = buildPromptNavigatorEntries[0];
    for (const entry of buildPromptNavigatorEntries) {
      if (entry.messageIndex <= midpoint) {
        activeEntry = entry;
      } else {
        break;
      }
    }
    setActiveBuildPromptNavigatorId((current) => current === activeEntry.id ? current : activeEntry.id);
  }, [buildPromptNavigatorEntries]);

  const handleBuildPromptNavigatorJump = useCallback((entry: PromptNavigatorEntry) => {
    setActiveBuildPromptNavigatorId(entry.id);
    assistantNearBottomRef.current = false;
    setAssistantNearBottom(false);
    assistantMessagesVirtuosoRef.current?.scrollToIndex({
      index: entry.messageIndex,
      align: 'start',
      behavior: 'smooth',
    });
  }, []);

  const scrollAssistantMessagesToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    if (assistantMessages.length === 0) return;
    assistantMessagesVirtuosoRef.current?.scrollToIndex({
      index: assistantMessages.length - 1,
      align: 'end',
      behavior,
    });
    if (!assistantNearBottomRef.current) {
      assistantNearBottomRef.current = true;
      setAssistantNearBottom(true);
    }
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
  const openProjectWorkPopup = useCallback(() => {
    const rect = workspacePanelCardRef.current?.getBoundingClientRect();
    setProjectWorkPopupAnchorRect(rect
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : null);
    setProjectWorkPopupInitialProjectId(selectedPreset?.usageProjectId || null);
    setProjectWorkPopupOpen(true);
  }, [selectedPreset?.usageProjectId]);
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
  const requestedTaskWindowSessionId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('sessionId')?.trim() || null;
  }, [location.search]);
  const hasVisibleBuildLowerPanel = !terminalSectionHidden || !runtimeLogsSectionHidden || !diffSectionHidden;
  const hasVisibleBuildCenterArea = !runtimePreviewSectionHidden || hasVisibleBuildLowerPanel;
  const visibleBuildLowerPanelCount = [
    !terminalSectionHidden,
    !runtimeLogsSectionHidden,
    !diffSectionHidden,
  ].filter(Boolean).length;
  const buildMainGridTemplate = useMemo(() => {
    const operatorColumn = `${operatorPanelWidth}px`;
    if (!hasVisibleBuildCenterArea) {
      return leftPanelCollapsed
        ? 'minmax(0, 1fr)'
        : `${workspacePanelWidth}px minmax(${BUILD_OPERATOR_PANEL_MIN_WIDTH}px, 1fr)`;
    }
    return leftPanelCollapsed
      ? `minmax(0, 1fr) ${operatorColumn}`
      : `${workspacePanelWidth}px minmax(0, 1fr) ${operatorColumn}`;
  }, [hasVisibleBuildCenterArea, leftPanelCollapsed, operatorPanelWidth, workspacePanelWidth]);
  const buildLowerPanelGridTemplate = useMemo(() => {
    const visibleSections = [
      !terminalSectionHidden ? 'terminal' : null,
      !runtimeLogsSectionHidden ? 'logs' : null,
      !diffSectionHidden ? 'diff' : null,
    ].filter((section): section is 'terminal' | 'logs' | 'diff' => Boolean(section));
    if (visibleSections.length <= 1) return 'minmax(0, 1fr)';
    const gapWidth = Math.max(0, visibleSections.length - 1) * BUILD_LOWER_PANEL_GRID_GAP;
    const availableTrackWidth = Math.max(0, lowerPanelsAvailableWidth - gapWidth);
    let terminalWidth = terminalPanelWidth;
    let logsWidth = runtimeLogsPanelWidth;

    if (availableTrackWidth > 0) {
      const reserves =
        (!terminalSectionHidden ? BUILD_TERMINAL_PANEL_MIN_WIDTH : 0)
        + (!runtimeLogsSectionHidden ? BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH : 0)
        + (!diffSectionHidden ? BUILD_DIFF_PANEL_MIN_WIDTH : 0);
      if (availableTrackWidth < reserves) {
        return visibleSections.map(() => 'minmax(0, 1fr)').join(' ');
      }

      if (!terminalSectionHidden && !runtimeLogsSectionHidden && !diffSectionHidden) {
        const fixedBudget = availableTrackWidth - BUILD_DIFF_PANEL_MIN_WIDTH;
        terminalWidth = clampNumber(
          terminalPanelWidth,
          BUILD_TERMINAL_PANEL_MIN_WIDTH,
          Math.max(BUILD_TERMINAL_PANEL_MIN_WIDTH, fixedBudget - BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH)
        );
        logsWidth = clampNumber(
          runtimeLogsPanelWidth,
          BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH,
          Math.max(BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH, fixedBudget - terminalWidth)
        );
      } else if (!terminalSectionHidden && !runtimeLogsSectionHidden && diffSectionHidden) {
        terminalWidth = clampNumber(
          terminalPanelWidth,
          BUILD_TERMINAL_PANEL_MIN_WIDTH,
          Math.max(BUILD_TERMINAL_PANEL_MIN_WIDTH, availableTrackWidth - BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH)
        );
      } else if (terminalSectionHidden && !runtimeLogsSectionHidden && !diffSectionHidden) {
        logsWidth = clampNumber(
          runtimeLogsPanelWidth,
          BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH,
          Math.max(BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH, availableTrackWidth - BUILD_DIFF_PANEL_MIN_WIDTH)
        );
      } else if (!terminalSectionHidden && runtimeLogsSectionHidden && !diffSectionHidden) {
        terminalWidth = clampNumber(
          terminalPanelWidth,
          BUILD_TERMINAL_PANEL_MIN_WIDTH,
          Math.max(BUILD_TERMINAL_PANEL_MIN_WIDTH, availableTrackWidth - BUILD_DIFF_PANEL_MIN_WIDTH)
        );
      }
    }

    return visibleSections.map((section, index) => {
      const isLast = index === visibleSections.length - 1;
      if (section === 'terminal') {
        return isLast ? 'minmax(0, 1fr)' : `${terminalWidth}px`;
      }
      if (section === 'logs') {
        return isLast ? `minmax(0, 1fr)` : `${logsWidth}px`;
      }
      return `minmax(0, 1fr)`;
    }).join(' ');
  }, [
    diffSectionHidden,
    lowerPanelsAvailableWidth,
    runtimeLogsPanelWidth,
    runtimeLogsSectionHidden,
    terminalPanelWidth,
    terminalSectionHidden,
  ]);
  const hiddenBuildSections = useMemo(() => {
    const hidden: string[] = [];
    if (leftPanelCollapsed) hidden.push('Project & Workspace');
    if (runtimePreviewSectionHidden) hidden.push('Runtime Preview');
    if (terminalSectionHidden) hidden.push('Terminal');
    if (runtimeLogsSectionHidden) hidden.push('Runtime Logs');
    if (diffSectionHidden) hidden.push('Changes & Git');
    return hidden;
  }, [diffSectionHidden, leftPanelCollapsed, runtimeLogsSectionHidden, runtimePreviewSectionHidden, terminalSectionHidden]);
  const aiBuildOperatorOnlyActive = leftPanelCollapsed
    && runtimePreviewSectionHidden
    && terminalSectionHidden
    && runtimeLogsSectionHidden
    && diffSectionHidden;
  const aiBuildOperatorOnlyLocked = useMemo(
    () => BUILD_SECTION_KEYS.every((section) => hiddenSectionLocks[section]),
    [hiddenSectionLocks]
  );
  const setBuildSectionHidden = useCallback((section: BuildSectionKey, hidden: boolean) => {
    if (section === 'workspace') setLeftPanelCollapsed(hidden);
    if (section === 'runtimePreview') setRuntimePreviewSectionHidden(hidden);
    if (section === 'terminal') setTerminalSectionHidden(hidden);
    if (section === 'runtimeLogs') setRuntimeLogsSectionHidden(hidden);
    if (section === 'diff') setDiffSectionHidden(hidden);
    if (!hidden) {
      setHiddenSectionLocks((current) => {
        if (!current[section]) return current;
        const next = { ...current };
        delete next[section];
        return next;
      });
    }
  }, []);
  const toggleHiddenSectionLock = useCallback((section: BuildSectionKey) => {
    const isLocked = Boolean(hiddenSectionLocks[section]);
    if (!isLocked) {
      setBuildSectionHidden(section, true);
      setHiddenSectionLocks((current) => ({ ...current, [section]: true }));
      return;
    }
    setHiddenSectionLocks((current) => {
      const next = { ...current };
      delete next[section];
      return next;
    });
  }, [hiddenSectionLocks, setBuildSectionHidden]);
  const toggleAiBuildOperatorOnly = useCallback(() => {
    BUILD_SECTION_KEYS.forEach((section) => setBuildSectionHidden(section, !aiBuildOperatorOnlyActive));
  }, [aiBuildOperatorOnlyActive, setBuildSectionHidden]);
  const toggleAiBuildOperatorOnlyLock = useCallback(() => {
    if (aiBuildOperatorOnlyLocked) {
      setHiddenSectionLocks({});
      return;
    }
    BUILD_SECTION_KEYS.forEach((section) => setBuildSectionHidden(section, true));
    setHiddenSectionLocks(BUILD_SECTION_KEYS.reduce<BuildHiddenSectionLocks>((next, section) => {
      next[section] = true;
      return next;
    }, {}));
  }, [aiBuildOperatorOnlyLocked, setBuildSectionHidden]);
  const keepSectionsDropdownOpen = useCallback(() => {
    window.requestAnimationFrame(() => {
      setSectionsDropdownOpen(true);
    });
  }, []);
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
    if (!hasVisibleBuildLowerPanel || runtimePreviewSectionHidden) return;
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
  }, [clampBuildLowerPanelHeight, hasVisibleBuildLowerPanel, runtimePreviewSectionHidden]);

  const handleWorkspacePanelResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = workspacePanelWidthRef.current;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setWorkspacePanelWidth(clampNumber(
        startWidth + deltaX,
        BUILD_WORKSPACE_PANEL_MIN_WIDTH,
        BUILD_WORKSPACE_PANEL_MAX_WIDTH
      ));
    };

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleOperatorPanelResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = operatorPanelWidthRef.current;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      setOperatorPanelWidth(clampNumber(
        startWidth + deltaX,
        BUILD_OPERATOR_PANEL_MIN_WIDTH,
        BUILD_OPERATOR_PANEL_MAX_WIDTH
      ));
    };

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleRuntimeLogsLeftResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (terminalSectionHidden || runtimeLogsSectionHidden) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startTerminalWidth = terminalPanelWidthRef.current;
    const startLogsWidth = runtimeLogsPanelWidthRef.current;
    const containerWidth = lowerPanelsGridRef.current?.clientWidth ?? 0;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const visibleCount = visibleBuildLowerPanelCount;
    const gridGaps = Math.max(0, visibleCount - 1) * BUILD_LOWER_PANEL_GRID_GAP;
    const totalWidth = diffSectionHidden && containerWidth > 0
      ? Math.max(
          BUILD_TERMINAL_PANEL_MIN_WIDTH + BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH,
          containerWidth - gridGaps
        )
      : startTerminalWidth + startLogsWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const nextTerminalWidth = clampNumber(
        startTerminalWidth + deltaX,
        BUILD_TERMINAL_PANEL_MIN_WIDTH,
        Math.max(BUILD_TERMINAL_PANEL_MIN_WIDTH, totalWidth - BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH)
      );
      setTerminalPanelWidth(nextTerminalWidth);
      setRuntimeLogsPanelWidth(clampNumber(
        totalWidth - nextTerminalWidth,
        BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH,
        Math.max(BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH, totalWidth - BUILD_TERMINAL_PANEL_MIN_WIDTH)
      ));
    };

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [diffSectionHidden, runtimeLogsSectionHidden, terminalSectionHidden, visibleBuildLowerPanelCount]);

  const handleRuntimeLogsRightResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (runtimeLogsSectionHidden || diffSectionHidden) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startLogsWidth = runtimeLogsPanelWidthRef.current;
    const containerWidth = lowerPanelsGridRef.current?.clientWidth ?? 0;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const visibleCount = visibleBuildLowerPanelCount;
    const gridGaps = Math.max(0, visibleCount - 1) * BUILD_LOWER_PANEL_GRID_GAP;
    const fixedWidthBeforeLogs = terminalSectionHidden ? 0 : terminalPanelWidthRef.current;
    const maxLogsWidth = containerWidth > 0
      ? Math.max(
          BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH,
          containerWidth - fixedWidthBeforeLogs - BUILD_DIFF_PANEL_MIN_WIDTH - gridGaps
        )
      : BUILD_OPERATOR_PANEL_MAX_WIDTH;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setRuntimeLogsPanelWidth(clampNumber(
        startLogsWidth + deltaX,
        BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH,
        maxLogsWidth
      ));
    };

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [diffSectionHidden, runtimeLogsSectionHidden, terminalSectionHidden, visibleBuildLowerPanelCount]);

  const handleTerminalDiffResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (terminalSectionHidden || !runtimeLogsSectionHidden || diffSectionHidden) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startTerminalWidth = terminalPanelWidthRef.current;
    const containerWidth = lowerPanelsGridRef.current?.clientWidth ?? 0;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const visibleCount = visibleBuildLowerPanelCount;
    const gridGaps = Math.max(0, visibleCount - 1) * BUILD_LOWER_PANEL_GRID_GAP;
    const totalTrackWidth = containerWidth > 0
      ? Math.max(
          BUILD_TERMINAL_PANEL_MIN_WIDTH + BUILD_DIFF_PANEL_MIN_WIDTH,
          containerWidth - gridGaps
        )
      : startTerminalWidth + BUILD_DIFF_PANEL_MIN_WIDTH;
    const maxTerminalWidth = Math.max(
      BUILD_TERMINAL_PANEL_MIN_WIDTH,
      totalTrackWidth - BUILD_DIFF_PANEL_MIN_WIDTH
    );

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setTerminalPanelWidth(clampNumber(
        startTerminalWidth + deltaX,
        BUILD_TERMINAL_PANEL_MIN_WIDTH,
        maxTerminalWidth
      ));
    };

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [diffSectionHidden, runtimeLogsSectionHidden, terminalSectionHidden, visibleBuildLowerPanelCount]);

  useEffect(() => {
    buildLowerPanelHeightRef.current = buildLowerPanelHeight;
  }, [buildLowerPanelHeight]);

  useEffect(() => {
    workspacePanelWidthRef.current = workspacePanelWidth;
  }, [workspacePanelWidth]);

  useEffect(() => {
    operatorPanelWidthRef.current = operatorPanelWidth;
  }, [operatorPanelWidth]);

  useEffect(() => {
    terminalPanelWidthRef.current = terminalPanelWidth;
  }, [terminalPanelWidth]);

  useEffect(() => {
    runtimeLogsPanelWidthRef.current = runtimeLogsPanelWidth;
  }, [runtimeLogsPanelWidth]);

  useEffect(() => {
    if (!hasVisibleBuildLowerPanel) {
      setLowerPanelsAvailableWidth(0);
      return;
    }
    const element = lowerPanelsGridRef.current;
    if (!element) return;

    const updateWidth = () => {
      setLowerPanelsAvailableWidth(element.clientWidth);
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [diffSectionHidden, hasVisibleBuildLowerPanel, runtimeLogsSectionHidden, runtimePreviewSectionHidden, terminalSectionHidden]);

  useEffect(() => {
    if (!hasVisibleBuildLowerPanel || runtimePreviewSectionHidden) return;
    const syncLowerPanelHeight = () => {
      setBuildLowerPanelHeight((current) => clampBuildLowerPanelHeight(current));
    };
    syncLowerPanelHeight();
    window.addEventListener('resize', syncLowerPanelHeight);
    return () => window.removeEventListener('resize', syncLowerPanelHeight);
  }, [clampBuildLowerPanelHeight, hasVisibleBuildLowerPanel, runtimePreviewSectionHidden]);

  useEffect(() => {
    const element = diffPanelHost;
    if (!element) {
      setDiffPanelWidth(0);
      return;
    }
    const updateWidth = () => setDiffPanelWidth(element.clientWidth);
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [diffPanelHost]);
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

  const currentDiffSignature = useMemo(() => getBuildReviewDiffSignature(diff), [diff]);
  const changedDiffFiles = diff?.files || [];
  const changedFilesSummary = useMemo(() => buildChangedFilesSummary(diff, gitSummary), [diff, gitSummary]);
  const reviewFilesForGitPanel = useMemo(() => (
    gitSummary?.files.length
      ? gitSummary.files
      : changedFilesSummary.files.map((file) => ({
        relativePath: file.relativePath,
        status: file.changeType || 'modified',
        indexStatus: '',
        workingTreeStatus: '',
        staged: false,
        unstaged: true,
        untracked: false,
        addedLines: file.addedLines,
        deletedLines: file.deletedLines,
      }))
  ), [changedFilesSummary.files, gitSummary?.files]);
  const selectedReviewFilePath = useMemo(() => {
    if (selectedDiffFilePath && reviewFilesForGitPanel.some((file) => file.relativePath === selectedDiffFilePath)) {
      return selectedDiffFilePath;
    }
    if (selectedDiffFile?.relativePath && reviewFilesForGitPanel.some((file) => file.relativePath === selectedDiffFile.relativePath)) {
      return selectedDiffFile.relativePath;
    }
    return reviewFilesForGitPanel[0]?.relativePath ?? null;
  }, [reviewFilesForGitPanel, selectedDiffFile?.relativePath, selectedDiffFilePath]);
  useEffect(() => {
    if (!activeAgentId || !selectedReviewFilePath) {
      setSelectedDiffFileContent(null);
      setSelectedDiffFileContentBusy(false);
      setSelectedDiffFileContentError(null);
      return;
    }

    let cancelled = false;
    setSelectedDiffFileContentBusy(true);
    setSelectedDiffFileContentError(null);
    const baselineId = pendingDiffBaselineId || diff?.baselineId || undefined;

    accomplish.getBuildWorkspaceDiffFileContent({
      agentId: activeAgentId,
      relativePath: workspaceRelativePath,
      filePath: selectedReviewFilePath,
      baselineId,
    }).then((result) => {
      if (cancelled) return;
      setSelectedDiffFileContent(result);
    }).catch((err) => {
      if (cancelled) return;
      setSelectedDiffFileContent(null);
      setSelectedDiffFileContentError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (cancelled) return;
      setSelectedDiffFileContentBusy(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    accomplish,
    activeAgentId,
    diff?.baselineId,
    pendingDiffBaselineId,
    selectedReviewFilePath,
    workspaceRelativePath,
  ]);
  const effectiveChangedFileCount = gitSummary?.changedFileCount || changedFilesSummary.files.length;
  const effectiveAddedLines = gitSummary?.totalAddedLines ?? changedFilesSummary.totalAddedLines;
  const effectiveDeletedLines = gitSummary?.totalDeletedLines ?? changedFilesSummary.totalDeletedLines;
  const defaultCommitMessage = useMemo(
    () => buildDefaultCommitMessage(gitSummary, changedFilesSummary),
    [changedFilesSummary, gitSummary]
  );
  const diffPanelUsesMinimalGitView = !gitReviewDialogOpen && diffPanelWidth > 0 && diffPanelWidth < 420;
  const hasCurrentRunSyntheticDiff = Boolean(
    aiBusy
    && pendingDiffBaselineId
    && diff?.mode === 'synthetic'
    && diff.baselineId === pendingDiffBaselineId
  );
  const liveChangedFilesOverview = useMemo(() => {
    if (hasCurrentRunSyntheticDiff && changedFilesSummary.files.length > 0) {
      const singleFile = changedFilesSummary.files.length === 1 ? changedFilesSummary.files[0] : null;
      return {
        label: singleFile ? pathLeaf(singleFile.relativePath) : `${changedFilesSummary.files.length} files`,
        title: singleFile
          ? `Review changes in ${singleFile.relativePath}`
          : `Review ${changedFilesSummary.files.length} changed files`,
        reviewPath: singleFile?.relativePath,
        fileCount: changedFilesSummary.files.length,
        addedLines: changedFilesSummary.totalAddedLines,
        deletedLines: changedFilesSummary.totalDeletedLines,
      };
    }
    if (aiBusy && !pendingDiffBaselineId && gitSummary?.isRepository && gitSummary.changedFileCount > 0) {
      const singleFile = gitSummary.files.length === 1 ? gitSummary.files[0] : null;
      return {
        label: singleFile ? pathLeaf(singleFile.relativePath) : `${gitSummary.changedFileCount} files`,
        title: singleFile
          ? `Review changes in ${singleFile.relativePath}`
          : `Review ${gitSummary.changedFileCount} changed files`,
        reviewPath: singleFile?.relativePath,
        fileCount: gitSummary.changedFileCount,
        addedLines: gitSummary.totalAddedLines,
        deletedLines: gitSummary.totalDeletedLines,
      };
    }
    return null;
  }, [aiBusy, changedFilesSummary, gitSummary, hasCurrentRunSyntheticDiff, pendingDiffBaselineId]);
  const qualityChecksMatchCurrentDiff = Boolean(
    currentDiffSignature
    && qualityCheckRun?.diffSignature
    && qualityCheckRun.diffSignature === currentDiffSignature
  );
  const shouldSuggestQualityChecks = Boolean(
    currentDiffSignature
    && changedDiffFiles.length > 0
    && !aiBusy
    && !qualityChecksBusy
    && dismissedQualityCheckSuggestionKey !== currentDiffSignature
    && !qualityChecksMatchCurrentDiff
  );
  const buildReviewRuntimeStatus = snapshot?.runtime.status;
  const buildReviewRuntimeLabel = snapshot
    ? formatRuntimeStatus(snapshot.runtime.status)
    : 'Unknown';
  const buildReviewRuntimeDetail = snapshot?.runtime.healthMessage
    || snapshot?.runtime.lastError
    || (snapshot?.runtime.previewUrl ? `Preview: ${snapshot.runtime.previewUrl}` : 'No runtime status available.');
  const previewQualityCheck = qualityCheckRun?.checks.find((check) => check.kind === 'preview');
  const previewScreenshotSrc = buildLocalArtifactSrc(previewQualityCheck?.artifactPath);
  const workspaceSetupSuggestions = useMemo(
    () => buildWorkspaceSetupSuggestions(snapshot, workspaceTree, workspaceRelativePath),
    [snapshot, workspaceTree, workspaceRelativePath]
  );
  const promptLibraryItems = useMemo<BuildPromptLibraryItem[]>(() => [
    ...BUILD_RECIPES.map((recipe) => ({
      id: `recipe:${recipe.id}`,
      source: 'recipe' as const,
      category: recipe.category,
      title: recipe.title,
      description: recipe.description,
      prompt: recipe.prompt,
      tags: recipe.tags,
    })),
    ...prompts.map((prompt) => ({
      id: `saved:${prompt.id}`,
      source: 'saved' as const,
      category: prompt.category,
      title: prompt.title,
      description: 'Saved prompt',
      prompt: prompt.content,
      tags: ['saved'],
    })),
  ], [prompts]);
  const promptLibraryCategories = useMemo<BuildRecipeCategory[]>(
    () => mergePromptCategories(
      BUILD_RECIPE_CATEGORIES,
      categories,
      promptLibraryItems.map((item) => item.category)
    ),
    [categories, promptLibraryItems]
  );
  useEffect(() => {
    if (!promptLibraryCategories.includes(selectedRecipeCategory)) {
      setSelectedRecipeCategory(promptLibraryCategories[0] || 'Build');
    }
  }, [promptLibraryCategories, selectedRecipeCategory]);
  const selectedPromptLibraryItems = useMemo(
    () => promptLibraryItems.filter((item) => item.category === selectedRecipeCategory),
    [promptLibraryItems, selectedRecipeCategory]
  );
  const shouldShowWorkspaceSetupPrompt = Boolean(
    presetsLoaded
    && workspacePathReady
    && snapshot
    && !selectedPreset
  );

  const activeEnvProfile = useMemo(() => {
    if (!selectedPreset) return null;
    const preferredId = presetActiveEnvProfileId || selectedPreset.activeEnvProfileId || selectedPreset.envProfiles[0]?.id;
    return selectedPreset.envProfiles.find((profile) => profile.id === preferredId) || selectedPreset.envProfiles[0] || null;
  }, [presetActiveEnvProfileId, selectedPreset]);

  const effectiveEnvOverrides = useMemo(
    () => (activeEnvProfile?.variables && Object.keys(activeEnvProfile.variables).length > 0 ? activeEnvProfile.variables : undefined),
    [activeEnvProfile]
  );

  const activeHistorySession = useMemo(
    () => historySessions.find((entry) => entry.id === activeHistorySessionId) || null,
    [activeHistorySessionId, historySessions]
  );

  const getDefaultSaveTargetUsageProjectId = useCallback(() => {
    const candidates = [
      selectedBuildProjectId,
      activeHistorySession?.usageProjectId,
      selectedPreset?.usageProjectId,
      usageProjects[0]?.id,
    ];
    return candidates.find((projectId) => (
      Boolean(projectId) && usageProjects.some((project) => project.id === projectId)
    )) || '';
  }, [activeHistorySession?.usageProjectId, selectedBuildProjectId, selectedPreset?.usageProjectId, usageProjects]);

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

  const assignBuildUsageProject = useCallback(async (projectId: string | null) => {
    setSelectedUsageProject('build', projectId);
    if (!activeHistorySessionId) return;
    try {
      await accomplish.updateBuildTaskHistorySession({
        sessionId: activeHistorySessionId,
        usageProjectId: projectId,
      });
      await refreshHistorySessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [accomplish, activeHistorySessionId, refreshHistorySessions, setSelectedUsageProject]);

  const attachBuildUsageProjectSilently = useCallback(async (projectId: string | null) => {
    const normalizedProjectId = projectId || null;
    if ((selectedBuildProjectId ?? null) !== normalizedProjectId) {
      setSelectedUsageProject('build', normalizedProjectId);
    }
    if (!activeHistorySessionId) return;
    if ((activeHistorySession?.usageProjectId ?? null) === normalizedProjectId) return;

    const updated = await accomplish.updateBuildTaskHistorySession({
      sessionId: activeHistorySessionId,
      usageProjectId: normalizedProjectId,
    });
    setHistorySessions((current) => current.map((session) => (
      session.id === activeHistorySessionId
        ? {
          ...session,
          usageProjectId: updated.execution.usageProjectId ?? null,
          updatedAt: updated.updatedAt,
          lastActivityAt: updated.lastActivityAt,
        }
        : session
    )));
  }, [
    accomplish,
    activeHistorySession?.usageProjectId,
    activeHistorySessionId,
    selectedBuildProjectId,
    setSelectedUsageProject,
  ]);

  const handleBuildUsageProjectChange = useCallback((projectId: string | null) => {
    void assignBuildUsageProject(projectId);
  }, [assignBuildUsageProject]);

  const showProjectNoteSavedNotice = useCallback((message: string) => {
    setProjectNoteNotice(message);
    if (projectNoteNoticeTimeoutRef.current !== null) {
      window.clearTimeout(projectNoteNoticeTimeoutRef.current);
    }
    projectNoteNoticeTimeoutRef.current = window.setTimeout(() => {
      setProjectNoteNotice(null);
      projectNoteNoticeTimeoutRef.current = null;
    }, 5000);
  }, []);

  const loadProjectNoteWorkItemsForProject = useCallback(async (projectId: string) => {
    const normalizedProjectId = projectId.trim();
    const requestId = projectNoteWorkItemsRequestRef.current + 1;
    projectNoteWorkItemsRequestRef.current = requestId;
    if (!normalizedProjectId) {
      setProjectNoteWorkItems([]);
      setProjectNoteWorkItemsProjectId('');
      setProjectNoteTargetWorkItemId('');
      setProjectNoteWorkItemsLoading(false);
      return;
    }
    setProjectNoteWorkItems([]);
    setProjectNoteWorkItemsProjectId(normalizedProjectId);
    setProjectNoteTargetWorkItemId('');
    setProjectNoteWorkItemsLoading(true);
    try {
      const items = await accomplish.listUsageProjectWorkItems({
        projectId: normalizedProjectId,
        includeArchived: true,
      });
      if (projectNoteWorkItemsRequestRef.current !== requestId) return;
      const sortedItems = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setProjectNoteWorkItems(sortedItems);
      setProjectNoteTargetWorkItemId((current) => (
        current && sortedItems.some((item) => item.id === current)
          ? current
          : (sortedItems[0]?.id || '__new__')
      ));
    } catch (err) {
      if (projectNoteWorkItemsRequestRef.current !== requestId) return;
      setProjectNoteWorkItems([]);
      setProjectNoteWorkItemsProjectId(normalizedProjectId);
      setProjectNoteTargetWorkItemId('__new__');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (projectNoteWorkItemsRequestRef.current === requestId) {
        setProjectNoteWorkItemsLoading(false);
      }
    }
  }, [accomplish]);

  useEffect(() => {
    if (!projectNoteDialogOpen || projectNoteDialogMode !== 'existing-project' || !projectNoteTargetProjectId) return;
    if (!usageProjects.some((project) => project.id === projectNoteTargetProjectId)) return;
    void loadProjectNoteWorkItemsForProject(projectNoteTargetProjectId);
  }, [loadProjectNoteWorkItemsForProject, projectNoteDialogMode, projectNoteDialogOpen, projectNoteTargetProjectId, usageProjects]);

  useEffect(() => {
    if (!projectNoteDialogOpen || projectNoteDialogMode !== 'existing-project' || usageProjects.length === 0) return;
    const currentProjectIsValid = Boolean(
      projectNoteTargetProjectId && usageProjects.some((project) => project.id === projectNoteTargetProjectId)
    );
    const nextProjectId = currentProjectIsValid ? projectNoteTargetProjectId : getDefaultSaveTargetUsageProjectId();
    if (!nextProjectId) return;
    if (nextProjectId !== projectNoteTargetProjectId) {
      setProjectNoteTargetProjectId(nextProjectId);
      setProjectNoteTargetWorkItemId('');
      return;
    }
    if (projectNoteWorkItemsProjectId !== nextProjectId && !projectNoteWorkItemsLoading) {
      void loadProjectNoteWorkItemsForProject(nextProjectId);
    }
  }, [
    getDefaultSaveTargetUsageProjectId,
    loadProjectNoteWorkItemsForProject,
    projectNoteDialogMode,
    projectNoteDialogOpen,
    projectNoteTargetProjectId,
    projectNoteWorkItemsLoading,
    projectNoteWorkItemsProjectId,
    usageProjects,
  ]);

  const loadRtfWorkItemsForProject = useCallback(async (projectId: string) => {
    const normalizedProjectId = projectId.trim();
    const requestId = rtfWorkItemsRequestRef.current + 1;
    rtfWorkItemsRequestRef.current = requestId;
    if (!normalizedProjectId) {
      setRtfWorkItems([]);
      setRtfWorkItemsProjectId('');
      setRtfTargetWorkItemId('');
      setRtfWorkItemsLoading(false);
      return;
    }
    setRtfWorkItems([]);
    setRtfWorkItemsProjectId(normalizedProjectId);
    setRtfTargetWorkItemId('');
    setRtfWorkItemsLoading(true);
    try {
      const items = await accomplish.listUsageProjectWorkItems({
        projectId: normalizedProjectId,
        includeArchived: true,
      });
      if (rtfWorkItemsRequestRef.current !== requestId) return;
      const sortedItems = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setRtfWorkItems(sortedItems);
      setRtfTargetWorkItemId((current) => (
        current && sortedItems.some((item) => item.id === current)
          ? current
          : (sortedItems[0]?.id || '__new__')
      ));
    } catch (err) {
      if (rtfWorkItemsRequestRef.current !== requestId) return;
      setRtfWorkItems([]);
      setRtfWorkItemsProjectId(normalizedProjectId);
      setRtfTargetWorkItemId('__new__');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (rtfWorkItemsRequestRef.current === requestId) {
        setRtfWorkItemsLoading(false);
      }
    }
  }, [accomplish]);

  useEffect(() => {
    if (!rtfDialogOpen || !rtfAttachToWorkItem || rtfDialogMode !== 'existing-project' || !rtfTargetProjectId) return;
    void loadRtfWorkItemsForProject(rtfTargetProjectId);
  }, [loadRtfWorkItemsForProject, rtfAttachToWorkItem, rtfDialogMode, rtfDialogOpen, rtfTargetProjectId]);

  const loadRuntimeScreenshotDocumentWorkItemsForProject = useCallback(async (projectId: string) => {
    const normalizedProjectId = projectId.trim();
    const requestId = runtimeScreenshotDocumentWorkItemsRequestRef.current + 1;
    runtimeScreenshotDocumentWorkItemsRequestRef.current = requestId;
    if (!normalizedProjectId) {
      setRuntimeScreenshotDocumentWorkItems([]);
      setRuntimeScreenshotDocumentWorkItemsProjectId('');
      setRuntimeScreenshotDocumentTargetWorkItemId('');
      setRuntimeScreenshotDocumentWorkItemsLoading(false);
      return;
    }
    setRuntimeScreenshotDocumentWorkItems([]);
    setRuntimeScreenshotDocumentWorkItemsProjectId(normalizedProjectId);
    setRuntimeScreenshotDocumentTargetWorkItemId('');
    setRuntimeScreenshotDocumentWorkItemsLoading(true);
    try {
      const items = await accomplish.listUsageProjectWorkItems({
        projectId: normalizedProjectId,
        includeArchived: true,
      });
      if (runtimeScreenshotDocumentWorkItemsRequestRef.current !== requestId) return;
      const sortedItems = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setRuntimeScreenshotDocumentWorkItems(sortedItems);
      setRuntimeScreenshotDocumentTargetWorkItemId((current) => (
        current && sortedItems.some((item) => item.id === current)
          ? current
          : (sortedItems[0]?.id || '__new__')
      ));
    } catch (err) {
      if (runtimeScreenshotDocumentWorkItemsRequestRef.current !== requestId) return;
      setRuntimeScreenshotDocumentWorkItems([]);
      setRuntimeScreenshotDocumentWorkItemsProjectId(normalizedProjectId);
      setRuntimeScreenshotDocumentTargetWorkItemId('__new__');
      setRuntimeScreenshotDocumentError(err instanceof Error ? err.message : String(err));
    } finally {
      if (runtimeScreenshotDocumentWorkItemsRequestRef.current === requestId) {
        setRuntimeScreenshotDocumentWorkItemsLoading(false);
      }
    }
  }, [accomplish]);

  useEffect(() => {
    if (
      !runtimeScreenshotDocumentDialogOpen
      || runtimeScreenshotDocumentDialogMode !== 'existing-project'
      || !runtimeScreenshotDocumentTargetProjectId
    ) {
      return;
    }
    void loadRuntimeScreenshotDocumentWorkItemsForProject(runtimeScreenshotDocumentTargetProjectId);
  }, [
    loadRuntimeScreenshotDocumentWorkItemsForProject,
    runtimeScreenshotDocumentDialogMode,
    runtimeScreenshotDocumentDialogOpen,
    runtimeScreenshotDocumentTargetProjectId,
  ]);

  const handleOpenSaveAnswerAsProjectNote = useCallback((
    messageId: string,
    content: string,
    sourceElement?: HTMLElement | null
  ) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const defaultProjectId = getDefaultSaveTargetUsageProjectId();
    const selectedProject = usageProjects.find((project) => project.id === defaultProjectId) || null;
    const fallbackProject = selectedProject || usageProjects[0] || null;
    const activeSessionTitle = historySessions.find((entry) => entry.id === activeHistorySessionId)?.title;
    const defaultWorkItemTitle = (activeSessionTitle || goalPrompt.trim() || 'Build final answer').trim().slice(0, 120);
    setProjectNotePending({
      messageId,
      content: trimmed,
      html: buildWorkItemNoteHtmlFragment(sourceElement || null, trimmed),
    });
    setProjectNoteDialogMode(fallbackProject ? 'existing-project' : 'new-project');
    setProjectNoteTargetProjectId(fallbackProject?.id || '');
    setProjectNoteTargetWorkItemId('');
    setProjectNoteWorkItems([]);
    setProjectNoteWorkItemsProjectId(fallbackProject?.id || '');
    projectNoteTitleRef.current = 'Final answer';
    setProjectNoteTitle('Final answer');
    setProjectNoteNewProjectName(
      selectedPreset?.name
        ? `${selectedPreset.name} budget`
        : activeSessionTitle
          ? `${activeSessionTitle} budget`
          : 'Build budget project'
    );
    setProjectNoteNewWorkItemTitle(defaultWorkItemTitle || 'Build final answer');
    setProjectNoteDialogOpen(true);
    if (fallbackProject?.id) void loadProjectNoteWorkItemsForProject(fallbackProject.id);
  }, [
    activeHistorySessionId,
    getDefaultSaveTargetUsageProjectId,
    goalPrompt,
    historySessions,
    loadProjectNoteWorkItemsForProject,
    selectedPreset?.name,
    usageProjects,
  ]);

  const savePendingAnswerAsProjectWorkItemNote = useCallback(async () => {
    if (!projectNotePending) return;
    setProjectNoteSavingMessageId(projectNotePending.messageId);
    setError(null);
    try {
      let project: UsageProject | null = null;
      if (projectNoteDialogMode === 'new-project') {
        const created = await createUsageProject({
          name: projectNoteNewProjectName.trim() || 'Build budget project',
          color: '#2dd4bf',
          trackingEnabled: true,
        });
        if (!created) throw new Error('Unable to create project.');
        project = created;
        setProjectNoteTargetProjectId(created.id);
      } else {
        project = usageProjects.find((entry) => entry.id === projectNoteTargetProjectId) || null;
      }
      if (!project) throw new Error('Choose a project before saving the note.');

      await attachBuildUsageProjectSilently(project.id);

      const createdAt = new Date().toISOString();
      const note: UsageProjectWorkItemNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: projectNoteTitleRef.current.trim() || undefined,
        text: projectNotePending.content,
        html: projectNotePending.html,
        createdAt,
      };

      let workItem: UsageProjectWorkItem | null = null;
      if (projectNoteTargetWorkItemId && projectNoteTargetWorkItemId !== '__new__') {
        const cachedItems = projectNoteWorkItemsProjectId === project.id ? projectNoteWorkItems : [];
        workItem = cachedItems.find((item) => item.id === projectNoteTargetWorkItemId) || null;
        if (!workItem) {
          const items = await accomplish.listUsageProjectWorkItems({ projectId: project.id, includeArchived: true });
          workItem = items.find((item) => item.id === projectNoteTargetWorkItemId) || null;
        }
      }

      if (!workItem) {
        workItem = await accomplish.createUsageProjectWorkItem({
          usageProjectId: project.id,
          title: projectNoteNewWorkItemTitle.trim() || 'Build final answer',
          sourceType: 'build_session',
          sourceId: activeHistorySessionId || activeHistoryRunTaskId || undefined,
          notes: [note],
        });
      } else {
        workItem = await accomplish.updateUsageProjectWorkItem(workItem.id, {
          notes: [note, ...(workItem.notes || [])],
        });
      }

      setProjectNoteDialogOpen(false);
      setProjectNotePending(null);
      setProjectNoteWorkItems([]);
      setProjectNoteWorkItemsProjectId('');
      setProjectNoteTargetWorkItemId('');
      setProjectNoteTitle('');
      setProjectNoteNewWorkItemTitle('');
      showProjectNoteSavedNotice(`Saved final answer to "${workItem.title}" in "${project.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectNoteSavingMessageId(null);
    }
  }, [
    accomplish,
    activeHistoryRunTaskId,
    activeHistorySessionId,
    attachBuildUsageProjectSilently,
    createUsageProject,
    projectNoteDialogMode,
    projectNoteNewProjectName,
    projectNoteNewWorkItemTitle,
    projectNotePending,
    projectNoteTargetProjectId,
    projectNoteTargetWorkItemId,
    projectNoteWorkItems,
    projectNoteWorkItemsProjectId,
    showProjectNoteSavedNotice,
    usageProjects,
  ]);

  const handleOpenSaveAnswerAsRtf = useCallback(async (
    messageId: string,
    content: string,
    sourceElement?: HTMLElement | null
  ) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const defaultProjectId = getDefaultSaveTargetUsageProjectId();
    const selectedProject = usageProjects.find((project) => project.id === defaultProjectId) || null;
    const fallbackProject = selectedProject || usageProjects[0] || null;
    const activeSessionTitle = historySessions.find((entry) => entry.id === activeHistorySessionId)?.title;
    const defaultTitle = defaultFinalAnswerFileBaseName();
    const rtf = await buildWordFriendlyClipboardRtf(sourceElement || null, trimmed);
    setRtfPending({
      messageId,
      content: trimmed,
      rtf,
    });
    rtfFileTitleRef.current = defaultTitle;
    setRtfFileTitle(defaultTitle);
    setRtfAttachToWorkItem(false);
    setRtfDialogMode(fallbackProject ? 'existing-project' : 'new-project');
    setRtfTargetProjectId(fallbackProject?.id || '');
    setRtfTargetWorkItemId('');
    setRtfWorkItems([]);
    setRtfWorkItemsProjectId(fallbackProject?.id || '');
    setRtfNewProjectName(
      selectedPreset?.name
        ? `${selectedPreset.name} budget`
        : activeSessionTitle
          ? `${activeSessionTitle} budget`
          : 'Build budget project'
    );
    setRtfNewWorkItemTitle(activeSessionTitle || goalPrompt.trim() || 'Build final answer');
    setRtfDialogOpen(true);
  }, [
    activeHistorySessionId,
    getDefaultSaveTargetUsageProjectId,
    goalPrompt,
    historySessions,
    selectedPreset?.name,
    usageProjects,
  ]);

  const savePendingAnswerAsRtf = useCallback(async () => {
    if (!rtfPending) return;
    setRtfSavingMessageId(rtfPending.messageId);
    setError(null);
    try {
      const fileTitle = sanitizeSuggestedFileBaseName(rtfFileTitleRef.current, defaultFinalAnswerFileBaseName());
      const saved = await accomplish.saveTextToFileAs(rtfPending.rtf, {
        baseName: fileTitle,
        extension: 'rtf',
        title: 'Save final answer as Rich Text File',
      });
      if (saved.cancelled || !saved.filePath) {
        showProjectNoteSavedNotice('RTF export cancelled.');
        return;
      }

      if (!rtfAttachToWorkItem) {
        showProjectNoteSavedNotice(`Saved RTF: ${saved.filePath}`);
        setRtfDialogOpen(false);
        setRtfPending(null);
        return;
      }

      let project: UsageProject | null = null;
      if (rtfDialogMode === 'new-project') {
        const created = await createUsageProject({
          name: rtfNewProjectName.trim() || 'Build budget project',
          color: '#2dd4bf',
          trackingEnabled: true,
        });
        if (!created) throw new Error('Unable to create project.');
        project = created;
        setRtfTargetProjectId(created.id);
      } else {
        project = usageProjects.find((entry) => entry.id === rtfTargetProjectId) || null;
      }
      if (!project) throw new Error('Choose a project before attaching the RTF.');

      await attachBuildUsageProjectSilently(project.id);

      const documentLink: UsageProjectWorkItemDocumentLink = {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: fileTitle,
        kind: 'local',
        path: saved.filePath,
        createdAt: new Date().toISOString(),
      };

      let workItem: UsageProjectWorkItem | null = null;
      if (rtfTargetWorkItemId && rtfTargetWorkItemId !== '__new__') {
        const cachedItems = rtfWorkItemsProjectId === project.id ? rtfWorkItems : [];
        workItem = cachedItems.find((item) => item.id === rtfTargetWorkItemId) || null;
        if (!workItem) {
          const items = await accomplish.listUsageProjectWorkItems({ projectId: project.id, includeArchived: true });
          workItem = items.find((item) => item.id === rtfTargetWorkItemId) || null;
        }
      }

      if (!workItem) {
        workItem = await accomplish.createUsageProjectWorkItem({
          usageProjectId: project.id,
          title: rtfNewWorkItemTitle.trim() || 'Build final answer',
          sourceType: 'build_session',
          sourceId: activeHistorySessionId || activeHistoryRunTaskId || undefined,
          documents: [documentLink],
        });
      } else {
        workItem = await accomplish.updateUsageProjectWorkItem(workItem.id, {
          documents: [documentLink, ...(workItem.documents || [])],
        });
      }

      setRtfDialogOpen(false);
      setRtfPending(null);
      setRtfWorkItems([]);
      setRtfWorkItemsProjectId('');
      setRtfTargetWorkItemId('');
      setRtfNewWorkItemTitle('');
      showProjectNoteSavedNotice(`Saved RTF and attached it to "${workItem.title}" in "${project.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRtfSavingMessageId(null);
    }
  }, [
    accomplish,
    activeHistoryRunTaskId,
    activeHistorySessionId,
    attachBuildUsageProjectSilently,
    createUsageProject,
    rtfAttachToWorkItem,
    rtfDialogMode,
    rtfNewProjectName,
    rtfNewWorkItemTitle,
    rtfPending,
    rtfTargetProjectId,
    rtfTargetWorkItemId,
    rtfWorkItems,
    rtfWorkItemsProjectId,
    showProjectNoteSavedNotice,
    usageProjects,
  ]);

  const subagentParentTaskId = aiTaskId || activeHistoryRunTaskId;

  const subagentRefreshParentRef = useRef(subagentParentTaskId);
  subagentRefreshParentRef.current = subagentParentTaskId;
  const subagentRefreshSequence = useRef(0);
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
      const requestedParent = subagentParentTaskId;
      const sequence = ++subagentRefreshSequence.current;
      const result = await accomplish.listSubagents({ parentTaskId: subagentParentTaskId });
      if (subagentRefreshParentRef.current !== requestedParent || sequence !== subagentRefreshSequence.current) return;
      setSubagentRuns((current) => preserveEquivalentSubagentRunReferences(current, result.runs || []));
      setSubagentTree((current) => preserveEquivalentSubagentTreeReferences(current, result.tree || []));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (showLoading) {
        setSubagentRunsLoading(false);
      }
    }
  }, [accomplish, subagentParentTaskId]);

  useSubagentRefresh(refreshSubagentRuns, subagentParentTaskId);

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

  const subagentDetailRequestRef = useRef(0);
  const subagentDetailIdRef = useRef(subagentDetailRun?.runId);
  subagentDetailIdRef.current = subagentDetailRun?.runId;
  const loadSubagentDetail = useCallback(async (run: SubagentRunRecord, options?: { showLoading?: boolean; replaceRun?: boolean }) => {
    if (options?.replaceRun !== false) {
      setSubagentDetailRun(run);
    }
    if (options?.showLoading !== false) {
      setSubagentDetailLoading(true);
    }
    try {
      const requestId = ++subagentDetailRequestRef.current;
      const task = await accomplish.getTask(run.childTaskId, run.childAgentId);
      if (subagentDetailIdRef.current !== run.runId || requestId !== subagentDetailRequestRef.current) return;
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

  }, [loadSubagentDetail, subagentDetailRun?.runId]);
  useSubagentRefresh(async () => { if (subagentDetailRun) await loadSubagentDetail(subagentDetailRun, { showLoading: false, replaceRun: false }); }, subagentDetailRun?.runId);

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

  const sendSubagentControlPrompt = useCallback(async (run: SubagentRunRecord, prompt: string) => {
    if (!run.runId || !prompt.trim()) return;
    try {
      await accomplish.sendSubagent({ runId: run.runId, prompt });
      await refreshSubagentRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, refreshSubagentRuns, subagentDetailRun]);

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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubagentDetailMutating(false);
    }
  }, [accomplish, refreshSubagentRuns, subagentDetailRun?.runId]);

  const inspectSubagentRun = useCallback((run: SubagentRunRecord) => {
    const from = `${location.pathname}${location.search}`;
    navigate(`/subagents?q=${encodeURIComponent(run.childTaskId)}`, { state: { from } });
  }, [location.pathname, location.search, navigate]);

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
      const runs = [...(session.runs || [])].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      const latestRun = runs.find(run => run.id === session.activeRunId) || runs[0];
      let latestRunTask: Task | null = null;
      let restoredMessages = session.messages || [];
      if (latestRun?.taskId) {
        try {
          latestRunTask = await accomplish.getTask(latestRun.taskId, session.agentId || activeAgentId);
        } catch {
          latestRunTask = null;
        }
        const taskMessages = latestRunTask?.messages || [];
        if (taskMessages.length > 0) {
          restoredMessages = mergeIncomingWithLocalBuildGoalMessages(restoredMessages, taskMessages);
          void accomplish.updateBuildTaskHistorySession({
            sessionId: session.id,
            messages: restoredMessages,
          }).catch(() => {
            // Best effort repair for older Build history sessions that missed transcript persistence.
          });
        }
      }
      if (!hasVisibleBuildUserPromptMessage(restoredMessages) && session.execution.goalPrompt) {
        restoredMessages = [{
          id: `local-build-history-goal-${session.id}`,
          type: 'user',
          content: session.execution.goalPrompt,
          timestamp: session.createdAt || new Date().toISOString(),
        }, ...restoredMessages];
        void accomplish.updateBuildTaskHistorySession({
          sessionId: session.id,
          messages: restoredMessages,
        }).catch(() => {
          // Best effort repair so older Build history sessions expose prompt navigation.
        });
      }
      const restoredRuntimeLogs = session.execution.runtimeLogs || [];
      const visibleRestoredLogs = restoredRuntimeLogs.slice(-BUILD_RESTORED_RUNTIME_LOG_LIMIT);
      setActiveHistorySessionId(session.id);
      setGoalPrompt(hasRecordedRuns ? '' : (session.execution.goalPrompt || ''));
      setPromptAttachedFiles([]);
      setSelectedPresetId(session.execution.selectedPresetId || null);
      setSelectedUsageProject('build', session.execution.usageProjectId || null);
      startTransition(() => {
        setAiMessages(restoredMessages);
        setQualityCheckRun(session.execution.latestQualityCheckRun || null);
        setDiff((current) => (
          areBuildWorkspaceDiffsEquivalent(current, session.execution.latestDiff || null)
            ? current
            : (session.execution.latestDiff || null)
        ));
        setWorkspaceFingerprint((current) => (
          areGeneratedBuildObjectsEquivalent(current, session.execution.latestFingerprint || null)
            ? current
            : (session.execution.latestFingerprint || null)
        ));
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
      setActiveHistoryRunTaskId(latestRun?.taskId || null);
      activeRunSummaryIdRef.current = latestRun?.id || null;
      setActiveHistorySessionToken(latestRunTask?.sessionId || latestRun?.sessionId || null);
      setJourneyTask(latestRunTask || (latestRun?.taskId ? {
        id: latestRun.taskId, status: latestRun.status, messages: restoredMessages,
        prompt: session.execution.goalPrompt || '', createdAt: latestRun.startedAt,
      } : null));
      const latestRunStatus = latestRunTask?.status || latestRun?.status;
      if (latestRun?.taskId && latestRunStatus && !TERMINAL_TASK_STATES.has(latestRunStatus)) {
        setAiTaskId(latestRun.taskId);
        lastRunningGitSummaryRefreshAtRef.current = 0;
        runningChangeRefreshInFlightRef.current = false;
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
  }, [accomplish, activeAgentId, attemptWorkspacePathChange, setSelectedUsageProject]);

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
    const requestId = ++workspaceTreeRequestIdRef.current;
    try {
      const tree = await accomplish.getBuildWorkspaceTree({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        depth: 4,
        includeHidden: true,
        maxEntries: 2500,
      });
      if (requestId !== workspaceTreeRequestIdRef.current) return;
      setWorkspaceTree((current) => (areBuildFileTreesEquivalent(current, tree) ? current : tree));
    } catch (err) {
      if (requestId !== workspaceTreeRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const refreshDiff = useCallback(async (options?: { maxChars?: number; includeBaseline?: boolean; baselineId?: string | null; liveTaskId?: string }) => {
    if (!activeAgentId) return;
    try {
      const baselineId = options?.baselineId !== undefined
        ? options.baselineId || undefined
        : (options?.includeBaseline === false ? undefined : pendingDiffBaselineId || undefined);
      const result = await accomplish.getBuildWorkspaceDiff({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        baselineId,
        maxChars: options?.maxChars,
      });
      if (options?.liveTaskId && (!aiBusyRef.current || aiTaskIdRef.current !== options.liveTaskId)) {
        return;
      }
      if (options?.includeBaseline === false && result.available === false && result.mode === 'none') {
        return;
      }
      setDiff((current) => (areBuildWorkspaceDiffsEquivalent(current, result) ? current : result));
      if (Array.isArray(result.files)) {
        const files = result.files;
        if (files.length === 0) {
          setSelectedDiffFilePath(null);
        } else if (!selectedDiffFilePath || !files.some((entry) => entry.relativePath === selectedDiffFilePath)) {
          setSelectedDiffFilePath(files[0].relativePath);
        }
      }

      if (
        options?.includeBaseline !== false
        && buildDiffEnforcementMode === 'approval'
        && pendingDiffBaselineId
        && result.mode === 'synthetic'
        && (result.files || []).length === 0
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
      if (options?.includeBaseline === false) return;
      setDiff((current) => (current === null ? current : null));
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

  const refreshGitSummary = useCallback(async (showBusy = false, options?: { lightweight?: boolean; liveTaskId?: string }) => {
    if (!activeAgentId) return;
    if (showBusy) {
      setGitSummaryBusy(true);
    }
    try {
      const result = await accomplish.getBuildGitSummary({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        lightweight: options?.lightweight,
      });
      if (options?.liveTaskId && (!aiBusyRef.current || aiTaskIdRef.current !== options.liveTaskId)) {
        return;
      }
      setGitSummary((current) => {
        const next = options?.lightweight ? mergeLiveBuildGitSummary(current, result) : result;
        return areGeneratedBuildObjectsEquivalent(current, next) ? current : next;
      });
    } catch (err) {
      if (!options?.lightweight) {
        setGitSummary((current) => (current === null ? current : null));
      }
      if (showBusy) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (showBusy) {
        setGitSummaryBusy(false);
      }
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

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
      setWorkspaceFingerprint((current) => (areGeneratedBuildObjectsEquivalent(current, result) ? current : result));
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

  const workspaceRefreshersRef = useRef({
    refreshSnapshot,
    refreshTree,
    refreshDiff,
    refreshGitSummary,
    refreshFingerprint,
  });

  useEffect(() => {
    workspaceRefreshersRef.current = {
      refreshSnapshot,
      refreshTree,
      refreshDiff,
      refreshGitSummary,
      refreshFingerprint,
    };
  }, [refreshSnapshot, refreshTree, refreshDiff, refreshGitSummary, refreshFingerprint]);

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
    loadPrompts();
  }, [loadPrompts]);

  useEffect(() => {
    if (!activeAgentId) return;
    if (!presetsLoaded || !workspacePathReady || terminalSectionHidden) return;
    let cancelled = false;
    let secondFrame = 0;
    // Let the workspace paint before starting a native shell process.
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void (async () => {
          const next = await refreshTerminalSnapshot();
          if (cancelled) return;
          if (!next || next.sessions.length === 0) {
            await ensureBuildTerminalSession();
          }
        })();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [activeAgentId, ensureBuildTerminalSession, presetsLoaded, refreshTerminalSnapshot, terminalSectionHidden, workspacePathReady, workspaceRelativePath]);

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
    const handleSelectedModelChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setGlobalSelectedModel(normalizeSelectedModel(detail));
    };
    window.addEventListener(SELECTED_MODEL_CHANGED_EVENT, handleSelectedModelChanged);
    return () => {
      window.removeEventListener(SELECTED_MODEL_CHANGED_EVENT, handleSelectedModelChanged);
    };
  }, []);

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
    workspaceTreeRequestIdRef.current += 1;
    setWorkspaceTree(null);
    setSelectedPresetId(null);
    setActiveHistorySessionId(null);
    setActiveHistoryRunTaskId(null);
    activeRunSummaryIdRef.current = null;
    setActiveHistorySessionToken(null);
    setHistoryDropdownOpen(false);
    setHiddenSectionLocks({});
    setLeftPanelCollapsed(false);
    setRuntimePreviewSectionHidden(false);
    const firstVisit = !buildViewStateStorageKey || !window.localStorage.getItem(buildViewStateStorageKey);
    setTerminalSectionHidden(firstVisit);
    setRuntimeLogsSectionHidden(firstVisit);
    setDiffSectionHidden(firstVisit);
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
              workspacePanelWidth: typeof parsed.workspacePanelWidth === 'number'
                ? clampNumber(parsed.workspacePanelWidth, BUILD_WORKSPACE_PANEL_MIN_WIDTH, BUILD_WORKSPACE_PANEL_MAX_WIDTH)
                : BUILD_WORKSPACE_PANEL_DEFAULT_WIDTH,
              operatorPanelWidth: typeof parsed.operatorPanelWidth === 'number'
                ? clampNumber(parsed.operatorPanelWidth, BUILD_OPERATOR_PANEL_MIN_WIDTH, BUILD_OPERATOR_PANEL_MAX_WIDTH)
                : BUILD_OPERATOR_PANEL_DEFAULT_WIDTH,
              terminalPanelWidth: typeof parsed.terminalPanelWidth === 'number'
                ? clampNumber(parsed.terminalPanelWidth, BUILD_TERMINAL_PANEL_MIN_WIDTH, BUILD_TERMINAL_PANEL_DEFAULT_WIDTH * 2)
                : BUILD_TERMINAL_PANEL_DEFAULT_WIDTH,
              runtimeLogsPanelWidth: typeof parsed.runtimeLogsPanelWidth === 'number'
                ? clampNumber(parsed.runtimeLogsPanelWidth, BUILD_RUNTIME_LOGS_PANEL_MIN_WIDTH, BUILD_RUNTIME_LOGS_PANEL_DEFAULT_WIDTH * 2)
                : BUILD_RUNTIME_LOGS_PANEL_DEFAULT_WIDTH,
              hiddenSectionLocks: normalizeBuildHiddenSectionLocks(parsed.hiddenSectionLocks),
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

      if (requestedTaskWindowSessionId) {
        restoredActiveHistorySessionId = requestedTaskWindowSessionId;
        restoredHistoryDropdownOpen = false;
      }

      if (!cancelled && restoredViewState) {
        setWorkspacePanelWidth(restoredViewState.workspacePanelWidth ?? BUILD_WORKSPACE_PANEL_DEFAULT_WIDTH);
        setOperatorPanelWidth(restoredViewState.operatorPanelWidth ?? BUILD_OPERATOR_PANEL_DEFAULT_WIDTH);
        setTerminalPanelWidth(restoredViewState.terminalPanelWidth ?? BUILD_TERMINAL_PANEL_DEFAULT_WIDTH);
        setRuntimeLogsPanelWidth(restoredViewState.runtimeLogsPanelWidth ?? BUILD_RUNTIME_LOGS_PANEL_DEFAULT_WIDTH);
        const restoredLocks = restoredViewState.hiddenSectionLocks ?? {};
        setHiddenSectionLocks(restoredLocks);
        if (restoredLocks.workspace) setLeftPanelCollapsed(true);
        if (restoredLocks.runtimePreview) setRuntimePreviewSectionHidden(true);
        if (restoredLocks.terminal) setTerminalSectionHidden(true);
        if (restoredLocks.runtimeLogs) setRuntimeLogsSectionHidden(true);
        if (restoredLocks.diff) setDiffSectionHidden(true);
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
          const fallbackPreset = fallbackPresetId
            ? (result.presets || []).find((preset) => preset.id === fallbackPresetId) || null
            : null;
          if (!restoredViewState && !restoredActiveHistorySessionId) {
            setWorkspaceRelativePath(canonicalizeWorkspaceRelativePath(fallbackPreset?.workspaceRelativePath));
          }
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
  }, [accomplish, activeAgentId, buildActiveHistorySessionStorageKey, buildViewStateStorageKey, requestedTaskWindowSessionId]);

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
    activeRunDiffBaselineIdRef.current = null;
    setPendingDiffBaselineId(null);
  }, [accomplish, activeAgentId, buildDiffEnforcementMode, pendingDiffBaselineId]);

  useEffect(() => {
    if (!presetsLoaded) return;
    if (!selectedPreset) {
      setPresetNameInput('');
      setPresetStartEntriesInput([]);
      setPresetBuildCommandInput('');
      setPresetRunCommandInput('');
      setPresetTypecheckCommandInput('');
      setPresetLintCommandInput('');
      setPresetTestCommandInput('');
      setPresetUsageProjectIdInput(null);
      setPresetUsageProjectDirty(false);
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
    setPresetTypecheckCommandInput(selectedPreset.commands.typecheckCommand || '');
    setPresetLintCommandInput(selectedPreset.commands.lintCommand || '');
    setPresetTestCommandInput(selectedPreset.commands.testCommand || '');
    setPresetUsageProjectIdInput(selectedPreset.usageProjectId ?? null);
    setPresetUsageProjectDirty(false);
    setSelectedUsageProject('build', selectedPreset.usageProjectId ?? null);

    const profiles = selectedPreset.envProfiles.length > 0 ? selectedPreset.envProfiles : [createDefaultEnvProfile()];
    setPresetEnvProfiles(profiles);
    const profileId = selectedPreset.activeEnvProfileId || profiles[0]?.id;
    setPresetActiveEnvProfileId(profileId);
    const profile = profiles.find((entry) => entry.id === profileId) || profiles[0];
    setPresetEnvEditorText(envVarsToText(profile?.variables || {}));

    setWorkspacePathReady(true);
  }, [presetsLoaded, selectedPreset, setSelectedUsageProject]);

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
    if (!activeAgentId || !workspacePathReady) return;
    setLogs([]);
    setLogCursor(0);
    setWorkspaceTree(null);
    activeRunDiffBaselineIdRef.current = null;
    setPendingDiffBaselineId(null);
    setSelectedDiffFilePath(null);
    setWorkspaceFingerprint(null);
    setGitSummary(null);
    setError(null);

    const {
      refreshSnapshot: loadSnapshot,
      refreshTree: loadTree,
      refreshDiff: loadDiff,
      refreshGitSummary: loadGitSummary,
      refreshFingerprint: loadFingerprint,
    } = workspaceRefreshersRef.current;

    void Promise.all([
      loadSnapshot(),
      loadTree(),
      loadDiff(),
      loadGitSummary(),
      loadFingerprint(),
    ]);
  }, [activeAgentId, workspacePathReady, workspaceRelativePath]);

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
      workspacePanelWidth,
      operatorPanelWidth,
      terminalPanelWidth,
      runtimeLogsPanelWidth,
      hiddenSectionLocks,
    };
    window.localStorage.setItem(buildViewStateStorageKey, JSON.stringify(payload));
  }, [
    activeAgentId,
    buildViewStateStorageKey,
    hiddenSectionLocks,
    operatorPanelWidth,
    runtimeLogsPanelWidth,
    selectedPresetId,
    terminalPanelWidth,
    workspacePanelWidth,
    workspacePathReady,
    workspaceRelativePath,
  ]);

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

  useVisiblePolling(refreshSnapshot, 2000);
  useVisiblePolling(refreshLogs, 1000, !runtimeLogsSectionHidden);
  useVisiblePolling(refreshTerminalSnapshot, 2000, !terminalSectionHidden);

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
    // Wait for the restored list to commit before asking Virtuoso to measure and
    // scroll. Synchronous scroll updates can repeatedly interrupt its restoration.
    const frame = requestAnimationFrame(() => scrollAssistantMessagesToBottom('auto'));
    return () => cancelAnimationFrame(frame);
  }, [assistantMessages, aiBusy, assistantNearBottom, scrollAssistantMessagesToBottom]);

  useEffect(() => {
    if (!pendingHistoryRestoreScrollRef.current || assistantMessages.length === 0) return;
    const frame = requestAnimationFrame(() => {
      scrollAssistantMessagesToBottom('auto');
      pendingHistoryRestoreScrollRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [assistantMessages, scrollAssistantMessagesToBottom]);

  useBuildTaskActivity(aiTaskId || activeHistoryRunTaskId, activeAgentId, (task) => {
    const taskId = task?.id || aiTaskId || activeHistoryRunTaskId;
    if (!taskId) return;
    if (task) setJourneyTask(task);
    buildActivityVersionRef.current += 1;
    aiBusyRef.current = true;
    aiTaskIdRef.current = taskId;
    setAiTaskId(taskId);
    setAiBusy(true);
    if (task?.sessionId) setActiveHistorySessionToken(task.sessionId);
  });

  useEffect(() => {
    if (!aiTaskId || !aiBusy) return;
    let cancelled = false;
    let pollInFlight = false;
    const pollActiveTask = () => {
      if (pollInFlight || cancelled) return;
      pollInFlight = true;
      void (async () => {
        try {
          const activityVersion = buildActivityVersionRef.current;
          const task = await accomplish.getTask(aiTaskId, activeAgentId);
          if (!task || cancelled) return;
          setJourneyTask(task);
          let mergedMessages: TaskMessage[] = [];
          setAiMessages((current) => {
            mergedMessages = mergeIncomingWithLocalBuildGoalMessages(current, task.messages || []);
            return mergedMessages;
          });
          if (task.sessionId) {
            setActiveHistorySessionToken(task.sessionId);
          }
          if (!TERMINAL_TASK_STATES.has(task.status)) {
            const now = Date.now();
            if (
              now - lastRunningGitSummaryRefreshAtRef.current > BUILD_RUNNING_GIT_SUMMARY_REFRESH_INTERVAL_MS
              && !runningChangeRefreshInFlightRef.current
            ) {
              const activeRunBaselineId = activeRunDiffBaselineIdRef.current || pendingDiffBaselineId;
              lastRunningGitSummaryRefreshAtRef.current = now;
              runningChangeRefreshInFlightRef.current = true;
              void Promise.allSettled([
                refreshGitSummary(false, { lightweight: true, liveTaskId: aiTaskId }),
                refreshDiff({
                  maxChars: BUILD_RUNNING_GIT_DIFF_MAX_CHARS,
                  includeBaseline: activeRunBaselineId ? true : false,
                  baselineId: activeRunBaselineId || undefined,
                  liveTaskId: aiTaskId,
                }),
              ]).finally(() => {
                runningChangeRefreshInFlightRef.current = false;
              });
            }
          }
          if (TERMINAL_TASK_STATES.has(task.status)) {
            runningChangeRefreshInFlightRef.current = false;
            let completedMessages = mergedMessages;
            let completedDiff = diff;
            const activeRunBaselineId = activeRunDiffBaselineIdRef.current || pendingDiffBaselineId;
            const [finalDiffResult, finalGitSummaryResult] = await Promise.allSettled([
              accomplish.getBuildWorkspaceDiff({
                agentId: activeAgentId,
                relativePath: workspaceRelativePath,
                baselineId: activeRunBaselineId || undefined,
              }),
              accomplish.getBuildGitSummary({
                agentId: activeAgentId,
                relativePath: workspaceRelativePath,
              }),
            ]);
            if (cancelled) return;
            // A child completion can wake the parent while final diff reads run.
            // Do not let the previous turn's completion hide that new activity.
            const currentTask = await accomplish.getTask(aiTaskId, activeAgentId);
            if (cancelled || activityVersion !== buildActivityVersionRef.current || (currentTask && isBuildTaskActive(currentTask))) return;
            const finalDiff = finalDiffResult.status === 'fulfilled' ? finalDiffResult.value : null;
            const finalGitSummary = finalGitSummaryResult.status === 'fulfilled' ? finalGitSummaryResult.value : null;
            if (finalDiff) {
              completedDiff = finalDiff;
              setDiff(finalDiff);
            }
            if (finalGitSummary) {
              setGitSummary((current) => (
                areGeneratedBuildObjectsEquivalent(current, finalGitSummary) ? current : finalGitSummary
              ));
            }
            const runScopedDiff = activeRunBaselineId
              && finalDiff?.mode === 'synthetic'
              && finalDiff.baselineId === activeRunBaselineId
              ? finalDiff
              : activeRunBaselineId
                && completedDiff?.mode === 'synthetic'
                && completedDiff.baselineId === activeRunBaselineId
                  ? completedDiff
                  : null;
            const completedRunId = activeRunSummaryIdRef.current || task.id;
            completedMessages = appendBuildChangedFilesSummaryMessage(mergedMessages, {
              runId: completedRunId,
              diff: runScopedDiff,
            });
            if (completedMessages !== mergedMessages) {
              setAiMessages(completedMessages);
            }
            activeRunDiffBaselineIdRef.current = null;
            setAiBusy(false);
            setAiTaskId(null);
            if (activeHistorySessionId) {
              await accomplish.updateBuildTaskHistorySession({
                sessionId: activeHistorySessionId,
                messages: completedMessages,
                lifecycleStatus: mapTaskStatusToLifecycle(task.status),
                activeRun: {
                  id: completedRunId,
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
                latestDiff: completedDiff,
                latestQualityCheckRun: qualityCheckRun,
              });
            }
            await Promise.all([refreshTree(), refreshDiff(), refreshGitSummary(), refreshSnapshot(), refreshFingerprint(), refreshHistorySessions()]);
          }
        } catch {
          // Ignore polling failures.
        } finally {
          pollInFlight = false;
        }
      })();
    };
    const interval = setInterval(pollActiveTask, 1200);
    pollActiveTask();

    return () => {
      cancelled = true;
      pollInFlight = false;
      clearInterval(interval);
    };
  }, [
    accomplish,
    activeAgentId,
    activeHistorySessionId,
    aiBusy,
    aiTaskId,
    contextStats,
    diff,
    pendingDiffBaselineId,
    qualityCheckRun,
    refreshDiff,
    refreshFingerprint,
    refreshGitSummary,
    refreshHistorySessions,
    refreshSnapshot,
    refreshTree,
    workspaceRelativePath,
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
        latestQualityCheckRun: qualityCheckRun,
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
    qualityCheckRun,
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
    if (!autoRepairEnabled || autoRepairBusy || aiBusy || !snapshot || !activeAgentId) return;
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
          activeRunDiffBaselineIdRef.current = baseline.baselineId;
          setPendingDiffBaselineId(baseline.baselineId);
          setSelectedDiffFilePath(null);
        }
        const task = await accomplish.startTask({
          prompt: snapshot.runtime.suggestedRepairPrompt || 'Diagnose and fix runtime failure in this workspace.',
          agentId: activeAgentId,
          workingDirectory: snapshot.workspaceRoot,
          usageProjectId: selectedBuildProjectId ?? null,
          requiresBrowser: true,
          buildMode: true,
          buildWorkspaceRelativePath: workspaceRelativePath || '.',
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
    aiBusy,
    autoRepairBusy,
    autoRepairEnabled,
    buildDiffEnforcementMode,
    diff?.files,
    lastRepairFingerprint,
    pendingDiffBaselineId,
    selectedBuildProjectId,
    snapshot,
    workspaceRelativePath,
  ]);

  const handleSelectPreset = useCallback(async (presetId: string | null) => {
    if (!activeAgentId) return;
    const targetPreset = presetId ? presets.find((preset) => preset.id === presetId) || null : null;
    setSelectedPresetId(presetId);
    setPresetUsageProjectIdInput(targetPreset?.usageProjectId ?? null);
    setPresetUsageProjectDirty(false);
    setSelectedUsageProject('build', targetPreset?.usageProjectId ?? null);
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
  }, [accomplish, activeAgentId, presets, setSelectedUsageProject, workspaceRelativePath]);

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
      ...(selectedPresetId && !presetUsageProjectDirty ? {} : { usageProjectId: presetUsageProjectIdInput || null }),
      commands: {
        startCommand: startEntries[0]?.command || undefined,
        startEntries: startEntries.length > 0 ? startEntries : undefined,
        buildCommand: presetBuildCommandInput || undefined,
        runCommand: presetRunCommandInput || undefined,
        typecheckCommand: presetTypecheckCommandInput || undefined,
        lintCommand: presetLintCommandInput || undefined,
        testCommand: presetTestCommandInput || undefined,
      },
      envProfiles,
      activeEnvProfileId: profileId,
    });

    setPresetUsageProjectIdInput(saved.usageProjectId ?? null);
    setPresetUsageProjectDirty(false);
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
    presetUsageProjectDirty,
    presetUsageProjectIdInput,
    parsedPresetStartEntries.entries,
    parsedPresetStartEntries.issues,
    presetLintCommandInput,
    presetRunCommandInput,
    presetTestCommandInput,
    presetTypecheckCommandInput,
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
      usageProjectId: presetUsageProjectIdInput || null,
      commands: {
        startCommand: startEntries[0]?.command || undefined,
        startEntries: startEntries.length > 0 ? startEntries : undefined,
        buildCommand: presetBuildCommandInput || undefined,
        runCommand: presetRunCommandInput || undefined,
        typecheckCommand: presetTypecheckCommandInput || undefined,
        lintCommand: presetLintCommandInput || undefined,
        testCommand: presetTestCommandInput || undefined,
      },
      envProfiles,
      activeEnvProfileId: activeProfileId || envProfiles[0]?.id,
    });
    setPresetUsageProjectIdInput(created.usageProjectId ?? null);
    setPresetUsageProjectDirty(false);
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
    presetUsageProjectIdInput,
    parsedPresetStartEntries.entries,
    parsedPresetStartEntries.issues,
    presetLintCommandInput,
    presetRunCommandInput,
    presetTestCommandInput,
    presetTypecheckCommandInput,
    presets.length,
    refreshPresets,
    workspaceRelativePath,
  ]);

  const syncGoalPromptState = useCallback((value: string, options?: { immediate?: boolean }) => {
    goalPromptDraftRef.current = value;
    const nextValue = options?.immediate ? value : goalPromptDraftRef.current;
    startTransition(() => {
      setGoalPrompt(nextValue);
    });
  }, []);

  const syncGoalPromptDraftRef = useCallback((value: string) => {
    goalPromptDraftRef.current = value;
  }, []);

  const replacePromptComposerValue = useCallback((value: string) => {
    goalPromptDraftRef.current = value;
    setGoalPrompt(value);
    setPromptComposerResetKey((current) => current + 1);
  }, []);

  const insertTextIntoBuildPrompt = useCallback((text: string) => {
    const insertion = text.trim();
    if (!insertion) return;
    const current = (goalPromptDraftRef.current || goalPrompt || '').trim();
    replacePromptComposerValue(current ? `${current}\n\n${insertion}` : insertion);
  }, [goalPrompt, replacePromptComposerValue]);

  const guidance = useMemo(() => ({
    messageId: [...aiMessages].reverse().find(message => message.type === 'assistant')?.id,
    disabled: aiBusy || autoRepairBusy || journeyTask?.status !== 'completed',
    onChoose: insertTextIntoBuildPrompt,
  }), [aiMessages, aiBusy, autoRepairBusy, journeyTask?.status, insertTextIntoBuildPrompt]);

  const scanWorkspaceSetup = useCallback(async () => {
    if (!activeAgentId) return;
    setWorkspaceSetupOpen(true);
    setWorkspaceSetupScanning(true);
    setError(null);
    try {
      await Promise.all([
        refreshSnapshot(),
        refreshTree(),
        refreshFingerprint(),
      ]);
      setWorkspaceSetupLastScanAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceSetupScanning(false);
    }
  }, [activeAgentId, refreshFingerprint, refreshSnapshot, refreshTree]);

  const applyWorkspaceSetupPreset = useCallback(async () => {
    if (!activeAgentId || !workspaceSetupSuggestions) return;
    setError(null);
    try {
      const activeProfileId = presetActiveEnvProfileId || presetEnvProfiles[0]?.id;
      const envProfiles = presetEnvProfiles.map((profile, index) => ({
        ...profile,
        variables: (profile.id === activeProfileId || (!activeProfileId && index === 0))
          ? parseEnvVarsText(presetEnvEditorText)
          : profile.variables,
      }));
      const saved = await accomplish.upsertBuildPreset({
        id: selectedPresetId || undefined,
        agentId: activeAgentId,
        name: workspaceSetupSuggestions.presetName,
        workspaceRelativePath: workspaceRelativePath || '.',
        ...(selectedPresetId && !presetUsageProjectDirty ? {} : { usageProjectId: presetUsageProjectIdInput || null }),
        commands: {
          startCommand: workspaceSetupSuggestions.startEntries[0]?.command || undefined,
          startEntries: workspaceSetupSuggestions.startEntries.length > 0
            ? workspaceSetupSuggestions.startEntries
            : undefined,
          buildCommand: workspaceSetupSuggestions.buildCommand || undefined,
          runCommand: workspaceSetupSuggestions.runCommand || undefined,
          typecheckCommand: workspaceSetupSuggestions.typecheckCommand || undefined,
          lintCommand: workspaceSetupSuggestions.lintCommand || undefined,
          testCommand: workspaceSetupSuggestions.testCommand || undefined,
        },
        envProfiles,
        activeEnvProfileId: activeProfileId || envProfiles[0]?.id,
      });

      setPresetNameInput(saved.name);
      setPresetStartEntriesInput(buildStartEntriesToEditable(saved.commands.startEntries));
      setPresetBuildCommandInput(saved.commands.buildCommand || '');
      setPresetRunCommandInput(saved.commands.runCommand || '');
      setPresetTypecheckCommandInput(saved.commands.typecheckCommand || '');
      setPresetLintCommandInput(saved.commands.lintCommand || '');
      setPresetTestCommandInput(saved.commands.testCommand || '');
      setPresetUsageProjectIdInput(saved.usageProjectId ?? null);
      setPresetUsageProjectDirty(false);
      await handleSelectPreset(saved.id);
      await refreshPresets(saved.id);
      setWorkspaceSetupOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [
    accomplish,
    activeAgentId,
    handleSelectPreset,
    presetActiveEnvProfileId,
    presetEnvEditorText,
    presetEnvProfiles,
    presetUsageProjectDirty,
    presetUsageProjectIdInput,
    refreshPresets,
    selectedPresetId,
    workspaceRelativePath,
    workspaceSetupSuggestions,
  ]);

  const insertWorkspaceSetupNotes = useCallback(() => {
    if (!workspaceSetupSuggestions) return;
    const lines = [
      'Use this workspace setup while working:',
      '',
      `Agent role: ${workspaceSetupSuggestions.agentRole}`,
      '',
      'Commands:',
      `- Start: ${workspaceSetupSuggestions.startEntries.map((entry) => entry.command).join(' && ') || 'not detected'}`,
      `- Typecheck: ${workspaceSetupSuggestions.typecheckCommand || 'not detected'}`,
      `- Lint: ${workspaceSetupSuggestions.lintCommand || 'not detected'}`,
      `- Test: ${workspaceSetupSuggestions.testCommand || 'not detected'}`,
      `- Build: ${workspaceSetupSuggestions.buildCommand || 'not detected'}`,
      '',
      'Protected files to treat carefully:',
      ...(workspaceSetupSuggestions.protectedFiles.length > 0
        ? workspaceSetupSuggestions.protectedFiles.map((filePath) => `- ${filePath}`)
        : ['- No protected files detected in the current tree scan.']),
    ];
    insertTextIntoBuildPrompt(lines.join('\n'));
    setWorkspaceSetupOpen(false);
  }, [insertTextIntoBuildPrompt, workspaceSetupSuggestions]);

  const insertPromptLibraryItem = useCallback((item: BuildPromptLibraryItem) => {
    insertTextIntoBuildPrompt(item.prompt);
    setRecipeNotice(`Inserted "${item.title}"`);
    setRecipeCatalogOpen(false);
  }, [insertTextIntoBuildPrompt]);

  const saveRecipeAsPrompt = useCallback((item: BuildPromptLibraryItem) => {
    if (item.source !== 'recipe') return;
    savePrompt(`Recipe: ${item.title}`, item.prompt, item.category);
    setRecipeNotice(`Saved "${item.title}"`);
  }, [savePrompt]);

  const openSavedPrompts = useCallback((mode: 'select' | 'manage') => {
    setSavedPromptsMode(mode);
    setSavedPromptsOpen(true);
  }, []);

  const selectSavedPrompt = useCallback((content: string) => {
    replacePromptComposerValue(content);
  }, [replacePromptComposerValue]);

  const saveCurrentBuildPrompt = useCallback((value: string) => {
    const content = value.trim();
    if (!content) return;
    const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Build prompt';
    const title = firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
    savePrompt(title, content, 'Build');
    setRecipeNotice(`Saved "${title}"`);
  }, [savePrompt]);

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
      const executionProfileId = selectedPreset?.executionProfileId || null;

      if (action === 'start') {
        const next = await accomplish.startBuildRuntime({
          agentId: activeAgentId,
          workspaceRelativePath,
          executionProfileId,
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
          executionProfileId,
          commandOverride: buildCommandOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot((current) => (areBuildSnapshotsEquivalent(current, result.snapshot) ? current : result.snapshot));
      } else if (action === 'run-once') {
        const result = await accomplish.runStartCommandOnce({
          agentId: activeAgentId,
          workspaceRelativePath,
          executionProfileId,
          commandOverride: runCommandOverride,
          envOverrides: effectiveEnvOverrides,
        });
        setSnapshot((current) => (areBuildSnapshotsEquivalent(current, result.snapshot) ? current : result.snapshot));
      }
      await Promise.all([refreshSnapshot(), refreshDiff(), refreshGitSummary(), refreshFingerprint()]);
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
      await Promise.all([refreshTree(), refreshDiff(), refreshGitSummary(), refreshFingerprint()]);
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
      await Promise.all([refreshTree(), refreshDiff(), refreshGitSummary(), refreshFingerprint()]);
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
      await Promise.all([refreshTree(), refreshDiff(), refreshGitSummary(), refreshFingerprint()]);
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
      await Promise.all([refreshDiff(), refreshGitSummary(), refreshFingerprint()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, activeEditorTab, activeEditorTabIsFromCurrentWorkspace, refreshDiff, refreshGitSummary, refreshFingerprint]);

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
      activeRunDiffBaselineIdRef.current = null;
      setPendingDiffBaselineId(null);
      setSelectedDiffFilePath(null);
      await Promise.all([refreshTree(), refreshDiff(), refreshGitSummary(), refreshSnapshot(), refreshFingerprint()]);
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

  const handleOpenChangedFilesReview = useCallback((relativePath?: string) => {
    if (relativePath && reviewFilesForGitPanel.some((file) => file.relativePath === relativePath)) {
      setSelectedDiffFilePath(relativePath);
    } else if (!selectedDiffFilePath && reviewFilesForGitPanel[0]) {
      setSelectedDiffFilePath(reviewFilesForGitPanel[0].relativePath);
    }
    setGitReviewTab(relativePath || reviewFilesForGitPanel.length > 0 ? 'files' : 'overview');
    setGitReviewDialogOpen(true);
    window.requestAnimationFrame(() => {
      diffPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [reviewFilesForGitPanel, selectedDiffFilePath]);

  const openGitPrimaryActionDialog = useCallback(() => {
    if (!gitSummary) return;
    const cta = getBuildGitPrimaryCta(gitSummary);
    setGitActionNotice(null);
    setGitActionHints([]);
    if (cta.label === 'Resolve mismatch' || cta.label === 'Resolve conflicts') {
      setGitMismatchView('resolve');
      setGitMismatchDialogOpen(true);
      return;
    }
    if (gitSummary.nextAction.kind === 'init') {
      setGitInitDialogOpen(true);
      return;
    }
    if (gitSummary.nextAction.kind === 'commit') {
      setGitCommitMessage((current) => current.trim() || defaultCommitMessage);
      setGitCommitPushAfter(cta.label === 'Commit & push updates');
      setGitCommitDialogOpen(true);
      return;
    }
    if (gitSummary.nextAction.kind === 'add-remote') {
      setGitRemoteName((current) => current.trim() || 'origin');
      setGitRemoteDialogOpen(true);
      return;
    }
    if (gitSummary.nextAction.kind === 'push') {
      setGitPushBranchName((current) => current.trim() || gitSummary.branch || 'main');
      setGitPushDialogOpen(true);
      return;
    }
    if (gitSummary.nextAction.kind === 'pull') {
      setGitPullDialogOpen(true);
      return;
    }
    if (gitSummary.nextAction.kind === 'fetch' && activeAgentId) {
      setGitActionBusy('fetch');
      void (async () => {
        try {
          const result = await accomplish.fetchBuildGitRemote({
            agentId: activeAgentId,
            relativePath: workspaceRelativePath,
          });
          if (result.summary) setGitSummary(result.summary);
          setGitActionNotice(result.message);
          setGitActionHints(result.hints || []);
          await refreshGitSummary();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setGitActionBusy(null);
        }
      })();
    }
  }, [accomplish, activeAgentId, defaultCommitMessage, gitSummary, refreshGitSummary, workspaceRelativePath]);

  const handleRunBuildGitInit = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('init');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.initBuildGitRepository({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) {
        setGitInitDialogOpen(false);
      }
      await Promise.all([refreshDiff(), refreshGitSummary(), refreshFingerprint()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, refreshDiff, refreshFingerprint, refreshGitSummary, workspaceRelativePath]);

  const handleRunBuildGitCommit = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('commit');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.commitBuildGitChanges({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        message: gitCommitMessage,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) {
        setGitCommitDialogOpen(false);
        setGitCommitMessage('');
        if (gitCommitPushAfter && result.summary?.remoteName) {
          setGitActionBusy('push');
          const pushResult = await accomplish.pushBuildGitBranch({
            agentId: activeAgentId,
            relativePath: workspaceRelativePath,
            branchName: result.summary.branch || gitPushBranchName,
          });
          if (pushResult.summary) setGitSummary(pushResult.summary);
          setGitActionNotice(pushResult.message);
          setGitActionHints(pushResult.hints || []);
        }
        setGitCommitPushAfter(false);
      }
      await Promise.all([refreshDiff(), refreshGitSummary(), refreshFingerprint(), refreshHistorySessions()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    accomplish,
    activeAgentId,
    gitCommitPushAfter,
    gitCommitMessage,
    gitPushBranchName,
    refreshDiff,
    refreshFingerprint,
    refreshGitSummary,
    refreshHistorySessions,
    workspaceRelativePath,
  ]);

  const handleRunBuildGitAddRemote = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('add-remote');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.addBuildGitRemote({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        provider: gitRemoteProvider,
        remoteName: gitRemoteName,
        remoteUrl: gitRemoteUrl,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) {
        setGitRemoteDialogOpen(false);
        setGitPushBranchName(result.summary?.branch || gitPushBranchName || 'main');
      }
      await refreshGitSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    accomplish,
    activeAgentId,
    gitPushBranchName,
    gitRemoteName,
    gitRemoteProvider,
    gitRemoteUrl,
    refreshGitSummary,
    workspaceRelativePath,
  ]);

  const handleRunBuildGitPush = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('push');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.pushBuildGitBranch({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        branchName: gitPushBranchName,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) {
        setGitPushDialogOpen(false);
      }
      await refreshGitSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, gitPushBranchName, refreshGitSummary, workspaceRelativePath]);

  const handleRunBuildGitFetch = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('fetch');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.fetchBuildGitRemote({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      await refreshGitSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, refreshGitSummary, workspaceRelativePath]);

  const handleRunBuildGitPull = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('pull');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.pullBuildGitBranch({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) setGitPullDialogOpen(false);
      await Promise.all([refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, refreshDiff, refreshFingerprint, refreshGitSummary, refreshTree, workspaceRelativePath]);

  const handleRunBuildGitUpdateRemote = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('update-remote');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.updateBuildGitRemote({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        provider: gitSummary?.remoteProvider || 'custom',
        remoteName: gitRemoteEditName,
        remoteUrl: gitRemoteEditUrl,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) setGitRemoteEditDialogOpen(false);
      await refreshGitSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, gitRemoteEditName, gitRemoteEditUrl, gitSummary?.remoteProvider, refreshGitSummary, workspaceRelativePath]);

  const handleRunBuildGitBranchAction = useCallback(async () => {
    if (!activeAgentId) return;
    const action = gitBranchMode === 'create' ? 'create-branch' : 'switch-branch';
    setGitActionBusy(action);
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const payload = {
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        branchName: gitBranchName,
      };
      const result = gitBranchMode === 'create'
        ? await accomplish.createBuildGitBranch(payload)
        : await accomplish.switchBuildGitBranch(payload);
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) setGitBranchDialogOpen(false);
      await Promise.all([refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, gitBranchMode, gitBranchName, refreshDiff, refreshFingerprint, refreshGitSummary, refreshTree, workspaceRelativePath]);

  const handleRunBuildGitDiscard = useCallback(async () => {
    if (!activeAgentId || !gitDiscardPath) return;
    setGitActionBusy('discard');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.discardBuildGitChanges({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        paths: [gitDiscardPath],
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) {
        setGitDiscardDialogOpen(false);
        setGitDiscardPath('');
      }
      await Promise.all([refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, gitDiscardPath, refreshDiff, refreshFingerprint, refreshGitSummary, refreshTree, workspaceRelativePath]);

  const refreshBuildGitStashes = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const result = await accomplish.listBuildGitStashes({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
      });
      setGitStashes(result.stashes);
      if (result.summary) setGitSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const handleRunBuildGitSaveAside = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('stash-create');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.createBuildGitStash({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      await Promise.all([refreshBuildGitStashes(), refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, refreshBuildGitStashes, refreshDiff, refreshFingerprint, refreshGitSummary, refreshTree, workspaceRelativePath]);

  const handleRunBuildGitApplyStash = useCallback(async (stashRef: string) => {
    if (!activeAgentId) return;
    setGitActionBusy('stash-apply');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.applyBuildGitStash({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        stashRef,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      await Promise.all([refreshBuildGitStashes(), refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, refreshBuildGitStashes, refreshDiff, refreshFingerprint, refreshGitSummary, refreshTree, workspaceRelativePath]);

  const handleRunBuildGitDropStash = useCallback(async (stashRef: string) => {
    if (!activeAgentId) return;
    setGitActionBusy('stash-drop');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.dropBuildGitStash({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        stashRef,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      await refreshBuildGitStashes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, refreshBuildGitStashes, workspaceRelativePath]);

  const toggleGitConflictPath = useCallback((filePath: string) => {
    setGitSelectedConflictPaths((current) => (
      current.includes(filePath)
        ? current.filter((entry) => entry !== filePath)
        : [...current, filePath]
    ));
  }, []);

  const handleRunBuildGitStageResolved = useCallback(async (paths?: string[]) => {
    if (!activeAgentId) return;
    const selectedPaths = paths?.length ? paths : gitSelectedConflictPaths;
    setGitActionBusy('stage-files');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.stageBuildGitFiles({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        paths: selectedPaths,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) setGitSelectedConflictPaths([]);
      setGitMismatchSummary(null);
      await Promise.all([refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    accomplish,
    activeAgentId,
    gitSelectedConflictPaths,
    refreshDiff,
    refreshFingerprint,
    refreshGitSummary,
    refreshTree,
    workspaceRelativePath,
  ]);

  const handleApplyGitConflictHunkChoice = useCallback(async (
    file: BuildGitConflictFile,
    hunk: BuildGitConflictFile['hunks'][number],
    side: 'local' | 'remote'
  ) => {
    if (!activeAgentId || !file.contentPreview) return;
    setError(null);
    try {
      const lines = file.contentPreview.replace(/\r\n/g, '\n').split('\n');
      const replacement = (side === 'local' ? hunk.localContent : hunk.remoteContent).split('\n');
      const nextLines = [
        ...lines.slice(0, Math.max(0, hunk.startLine - 1)),
        ...replacement,
        ...lines.slice(hunk.endLine),
      ];
      await accomplish.writeBuildWorkspaceFile({
        agentId: activeAgentId,
        relativePath: file.relativePath,
        workspaceRelativePath: workspaceRelativePath || '.',
        content: nextLines.join('\n'),
      });
      setGitActionNotice(`Applied ${side === 'local' ? 'local' : 'remote'} version in ${file.relativePath}. Mark the file resolved when all conflict markers are gone.`);
      setGitMismatchSummary(null);
      await Promise.all([refreshDiff(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, activeAgentId, refreshDiff, refreshGitSummary, refreshTree, workspaceRelativePath]);

  const handleOpenGitConflictFile = useCallback((file: BuildGitConflictFile) => {
    void handleSelectFile({
      name: pathLeaf(file.relativePath),
      relativePath: file.relativePath,
      type: 'file',
    });
  }, [handleSelectFile]);

  const handleRunBuildGitFinishMerge = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('finish-merge');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.finishBuildGitMerge({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        message: gitMergeCommitMessage,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      setGitMismatchSummary(null);
      await Promise.all([refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
      if (result.ok) setGitMismatchDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    accomplish,
    activeAgentId,
    gitMergeCommitMessage,
    refreshDiff,
    refreshFingerprint,
    refreshGitSummary,
    refreshTree,
    workspaceRelativePath,
  ]);

  const handleRunBuildGitCheckoutRemoteBranch = useCallback(async (remoteBranchName: string) => {
    if (!activeAgentId) return;
    setGitActionBusy('checkout-remote');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.checkoutBuildGitRemoteBranch({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        remoteBranchName,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      if (result.ok) setGitBranchDialogOpen(false);
      await Promise.all([refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, refreshDiff, refreshFingerprint, refreshGitSummary, refreshTree, workspaceRelativePath]);

  const handleRunBuildGitCreateRemoteRepository = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('add-remote');
    setGitActionNotice(null);
    setGitActionHints([]);
    setGitRemoteCreateSteps([]);
    setError(null);
    try {
      const result = await accomplish.createBuildGitRemoteRepository({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        provider: gitRemoteCreateProvider,
        remoteName: 'origin',
        repositoryName: gitRemoteCreateName,
        visibility: gitRemoteCreateVisibility,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitRemoteCreateSteps(result.manualSteps || []);
      if (result.ok) setGitRemoteCreateDialogOpen(false);
      await refreshGitSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    accomplish,
    activeAgentId,
    gitRemoteCreateName,
    gitRemoteCreateProvider,
    gitRemoteCreateVisibility,
    refreshGitSummary,
    workspaceRelativePath,
  ]);

  const handleRunBuildGitCreatePr = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('push');
    setGitActionNotice(null);
    setGitActionHints([]);
    setGitPrSteps([]);
    setError(null);
    try {
      const result = await accomplish.createBuildGitPullRequest({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        provider: gitSummary?.remoteProvider,
        title: gitPrTitle,
        body: gitPrBody,
        draft: true,
      });
      setGitActionNotice(result.url ? `${result.message} ${result.url}` : result.message);
      setGitPrSteps(result.manualSteps || []);
      if (result.ok) setGitPrDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [accomplish, activeAgentId, gitPrBody, gitPrTitle, gitSummary?.remoteProvider, workspaceRelativePath]);

  const handleRunBuildGitRestoreBackup = useCallback(async (branchName: string) => {
    if (!activeAgentId) return;
    setGitActionBusy('restore-backup');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.restoreBuildGitBackupBranch({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        branchName,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      setGitMismatchSummary(null);
      await Promise.all([refreshDiff(), refreshFingerprint(), refreshGitSummary(), refreshTree()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    accomplish,
    activeAgentId,
    refreshDiff,
    refreshFingerprint,
    refreshGitSummary,
    refreshTree,
    workspaceRelativePath,
  ]);

  const refreshGitMismatchSummary = useCallback(async (options?: { fetchFirst?: boolean }) => {
    if (!activeAgentId) return null;
    setGitMismatchBusy(true);
    setError(null);
    try {
      if (options?.fetchFirst && gitSummary?.remoteName) {
        const fetchResult = await accomplish.fetchBuildGitRemote({
          agentId: activeAgentId,
          relativePath: workspaceRelativePath,
        });
        if (fetchResult.summary) setGitSummary(fetchResult.summary);
        setGitActionNotice(fetchResult.message);
        setGitActionHints(fetchResult.hints || []);
      }
      const mismatch = await accomplish.getBuildGitMismatchSummary({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
      });
      setGitMismatchSummary(mismatch);
      setGitMismatchBackupBranchName(mismatch.backupBranchName || '');
      if (mismatch.inProgressOperation === 'rebase') {
        setGitMismatchAction('continue-rebase');
      } else if (mismatch.inProgressOperation === 'merge') {
        setGitMismatchAction('abort-merge');
      } else if (mismatch.ahead > 0 && mismatch.behind > 0) {
        setGitMismatchAction('merge');
      } else if (mismatch.behind > 0) {
        setGitMismatchAction('merge');
      } else if (mismatch.ahead > 0) {
        setGitMismatchAction('force-push');
      } else {
        setGitMismatchAction('backup');
      }
      return mismatch;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setGitMismatchBusy(false);
    }
  }, [accomplish, activeAgentId, gitSummary?.remoteName, workspaceRelativePath]);

  const openGitMismatchDialog = useCallback(() => {
    setGitMismatchView('resolve');
    setGitMismatchDialogOpen(true);
    void refreshGitMismatchSummary({ fetchFirst: true });
  }, [refreshGitMismatchSummary]);

  const openBuildGitReviewDialog = useCallback(() => {
    setGitReviewDialogOpen(true);
  }, []);

  useEffect(() => {
    if (!gitMismatchDialogOpen || gitMismatchSummary || gitMismatchBusy) return;
    void refreshGitMismatchSummary({ fetchFirst: true });
  }, [gitMismatchBusy, gitMismatchDialogOpen, gitMismatchSummary, refreshGitMismatchSummary]);

  const handleRunBuildGitResolveMismatch = useCallback(async () => {
    if (!activeAgentId) return;
    setGitActionBusy('resolve-mismatch');
    setGitActionNotice(null);
    setGitActionHints([]);
    setError(null);
    try {
      const result = await accomplish.resolveBuildGitMismatch({
        agentId: activeAgentId,
        relativePath: workspaceRelativePath,
        action: gitMismatchAction,
        createBackup: gitMismatchCreateBackup,
        backupBranchName: gitMismatchBackupBranchName,
      });
      if (result.summary) setGitSummary(result.summary);
      setGitActionNotice(result.message);
      setGitActionHints(result.hints || []);
      await Promise.all([
        refreshDiff(),
        refreshFingerprint(),
        refreshGitSummary(),
        refreshTree(),
        refreshGitMismatchSummary(),
      ]);
      if (result.ok && !['merge', 'rebase'].includes(gitMismatchAction)) {
        setGitMismatchDialogOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitActionBusy(null);
    }
  }, [
    accomplish,
    activeAgentId,
    gitMismatchAction,
    gitMismatchBackupBranchName,
    gitMismatchCreateBackup,
    refreshDiff,
    refreshFingerprint,
    refreshGitMismatchSummary,
    refreshGitSummary,
    refreshTree,
    workspaceRelativePath,
  ]);

  const runAiGoal = useCallback(async (promptOverride?: string) => {
    const currentPromptValue = promptOverride ?? goalPromptDraftRef.current ?? goalPrompt;
    if (!activeAgentId || !snapshot || !currentPromptValue.trim()) return;
    if (submittingBuildPromptRef.current || aiBusyRef.current) return;
    if (buildDiffEnforcementMode === 'approval' && pendingDiffBaselineId && (diff?.needsApproval || (diff?.files || []).length > 0)) {
      setError('Resolve pending changes in Changes & Git first (Approve or Reject) before starting a new AI task.');
      return;
    }

    setError(null);
    submittingBuildPromptRef.current = true;
    aiBusyRef.current = true;
    setAiBusy(true);
    try {
      // Recheck the parent before changing history or capturing a new baseline.
      // It may have resumed between rendering the idle controls and this click.
      if (activeHistoryRunTaskId) {
        const currentTask = await accomplish.getTask(activeHistoryRunTaskId, activeAgentId);
        if (currentTask && isBuildTaskActive(currentTask)) {
          setAiTaskId(currentTask.id);
          if (currentTask.sessionId) setActiveHistorySessionToken(currentTask.sessionId);
          return; // Keep the user's draft ready for the next turn.
        }
      }
      activeRunDiffBaselineIdRef.current = null;
      lastRunningGitSummaryRefreshAtRef.current = 0;
      runningChangeRefreshInFlightRef.current = false;
      setDiff(null);
      setSelectedDiffFilePath(null);
      const userGoalPrompt = currentPromptValue.trim();
      syncGoalPromptState(userGoalPrompt, { immediate: true });
      const localGoalMessage: TaskMessage = {
        id: `local-build-goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'user',
        content: userGoalPrompt,
        timestamp: new Date().toISOString(),
      };
      const buildPromptRunId = localGoalMessage.id.replace('local-build-goal-', 'local-build-run-');
      activeRunSummaryIdRef.current = buildPromptRunId;
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
        activeRunDiffBaselineIdRef.current = baseline.baselineId;
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
        activeRunDiffBaselineIdRef.current = null;
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
          usageProjectId: selectedBuildProjectId ?? null,
        });
        sessionId = created.id;
        setActiveHistorySessionId(created.id);
      }

      const testsInstruction = buildAiTestsInstruction(askAiToRunTests);
      const compiledPrompt = [
        'Build Mode goal:',
        userGoalPrompt,
        '',
        `Workspace: ${snapshot.workspaceRoot}`,
        `Project type: ${snapshot.detection.projectType}`,
        `Preset: ${selectedPreset?.name || 'none'}`,
        `Env profile: ${activeEnvProfile?.name || 'none'}`,
        'Process: plan, apply file edits, run checks, and summarize final diff.',
        testsInstruction ? '' : null,
        testsInstruction,
      ].filter((line): line is string => typeof line === 'string').join('\n');

      let task: Task;
      if (activeHistorySessionToken && activeHistoryRunTaskId) {
        task = await accomplish.resumeSession(
          activeHistorySessionToken,
          compiledPrompt,
          activeHistoryRunTaskId,
          promptAttachedFiles.length > 0 ? promptAttachedFiles : undefined,
          undefined,
          selectedBuildProjectId ?? null,
          {
            workingDirectory: snapshot.workspaceRoot,
            requiresBrowser: true,
            buildMode: true,
            buildWorkspaceRelativePath: workspaceRelativePath || '.',
          },
        );
      } else {
        task = await accomplish.startTask({
          prompt: compiledPrompt,
          agentId: activeAgentId,
          workingDirectory: snapshot.workspaceRoot,
          attachedFiles: promptAttachedFiles.length > 0 ? promptAttachedFiles : undefined,
          usageProjectId: selectedBuildProjectId ?? null,
          requiresBrowser: true,
          buildMode: true,
          buildWorkspaceRelativePath: workspaceRelativePath || '.',
        });
      }

      setJourneyTask(task);
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
          usageProjectId: selectedBuildProjectId ?? null,
          messages: optimisticMessages,
          lifecycleStatus: mapTaskStatusToLifecycle(task.status),
          activeRun: {
            id: buildPromptRunId,
            taskId: task.id,
            sessionId: task.sessionId,
            status: task.status,
            startedAt: task.startedAt || task.createdAt || new Date().toISOString(),
          },
          latestSnapshot: snapshot,
          latestDiff: diff,
          latestFingerprint: workspaceFingerprint,
          latestQualityCheckRun: qualityCheckRun,
          runtimeLogs: logs,
        });
      }
    } catch (err) {
      const currentTask = activeHistoryRunTaskId
        ? await accomplish.getTask(activeHistoryRunTaskId, activeAgentId).catch(() => null)
        : null;
      const stillActive = Boolean(currentTask && isBuildTaskActive(currentTask));
      aiBusyRef.current = stillActive;
      setAiBusy(stillActive);
      if (stillActive && currentTask) setAiTaskId(currentTask.id);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      submittingBuildPromptRef.current = false;
    }
  }, [
    accomplish,
    activeAgentId,
    buildDiffEnforcementMode,
    activeEnvProfile,
    activeHistoryRunTaskId,
    activeHistorySessionId,
    activeHistorySessionToken,
    askAiToRunTests,
    diff,
    goalPrompt,
    logs,
    selectedPreset,
    selectedPresetId,
    selectedBuildProjectId,
    syncGoalPromptState,
    snapshot,
    workspaceFingerprint,
    workspaceRelativePath,
    pendingDiffBaselineId,
    promptAttachedFiles,
    qualityCheckRun,
  ]);

  const refreshQualityChecks = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const run = await accomplish.getBuildQualityChecks({
        agentId: activeAgentId,
        workspaceRelativePath,
      });
      if (run) {
        setQualityCheckRun(run);
      }
    } catch {
      // Ignore missing or stale quality-check state.
    }
  }, [accomplish, activeAgentId, workspaceRelativePath]);

  const handleRunQualityChecks = useCallback(async () => {
    if (!activeAgentId) return;
    setQualityChecksBusy(true);
    setError(null);
    try {
      const run = await accomplish.runBuildQualityChecks({
        agentId: activeAgentId,
        workspaceRelativePath,
        diffSignature: currentDiffSignature,
        changedFileCount: changedDiffFiles.length,
        trigger: 'manual',
      });
      setQualityCheckRun(run);
      if (currentDiffSignature) {
        setDismissedQualityCheckSuggestionKey(currentDiffSignature);
      }
      if (activeHistorySessionId) {
        await accomplish.updateBuildTaskHistorySession({
          sessionId: activeHistorySessionId,
          latestQualityCheckRun: run,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQualityChecksBusy(false);
    }
  }, [accomplish, activeAgentId, activeHistorySessionId, changedDiffFiles.length, currentDiffSignature, workspaceRelativePath]);

  const renderBuildGitReviewContent = useCallback((options?: { compact?: boolean; inDialog?: boolean; fullscreen?: boolean }) => {
    const compact = options?.compact === true;
    const inDialog = options?.inDialog === true;
    const fullscreen = options?.fullscreen === true;
    const reviewFiles = reviewFilesForGitPanel;
    const tabs: Array<{ id: typeof gitReviewTab; label: string }> = [
      { id: 'overview', label: 'Overview' },
      { id: 'files', label: 'Files' },
      { id: 'diff', label: 'Diff' },
      { id: 'git', label: 'Git' },
      { id: 'sources', label: 'Sources' },
    ];
    const canApproveOrReject = Boolean(
      buildDiffEnforcementMode === 'approval'
      && pendingDiffBaselineId
      && diff?.mode === 'synthetic'
      && changedDiffFiles.length > 0
    );
    const gitPrimaryCta = getBuildGitPrimaryCta(gitSummary);

    const overview = (
      <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
        <div className="col-span-full rounded-md border border-border/70 bg-card p-2 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase text-muted-foreground">Git next step</div>
              <div className="truncate text-xs text-muted-foreground" title={gitPrimaryCta.detail}>
                {gitPrimaryCta.detail}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                className="h-8 px-3 text-[11px]"
                disabled={gitSummaryBusy || getBuildGitPrimaryActionDisabled(gitSummary)}
                onClick={openGitPrimaryActionDialog}
                title={getBuildGitPrimaryActionDisabled(gitSummary) ? (gitPrimaryCta.disabledReason || gitPrimaryCta.detail) : undefined}
              >
                {gitActionBusy === 'commit' || gitActionBusy === 'push' || gitActionBusy === 'init' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {gitPrimaryCta.label}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-[11px]"
                onClick={() => {
                  setGitReviewTab('files');
                  if (!inDialog) setGitReviewDialogOpen(true);
                }}
              >
                Review files
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-[11px]"
                disabled={!gitSummary?.isRepository}
                onClick={openGitMismatchDialog}
              >
                Resolve mismatch
              </Button>
              <Popover onOpenChange={(open) => {
                if (open) void refreshBuildGitStashes();
              }}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 px-2 text-[11px]">
                    More Git actions
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[360px] p-2">
                  <div className="space-y-2 text-[11px]">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={!gitSummary?.hasChanges || Boolean(gitSummary?.conflictedCount) || gitActionBusy === 'stash-create'} onClick={() => void handleRunBuildGitSaveAside()}>
                        {gitActionBusy === 'stash-create' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" />}
                        Save changes aside
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={gitActionBusy === 'fetch' || !gitSummary?.remoteName} onClick={() => void handleRunBuildGitFetch()}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Fetch status
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={gitActionBusy === 'pull' || !gitSummary?.upstream || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)} onClick={() => setGitPullDialogOpen(true)}>
                        Pull updates
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={!gitSummary?.isRepository || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)} onClick={() => {
                        setGitBranchMode('switch');
                        setGitBranchName(gitSummary?.branch || '');
                        setGitBranchDialogOpen(true);
                      }}>
                        <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                        Branches
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={!gitSummary?.isRepository || Boolean(gitSummary?.remoteName)} onClick={() => {
                        setGitRemoteCreateProvider('github');
                        setGitRemoteCreateName(gitSummary?.repositoryName || selectedPreset?.name || '');
                        setGitRemoteCreateSteps([]);
                        setGitRemoteCreateDialogOpen(true);
                      }}>
                        Create remote repo
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={!gitSummary?.remoteName} onClick={() => {
                        setGitRemoteEditName(gitSummary?.remoteName || 'origin');
                        setGitRemoteEditUrl(gitSummary?.remoteUrl || '');
                        setGitRemoteEditDialogOpen(true);
                      }}>
                        Edit remote
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={!gitSummary?.isRepository || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount) || Boolean(gitSummary?.ahead) || !gitSummary?.upstream} onClick={() => {
                        setGitPrTitle(defaultCommitMessage || `Update ${selectedPreset?.name || 'workspace'}`);
                        setGitPrBody('');
                        setGitPrSteps([]);
                        setGitPrDialogOpen(true);
                      }}>
                        Create pull request
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 justify-start px-2 text-[11px]" disabled={!gitSummary?.authSetupHints.length} onClick={() => setGitReviewTab('git')}>
                        Credential help
                      </Button>
                    </div>
                    {showGitHelpTips ? (
                      <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-muted-foreground">
                        Save changes aside uses Git stash: it temporarily stores uncommitted work so pull or branch actions can run without overwriting it. Pull requests are review pages on your Git host after a branch is pushed.
                      </div>
                    ) : null}
                    <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">Saved-aside changes</span>
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => void refreshBuildGitStashes()}>
                          Refresh
                        </Button>
                      </div>
                      {gitStashes.length > 0 ? (
                        <div className="max-h-32 space-y-1 overflow-auto">
                          {gitStashes.slice(0, 5).map((stash) => (
                            <div key={stash.ref} className="rounded-md border border-border/40 bg-background/70 p-1.5">
                              <div className="truncate font-medium text-foreground" title={stash.message}>{stash.ref} · {stash.message}</div>
                              <div className="mt-1 flex gap-1">
                                <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={gitActionBusy === 'stash-apply'} onClick={() => void handleRunBuildGitApplyStash(stash.ref)}>
                                  Apply
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={gitActionBusy === 'stash-drop'} onClick={() => void handleRunBuildGitDropStash(stash.ref)}>
                                  Delete
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">No saved-aside changes.</div>
                      )}
                    </div>
                    <label className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/10 px-2 py-1.5 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={showGitHelpTips}
                        onChange={(event) => setShowGitHelpTips(event.target.checked)}
                      />
                      Show Git help tips
                    </label>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'sm:grid-cols-2 2xl:grid-cols-4')}>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Environment</div>
              <div className="truncate text-xs font-medium text-foreground" title={workspaceRelativePath || '.'}>
                {workspaceRelativePath || '.'}
              </div>
              {gitSummary?.repositoryOwner && gitSummary.repositoryName ? (
                <div
                  className="mt-1 truncate text-[10px] text-muted-foreground"
                  title={gitSummary.repositoryWebUrl || gitSummary.remoteUrl}
                >
                  {gitSummary.remoteProvider || 'git'} · {gitSummary.repositoryOwner}/{gitSummary.repositoryName}
                </div>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                <span className={cn('rounded-full px-1.5 py-0.5 font-medium', getBuildGitRepositoryStateClasses(gitSummary))}>
                  {gitSummaryBusy ? 'Checking' : formatBuildGitRepositoryState(gitSummary)}
                </span>
                <span
                  className={cn('rounded-full px-1.5 py-0.5 font-medium', getBuildGitSyncStatusClasses(gitSummary))}
                  title={gitSummary?.syncDetail || 'Checking Git sync status.'}
                >
                  {formatBuildGitSyncStatus(gitSummary)}
                </span>
                <span
                  className={cn('rounded-full px-1.5 py-0.5 font-medium', getBuildGitAuthStatusClasses(gitSummary))}
                  title={gitSummary?.authDetail || 'Checking Git authentication status.'}
                >
                  {formatBuildGitAuthStatus(gitSummary)}
                </span>
                {gitSummary?.branch ? (
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate">{gitSummary.branch}</span>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Changes</div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-foreground">{effectiveChangedFileCount} files</span>
                <span className="text-xs font-medium">
                  <span className="text-emerald-500">+{effectiveAddedLines}</span>
                  <span className="text-muted-foreground"> </span>
                  <span className="text-red-500">-{effectiveDeletedLines}</span>
                </span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {gitSummary?.isRepository
                  ? `${gitSummary.stagedCount} staged · ${gitSummary.unstagedCount} unstaged · ${gitSummary.untrackedCount} untracked`
                  : (diff?.summary || 'No Git summary available.')}
              </div>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Commit or push</div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 max-w-full px-2 text-[11px]"
                disabled={gitSummaryBusy || getBuildGitPrimaryActionDisabled(gitSummary)}
                onClick={openGitPrimaryActionDialog}
                title={gitSummary?.nextAction.detail || 'Git action is not available yet.'}
              >
                {gitActionBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                <span className="truncate">{gitSummary?.nextAction.label || 'Checking Git'}</span>
              </Button>
              <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground" title={gitSummary?.nextAction.detail}>
                {gitSummary?.nextAction.detail || 'Checking the selected workspace.'}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={gitActionBusy === 'fetch' || !gitSummary?.remoteName}
                  onClick={() => void handleRunBuildGitFetch()}
                  title="Fetch latest remote status without changing local files."
                >
                  {gitActionBusy === 'fetch' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  Fetch
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={gitActionBusy === 'pull' || !gitSummary?.upstream || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)}
                  onClick={() => setGitPullDialogOpen(true)}
                  title="Pull remote changes with a safe fast-forward update. Commit or discard local changes first."
                >
                  Pull
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={!gitSummary?.isRepository || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)}
                  onClick={() => {
                    setGitBranchMode('switch');
                    setGitBranchName(gitSummary?.branch || '');
                    setGitBranchDialogOpen(true);
                  }}
                  title="Switch to an existing branch or create a new branch."
                >
                  Branch
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={!gitSummary?.remoteName}
                  onClick={() => {
                    setGitRemoteEditName(gitSummary?.remoteName || 'origin');
                    setGitRemoteEditUrl(gitSummary?.remoteUrl || '');
                    setGitRemoteEditDialogOpen(true);
                  }}
                  title="Edit the remote URL for this repository."
                >
                  Remote
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={!gitSummary?.isRepository || !gitSummary?.upstream}
                  onClick={openGitMismatchDialog}
                  title="Open a guided flow for ahead, behind, diverged, conflict, and push-rejected branch states."
                >
                  Resolve
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Sources</div>
              <div className="text-xs font-medium text-foreground">
                {promptAttachedFiles.length > 0 ? `${promptAttachedFiles.length} attached` : 'Workspace context'}
              </div>
              <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                {promptAttachedFiles[0] || selectedPreset?.name || snapshot?.detection.projectType || 'No extra files attached.'}
              </div>
            </div>
          </div>

          {gitActionNotice ? (
            <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
              {gitActionNotice}
            </div>
          ) : null}

          {gitActionHints.length > 0 ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
              <div className="font-medium">What to do next</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {gitActionHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {gitSummary?.conflictedCount ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
              <div className="font-medium">Git conflicts need attention</div>
              <div className="mt-1">
                {gitSummary.conflictedCount} conflicted file{gitSummary.conflictedCount === 1 ? '' : 's'} must be resolved before committing, pulling, or pushing.
              </div>
            </div>
          ) : null}

          {gitSummary?.nextAction.warnings?.length ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
              {gitSummary.nextAction.warnings.join(' ')}
            </div>
          ) : null}

          {diffEmptyReason ? (
            <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
              {diffEmptyReason}
            </div>
          ) : null}

          {!compact && reviewFiles.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-border/60 bg-muted/10">
              {reviewFiles.slice(0, inDialog ? 12 : 6).map((file) => {
                return (
                  <button
                    key={`git-review-overview-${file.relativePath}`}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-2 py-1.5 text-left text-[11px] last:border-b-0 hover:bg-muted/40"
                    onClick={() => {
                      setSelectedDiffFilePath(file.relativePath);
                      setGitReviewTab('files');
                    }}
                    title={file.relativePath}
                  >
                    <span className="min-w-0 truncate text-foreground">{file.relativePath}</span>
                    <span className="shrink-0 font-medium">
                      <span className="text-emerald-500">+{file.addedLines}</span>
                      <span className="text-muted-foreground"> </span>
                      <span className="text-red-500">-{file.deletedLines}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <aside className={cn('space-y-2 rounded-md border border-border/60 bg-muted/10 p-2 text-[11px]', compact ? 'hidden' : '')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">Build review</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {effectiveChangedFileCount > 0
                  ? `${effectiveChangedFileCount} changed file${effectiveChangedFileCount === 1 ? '' : 's'}`
                  : 'No changed files detected'}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={qualityChecksBusy || !activeAgentId}
              onClick={() => void handleRunQualityChecks()}
              title="Run inferred typecheck, lint, test, build, runtime, and preview checks."
            >
              {qualityChecksBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              Run checks
            </Button>
          </div>

          {shouldSuggestQualityChecks ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
              <div className="font-medium">Checks suggested</div>
              <div className="mt-0.5 text-[10px] leading-relaxed">
                Changed files were detected after the AI task. Run checks before approving or continuing.
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={qualityChecksBusy || !activeAgentId}
                  onClick={() => void handleRunQualityChecks()}
                >
                  Run checks
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setDismissedQualityCheckSuggestionKey(currentDiffSignature || null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          <div className="rounded-md border border-border/50 bg-background/60 p-2">
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Summary</div>
            <div className="line-clamp-4 text-muted-foreground">{diff?.summary || 'No diff summary available.'}</div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/60 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">Runtime</span>
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', getRuntimeStatusClasses(buildReviewRuntimeStatus))}>
                {buildReviewRuntimeLabel}
              </span>
            </div>
            <div className="line-clamp-2 text-muted-foreground" title={buildReviewRuntimeDetail}>
              {buildReviewRuntimeDetail}
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/60 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">Checks</span>
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', getQualityCheckStatusClasses(qualityCheckRun?.status))}>
                {formatQualityCheckSummary(qualityCheckRun)}
              </span>
            </div>
            {qualityCheckRun ? (
              <div className="space-y-1">
                {qualityCheckRun.completedAt ? (
                  <div className="text-[10px] text-muted-foreground">Last run {formatTimestamp(qualityCheckRun.completedAt)}</div>
                ) : null}
                {qualityCheckRun.checks.slice(0, 4).map((check) => (
                  <div key={`${qualityCheckRun.id}-${check.kind}`} className="rounded-md border border-border/40 bg-muted/20 px-2 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-foreground">{check.label}</span>
                      <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', getQualityCheckStatusClasses(check.status))}>
                        {check.status}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground" title={check.output || check.summary}>
                      {check.command ? `${check.command}: ` : ''}{check.summary}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">
                Checks are inferred from package scripts and active Build presets. They run only when you click the button.
              </div>
            )}
          </div>

          {previewScreenshotSrc ? (
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Preview screenshot</div>
              <img
                src={previewScreenshotSrc}
                alt="Preview screenshot"
                className="mt-1 aspect-video w-full rounded border border-border/50 object-cover"
              />
            </div>
          ) : null}

          {canApproveOrReject ? (
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">Approval</div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 px-2 text-[11px]"
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
                  className="h-7 flex-1 px-2 text-[11px]"
                  disabled={resolvingDiffDecision !== null}
                  onClick={() => void resolvePendingDiffBaseline('reject')}
                  title="Reject pending AI changes and restore baseline files."
                >
                  {resolvingDiffDecision === 'reject' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    );

    const files = (
      <div className={cn('grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(220px,280px)_1fr]', fullscreen && 'h-full')}>
        <div className={cn(
          'overflow-auto rounded-md border border-border/60 bg-muted/20 p-1',
          fullscreen ? 'h-full max-h-none' : 'max-h-[55vh]'
        )}>
          {reviewFiles.length > 0 ? reviewFiles.map((file) => {
            const selected = selectedReviewFilePath === file.relativePath;
            const canDiscard = Boolean(gitSummary?.files.some((entry) => entry.relativePath === file.relativePath));
            return (
              <div
                key={`git-review-file-${file.relativePath}`}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px]',
                  selected ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/50 text-muted-foreground'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDiffFilePath(file.relativePath);
                  }}
                  className="min-w-0 flex-1 text-left"
                  title={`${file.relativePath} · ${formatBuildGitFileStatus(file)}`}
                >
                  <span className="block truncate">{file.relativePath}</span>
                  <span className="block truncate text-[10px] text-muted-foreground/80">{formatBuildGitFileStatus(file)}</span>
                </button>
                <span className="shrink-0 font-medium">
                  <span className="text-emerald-500">+{file.addedLines}</span>
                  <span className="text-muted-foreground"> </span>
                  <span className="text-red-500">-{file.deletedLines}</span>
                </span>
                {canDiscard ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5 text-[10px]"
                    onClick={() => {
                      setGitDiscardPath(file.relativePath);
                      setGitDiscardDialogOpen(true);
                    }}
                    title="Discard local changes for this file after confirmation."
                  >
                    Discard
                  </Button>
                ) : null}
              </div>
            );
          }) : (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">No changed files detected.</div>
          )}
        </div>
        <BuildSideBySideDiffViewer
          filePath={selectedReviewFilePath}
          beforeContent={selectedDiffFileContent?.relativePath === selectedReviewFilePath
            ? selectedDiffFileContent.beforeContent
            : selectedDiffFile?.relativePath === selectedReviewFilePath
              ? selectedDiffFile.beforeContent
              : undefined}
          afterContent={selectedDiffFileContent?.relativePath === selectedReviewFilePath
            ? selectedDiffFileContent.afterContent
            : selectedDiffFile?.relativePath === selectedReviewFilePath
              ? selectedDiffFile.afterContent
              : undefined}
          beforeUnavailableReason={selectedDiffFileContent?.relativePath === selectedReviewFilePath
            ? selectedDiffFileContent.beforeUnavailableReason
            : undefined}
          afterUnavailableReason={selectedDiffFileContent?.relativePath === selectedReviewFilePath
            ? selectedDiffFileContent.afterUnavailableReason
            : undefined}
          beforeTruncated={selectedDiffFile?.relativePath === selectedReviewFilePath ? selectedDiffFile.beforeTruncated : false}
          afterTruncated={selectedDiffFile?.relativePath === selectedReviewFilePath ? selectedDiffFile.afterTruncated : false}
          patchSection={extractPatchSectionForPath(diff?.patch, selectedReviewFilePath)}
          fullscreen={fullscreen}
          loading={selectedDiffFileContentBusy}
          error={selectedDiffFileContentError}
        />
      </div>
    );

    const diffPreview = (
      <BuildUnifiedDiffViewer patch={diff?.patch} fullscreen={fullscreen} />
    );

    const gitDetails = (
      <div className={cn('grid content-start gap-2 text-[11px] md:grid-cols-2', fullscreen && 'xl:grid-cols-3')}>
        {[
          ['Git', gitSummary?.git.available ? (gitSummary.git.version || 'Available') : (gitSummary?.git.error || 'Unavailable'), null],
          ['Local Git repository', gitSummary?.isRepository ? 'Detected on this computer' : 'Not detected', null],
          ['Branch', gitSummary?.branch || 'None', null],
          ['Commit', gitSummary?.shortCommit || 'No commit', null],
          ['Remote', gitSummary?.remoteName || 'No remote configured', null],
          ['Detected provider', gitSummary?.remoteProvider ? gitSummary.remoteProvider : 'None', null],
          ['Repository', gitSummary?.repositoryOwner && gitSummary?.repositoryName ? `${gitSummary.repositoryOwner}/${gitSummary.repositoryName}` : 'None detected', null],
          ['Upstream', gitSummary?.upstream || 'None', 'upstream'],
          ['Ahead / behind', `${gitSummary?.ahead || 0} ahead · ${gitSummary?.behind || 0} behind`, null],
          ['Sync status', gitSummary ? `${formatBuildGitSyncStatus(gitSummary)} - ${gitSummary.syncDetail}` : 'Checking sync', null],
          ['Authentication', gitSummary ? `${formatBuildGitAuthStatus(gitSummary)} - ${gitSummary.authDetail}` : 'Checking authentication', null],
          ['GitHub CLI', gitSummary?.githubCli.available ? (gitSummary.githubCli.authenticated ? 'Available and authenticated' : 'Available, not authenticated') : (gitSummary?.githubCli.error || 'Unavailable'), null],
        ].map(([label, value, help]) => (
          <div key={label} className="rounded-md border border-border/50 bg-background/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
              {label}
              {help === 'upstream' ? (
                <GitHelpInfo label="Upstream" enabled={showGitHelpTips}>
                  The upstream is the remote branch Git compares this local branch against when checking whether you are ahead, behind, or ready to push.
                </GitHelpInfo>
              ) : null}
            </div>
            <div className="break-words text-foreground">{value}</div>
          </div>
        ))}
        <div className={cn('rounded-md border border-border/50 bg-background/60 p-2 md:col-span-2', fullscreen && 'xl:col-span-3')}>
          <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">Git actions</div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              disabled={gitActionBusy === 'fetch' || !gitSummary?.remoteName}
              onClick={() => void handleRunBuildGitFetch()}
              title="Fetch latest remote status without changing local files."
            >
              {gitActionBusy === 'fetch' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              Fetch
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              disabled={gitActionBusy === 'pull' || !gitSummary?.upstream || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)}
              onClick={() => setGitPullDialogOpen(true)}
              title="Pull remote changes with a safe fast-forward update."
            >
              Pull
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              disabled={!gitSummary?.isRepository || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)}
              onClick={() => {
                setGitBranchMode('switch');
                setGitBranchName(gitSummary?.branch || '');
                setGitBranchDialogOpen(true);
              }}
              title="Switch to an existing branch or create a new branch."
            >
              <GitBranch className="mr-1 h-3.5 w-3.5" />
              Branch
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              disabled={!gitSummary?.remoteName}
              onClick={() => {
                setGitRemoteEditName(gitSummary?.remoteName || 'origin');
                setGitRemoteEditUrl(gitSummary?.remoteUrl || '');
                setGitRemoteEditDialogOpen(true);
              }}
              title="Edit the remote URL for this repository."
            >
              Edit remote
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              disabled={!gitSummary?.isRepository || !gitSummary?.upstream}
              onClick={openGitMismatchDialog}
              title="Open a guided flow for ahead, behind, diverged, conflict, and push-rejected branch states."
            >
              Resolve mismatch
            </Button>
          </div>
          {gitSummary?.branches.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {gitSummary.branches.slice(0, 12).map((branch) => (
                <span
                  key={`${branch.remote ? 'remote' : 'local'}-${branch.name}`}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[10px]',
                    branch.current ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                  title={branch.upstream ? `${branch.name} tracks ${branch.upstream}` : branch.name}
                >
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="truncate">{branch.name}</span>
                  {branch.remote ? <span className="text-muted-foreground/80">remote</span> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {gitSummary?.remoteUrl ? (
          <div className={cn('rounded-md border border-border/50 bg-background/60 p-2 md:col-span-2', fullscreen && 'xl:col-span-3')}>
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Remote URL</div>
            <div className="break-all text-foreground">{gitSummary.remoteUrl}</div>
          </div>
        ) : null}
        {gitSummary?.repositoryWebUrl ? (
          <div className={cn('rounded-md border border-border/50 bg-background/60 p-2 md:col-span-2', fullscreen && 'xl:col-span-3')}>
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Repository page</div>
            <div className="break-all text-foreground">{gitSummary.repositoryWebUrl}</div>
          </div>
        ) : null}
        {gitSummary?.githubCli.detail ? (
          <div className={cn('rounded-md border border-border/50 bg-background/60 p-2 md:col-span-2', fullscreen && 'xl:col-span-3')}>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
              <Github className="h-3 w-3" />
              GitHub CLI detail
            </div>
            <div className="whitespace-pre-wrap text-muted-foreground">{gitSummary.githubCli.detail}</div>
          </div>
        ) : null}
        {gitSummary?.authSetupHints.length ? (
          <div className={cn('rounded-md border border-border/50 bg-background/60 p-2 md:col-span-2', fullscreen && 'xl:col-span-3')}>
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Credential setup hints</div>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {gitSummary.authSetupHints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );

    const sources = (
      <div className="space-y-2 text-[11px]">
        <div className="rounded-md border border-border/50 bg-background/60 p-2">
          <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Workspace</div>
          <div className="break-all text-foreground">{snapshot?.workspaceRoot || gitSummary?.workspaceRoot || 'No workspace loaded.'}</div>
          <div className="mt-1 text-muted-foreground">Relative path: {workspaceRelativePath || '.'}</div>
        </div>
        <div className="rounded-md border border-border/50 bg-background/60 p-2">
          <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Preset and model</div>
          <div className="text-foreground">{selectedPreset?.name || 'No preset'}</div>
          <div className="mt-1 text-muted-foreground">{modelBadgeLabel}</div>
        </div>
        <div className="rounded-md border border-border/50 bg-background/60 p-2">
          <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Attached files</div>
          {promptAttachedFiles.length > 0 ? (
            <div className="space-y-1">
              {promptAttachedFiles.map((file) => (
                <div key={file} className="truncate text-muted-foreground" title={file}>{file}</div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">No files are attached to the current prompt.</div>
          )}
        </div>
      </div>
    );

    if (compact) {
      return overview;
    }

    const tabContent = gitReviewTab === 'overview'
      ? overview
      : gitReviewTab === 'files'
        ? files
        : gitReviewTab === 'diff'
          ? diffPreview
          : gitReviewTab === 'git'
            ? gitDetails
            : sources;

    return (
      <div className={cn('flex min-h-0 flex-col gap-2', inDialog && 'h-full')}>
        <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-md border border-border/60 bg-muted/10 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                gitReviewTab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
              onClick={() => setGitReviewTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={cn('min-h-0', inDialog ? 'flex-1 overflow-auto pr-1' : '', fullscreen && 'h-full')}>
          {tabContent}
        </div>
      </div>
    );
  }, [
    activeAgentId,
    buildDiffEnforcementMode,
    buildReviewRuntimeDetail,
    buildReviewRuntimeLabel,
    buildReviewRuntimeStatus,
    changedDiffFiles,
    changedFilesSummary,
    currentDiffSignature,
    diff,
    diffEmptyReason,
    defaultCommitMessage,
    effectiveAddedLines,
    effectiveChangedFileCount,
    effectiveDeletedLines,
    gitActionBusy,
    gitActionHints,
    gitActionNotice,
    gitStashes,
    gitReviewTab,
    gitSummary,
    gitSummaryBusy,
    handleRunBuildGitApplyStash,
    handleRunBuildGitCreatePr,
    handleRunBuildGitDropStash,
    handleRunBuildGitFetch,
    handleRunBuildGitSaveAside,
    handleRunQualityChecks,
    modelBadgeLabel,
    openGitMismatchDialog,
    openGitPrimaryActionDialog,
    pendingDiffBaselineId,
    previewScreenshotSrc,
    promptAttachedFiles,
    qualityCheckRun,
    qualityChecksBusy,
    refreshBuildGitStashes,
    resolvingDiffDecision,
    resolvePendingDiffBaseline,
    reviewFilesForGitPanel,
    selectedDiffFileContent,
    selectedDiffFileContentBusy,
    selectedDiffFileContentError,
    selectedDiffFile,
    selectedReviewFilePath,
    selectedPreset?.name,
    shouldSuggestQualityChecks,
    showGitHelpTips,
    snapshot?.detection.projectType,
    snapshot?.workspaceRoot,
    workspaceRelativePath,
  ]);

  useEffect(() => {
    runAiGoalActionRef.current = (value: string) => {
      void runAiGoal(value);
    };
  }, [runAiGoal]);

  useEffect(() => {
    void refreshQualityChecks();
  }, [refreshQualityChecks]);

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
        activeRunSummaryIdRef.current = null;
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
        activeRunSummaryIdRef.current = null;
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
    activeRunSummaryIdRef.current = null;
    setActiveHistorySessionToken(null);
    setAiTaskId(null);
    setAiBusy(false);
    setAiMessages([]);
    setJourneyTask(null);
    setQualityCheckRun(null);
    setGoalPrompt('');
    goalPromptDraftRef.current = '';
    setPromptComposerResetKey((current) => current + 1);
    setPromptAttachedFiles([]);
  }, []);

  const addPromptAttachedFiles = useCallback((files: string[]) => {
    setPromptAttachedFiles((current) => {
      const deduped = new Set(current);
      for (const filePath of files) {
        if (typeof filePath === 'string' && filePath.trim()) {
          deduped.add(filePath);
        }
      }
      return Array.from(deduped);
    });
  }, []);

  const handleSelectPromptFiles = useCallback(async () => {
    try {
      const files = await accomplish.selectFiles();
      if (!Array.isArray(files) || files.length === 0) return;
      addPromptAttachedFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, addPromptAttachedFiles]);

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
    'text-xs prose prose-sm max-w-none overflow-x-auto',
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
    'prose-table:my-2 prose-table:w-full prose-table:border-collapse',
    'prose-thead:border-b prose-thead:border-border',
    'prose-th:border prose-th:border-border prose-th:bg-muted/70 prose-th:px-2 prose-th:py-1.5 prose-th:text-left prose-th:font-semibold prose-th:text-foreground prose-th:break-words',
    'prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1.5 prose-td:align-top prose-td:text-foreground prose-td:break-words',
    'prose-tr:border-border',
    'prose-hr:border-border',
  ), []);

  const localhostPreviewUrl = useMemo(() => resolveLocalhostPreviewUrl(snapshot), [snapshot]);

  const isIframePreviewReady = Boolean(
    snapshot
    && snapshot.detection.previewStrategy === 'iframe'
    && snapshot.runtime.previewUrl
    && snapshot.runtime.status === 'running'
  );
  const runtimeScreenshotAvailable = centerPanelView === 'preview' && isIframePreviewReady;

  const getRuntimeScreenshotPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const element = runtimePreviewCaptureRef.current;
    if (!element) return { x: 0, y: 0 };
    const rect = runtimeScreenshotSelectionRectRef.current || element.getBoundingClientRect();
    return {
      x: clampNumber(event.clientX - rect.left, 0, rect.width),
      y: clampNumber(event.clientY - rect.top, 0, rect.height),
    };
  }, []);

  const applyRuntimeScreenshotOverlay = useCallback((selection: RuntimeScreenshotSelection | null) => {
    const canvas = runtimeScreenshotSelectionCanvasRef.current;
    const rect = runtimeScreenshotSelectionRectRef.current;
    if (!canvas || !rect) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    if (!selection) {
      return;
    }
    const left = Math.min(selection.startX, selection.currentX);
    const top = Math.min(selection.startY, selection.currentY);
    const width = Math.abs(selection.currentX - selection.startX);
    const height = Math.abs(selection.currentY - selection.startY);

    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.fillRect(0, 0, rect.width, rect.height);
    context.clearRect(left, top, width, height);

    context.save();
    context.setLineDash([2, 4]);
    context.lineCap = 'round';
    context.lineWidth = 2;
    context.strokeStyle = '#14b8a6';
    context.strokeRect(left + 1, top + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    context.setLineDash([]);
    context.fillStyle = '#14b8a6';
    for (const [x, y] of [
      [left, top],
      [left + width, top],
      [left, top + height],
      [left + width, top + height],
    ]) {
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
    }
    const label = `${Math.round(width)} x ${Math.round(height)}`;
    context.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const labelWidth = context.measureText(label).width + 14;
    const labelX = Math.min(Math.max(4, left), Math.max(4, rect.width - labelWidth - 4));
    const labelY = top + height + 22 <= rect.height ? top + height + 8 : Math.max(4, top - 24);
    context.fillStyle = 'rgba(15, 23, 42, 0.94)';
    context.strokeStyle = 'rgba(148, 163, 184, 0.65)';
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(labelX, labelY, labelWidth, 20, 5);
    context.fill();
    context.stroke();
    context.fillStyle = '#cbd5e1';
    context.fillText(label, labelX + 7, labelY + 14);
    context.restore();
  }, []);

  const scheduleRuntimeScreenshotOverlayUpdate = useCallback((selection: RuntimeScreenshotSelection | null) => {
    runtimeScreenshotSelectionRef.current = selection;
    applyRuntimeScreenshotOverlay(selection);
  }, [applyRuntimeScreenshotOverlay]);

  const clearRuntimeScreenshotSelection = useCallback(() => {
    runtimeScreenshotSelectionRef.current = null;
    runtimeScreenshotSelectionRectRef.current = null;
    runtimeScreenshotSelectionDraggingRef.current = false;
    if (runtimeScreenshotFrameRef.current !== null) {
      window.cancelAnimationFrame(runtimeScreenshotFrameRef.current);
      runtimeScreenshotFrameRef.current = null;
    }
    applyRuntimeScreenshotOverlay(null);
  }, [applyRuntimeScreenshotOverlay]);

  const loadImageSize = useCallback((dataUrl: string) => new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 });
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = dataUrl;
  }), []);

  const openRuntimeScreenshotEditorFromDataUrl = useCallback(async (dataUrl: string, notice: string | null = null) => {
    const size = await loadImageSize(dataUrl);
    runtimeScreenshotUndoStackRef.current = [];
    runtimeScreenshotRedoStackRef.current = [];
    runtimeScreenshotBaseImageRef.current = null;
    setRuntimeScreenshotHistoryCounts({ undo: 0, redo: 0 });
    setRuntimeScreenshotEditorZoom(1);
    const nextEditor: RuntimeScreenshotEditorState = {
      baseDataUrl: dataUrl,
      annotations: [],
      tool: 'draw',
      selectedAnnotationId: null,
      outlineColor: '#ef4444',
      outlineEnabled: true,
      fillColor: 'transparent',
      fillOpacity: 1,
      strokeWidth: 4,
      strokeStyle: 'solid',
      text: '',
      width: size.width,
      height: size.height,
      notice,
      busy: false,
    };
    runtimeScreenshotEditorRef.current = nextEditor;
    setRuntimeScreenshotEditor(nextEditor);
  }, [loadImageSize]);

  const startRuntimeScreenshotSelectionDrag = useCallback((event: { clientX: number; clientY: number }) => {
    const element = runtimePreviewCaptureRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    runtimeScreenshotSelectionRectRef.current = {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    const point = getRuntimeScreenshotPoint(event);
    const selection = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y };
    runtimeScreenshotSelectionDraggingRef.current = true;
    runtimeScreenshotSelectionRef.current = selection;
    applyRuntimeScreenshotOverlay(selection);
  }, [applyRuntimeScreenshotOverlay, getRuntimeScreenshotPoint]);

  const updateRuntimeScreenshotSelectionDrag = useCallback((event: { clientX: number; clientY: number }) => {
    if (!runtimeScreenshotSelectionDraggingRef.current) return;
    const currentSelection = runtimeScreenshotSelectionRef.current;
    if (!currentSelection) return;
    const point = getRuntimeScreenshotPoint(event);
    scheduleRuntimeScreenshotOverlayUpdate({ ...currentSelection, currentX: point.x, currentY: point.y });
  }, [getRuntimeScreenshotPoint, scheduleRuntimeScreenshotOverlayUpdate]);

  const finishRuntimeScreenshotSelection = useCallback(async (selection: RuntimeScreenshotSelection) => {
    const element = runtimePreviewCaptureRef.current;
    if (!element) return;
    const previewRect = element.getBoundingClientRect();
    const left = Math.min(selection.startX, selection.currentX);
    const top = Math.min(selection.startY, selection.currentY);
    const width = Math.abs(selection.currentX - selection.startX);
    const height = Math.abs(selection.currentY - selection.startY);
    setRuntimeScreenshotSelecting(false);
    clearRuntimeScreenshotSelection();
    if (width < 10 || height < 10) return;
    setRuntimeScreenshotCapturing(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const result = await accomplish.captureWindowRect({
        x: previewRect.left + left,
        y: previewRect.top + top,
        width,
        height,
      });
      await openRuntimeScreenshotEditorFromDataUrl(result.dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRuntimeScreenshotCapturing(false);
    }
  }, [accomplish, clearRuntimeScreenshotSelection, openRuntimeScreenshotEditorFromDataUrl]);

  const finishRuntimeScreenshotSelectionDrag = useCallback((event?: { clientX: number; clientY: number }) => {
    if (!runtimeScreenshotSelectionDraggingRef.current) return;
    let selection = runtimeScreenshotSelectionRef.current;
    if (!selection) return;
    if (event) {
      const point = getRuntimeScreenshotPoint(event);
      selection = { ...selection, currentX: point.x, currentY: point.y };
      runtimeScreenshotSelectionRef.current = selection;
      applyRuntimeScreenshotOverlay(selection);
    }
    runtimeScreenshotSelectionDraggingRef.current = false;
    void finishRuntimeScreenshotSelection(selection);
  }, [applyRuntimeScreenshotOverlay, finishRuntimeScreenshotSelection, getRuntimeScreenshotPoint]);

  const cancelRuntimeScreenshotSelectionDrag = useCallback(() => {
    runtimeScreenshotSelectionDraggingRef.current = false;
    setRuntimeScreenshotSelecting(false);
    clearRuntimeScreenshotSelection();
  }, [clearRuntimeScreenshotSelection]);

  const beginRuntimeScreenshotSelection = useCallback(() => {
    if (!runtimeScreenshotAvailable) return;
    setCenterPanelView('preview');
    clearRuntimeScreenshotSelection();
    setRuntimeScreenshotCaptureMenuOpen(false);
    setRuntimeScreenshotSelecting(true);
  }, [clearRuntimeScreenshotSelection, runtimeScreenshotAvailable]);

  const captureFullRuntimePreview = useCallback(async () => {
    if (!runtimeScreenshotAvailable || !snapshot?.runtime.previewUrl) return;
    setCenterPanelView('preview');
    setRuntimeScreenshotCaptureMenuOpen(false);
    setRuntimeScreenshotSelecting(false);
    clearRuntimeScreenshotSelection();
    setRuntimeScreenshotCapturing(true);
    try {
      const result = await accomplish.captureRuntimePreviewFullPage(snapshot.runtime.previewUrl);
      const notice = result.clipped
        ? `Captured the preview page up to ${result.width} x ${result.height}. The page is ${result.fullWidth} x ${result.fullHeight}, so the image was clipped to keep it usable.`
        : 'Captured the full preview page.';
      await openRuntimeScreenshotEditorFromDataUrl(result.dataUrl, notice);
    } catch (err) {
      try {
        const element = runtimePreviewCaptureRef.current;
        if (!element) {
          throw err;
        }
        const previewRect = element.getBoundingClientRect();
        const result = await accomplish.captureWindowRect({
          x: previewRect.left,
          y: previewRect.top,
          width: previewRect.width,
          height: previewRect.height,
        });
        const detail = err instanceof Error ? err.message : String(err);
        await openRuntimeScreenshotEditorFromDataUrl(result.dataUrl, `Full-page capture was unavailable, so the visible preview was captured instead. ${detail}`);
      } catch (fallbackErr) {
        setError(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
      }
    } finally {
      setRuntimeScreenshotCapturing(false);
    }
  }, [
    accomplish,
    clearRuntimeScreenshotSelection,
    openRuntimeScreenshotEditorFromDataUrl,
    runtimeScreenshotAvailable,
    snapshot?.runtime.previewUrl,
  ]);

  useEffect(() => {
    if (runtimeScreenshotAvailable) return;
    setRuntimeScreenshotSelecting(false);
    clearRuntimeScreenshotSelection();
  }, [clearRuntimeScreenshotSelection, runtimeScreenshotAvailable]);

  useEffect(() => {
    if (!runtimeScreenshotSelecting) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelRuntimeScreenshotSelectionDrag();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelRuntimeScreenshotSelectionDrag, runtimeScreenshotSelecting]);

  useEffect(() => {
    if (!runtimeScreenshotSelecting) return;
    const handlePointerMove = (event: PointerEvent) => {
      if (!runtimeScreenshotSelectionDraggingRef.current) return;
      event.preventDefault();
      updateRuntimeScreenshotSelectionDrag(event);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!runtimeScreenshotSelectionDraggingRef.current) return;
      event.preventDefault();
      finishRuntimeScreenshotSelectionDrag(event);
    };
    const handleWindowBlur = () => {
      if (!runtimeScreenshotSelectionDraggingRef.current) return;
      cancelRuntimeScreenshotSelectionDrag();
    };
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, { capture: true });
      window.removeEventListener('pointerup', handlePointerUp, { capture: true });
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    cancelRuntimeScreenshotSelectionDrag,
    finishRuntimeScreenshotSelectionDrag,
    runtimeScreenshotSelecting,
    updateRuntimeScreenshotSelectionDrag,
  ]);

  useEffect(() => () => {
    if (runtimeScreenshotFrameRef.current !== null) {
      window.cancelAnimationFrame(runtimeScreenshotFrameRef.current);
      runtimeScreenshotFrameRef.current = null;
    }
  }, []);

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

  const drawRuntimeScreenshotCanvas = useCallback((
    canvas: HTMLCanvasElement | null,
    editor: RuntimeScreenshotEditorState | null,
    options: { showSelection?: boolean; hiddenAnnotationId?: string | null } = { showSelection: true }
  ) => {
    if (!canvas || !editor) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const paint = (image: HTMLImageElement) => {
      canvas.width = editor.width;
      canvas.height = editor.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      drawRuntimeScreenshotAnnotations(
        context,
        editor,
        options.showSelection !== false,
        options.hiddenAnnotationId ?? null
      );
    };

    const cached = runtimeScreenshotBaseImageRef.current;
    if (cached?.dataUrl === editor.baseDataUrl && cached.loaded) {
      paint(cached.image);
      return undefined;
    }

    const image = cached?.dataUrl === editor.baseDataUrl ? cached.image : new Image();
    runtimeScreenshotBaseImageRef.current = { dataUrl: editor.baseDataUrl, image, loaded: false };
    let cancelled = false;
    image.onload = () => {
      if (cancelled) return;
      runtimeScreenshotBaseImageRef.current = { dataUrl: editor.baseDataUrl, image, loaded: true };
      paint(image);
    };
    if (image.src !== editor.baseDataUrl) image.src = editor.baseDataUrl;
    return () => {
      cancelled = true;
    };
  }, []);

  const getActiveRuntimeScreenshotInlineTextId = useCallback((editor: RuntimeScreenshotEditorState | null) => {
    if (!editor?.selectedAnnotationId) return null;
    const selected = editor.annotations.find((annotation) => annotation.id === editor.selectedAnnotationId);
    return selected?.type === 'text' ? selected.id : null;
  }, []);

  const scheduleRuntimeScreenshotCanvasDraw = useCallback((editor: RuntimeScreenshotEditorState) => {
    runtimeScreenshotEditorRef.current = editor;
    if (runtimeScreenshotCanvasFrameRef.current !== null) return;
    runtimeScreenshotCanvasFrameRef.current = window.requestAnimationFrame(() => {
      runtimeScreenshotCanvasFrameRef.current = null;
      const latestEditor = runtimeScreenshotEditorRef.current;
      drawRuntimeScreenshotCanvas(runtimeScreenshotCanvasRef.current, latestEditor, {
        hiddenAnnotationId: getActiveRuntimeScreenshotInlineTextId(latestEditor),
      });
    });
  }, [drawRuntimeScreenshotCanvas, getActiveRuntimeScreenshotInlineTextId]);

  const previewRuntimeScreenshotEditor = useCallback((next: RuntimeScreenshotEditorState | null) => {
    runtimeScreenshotEditorRef.current = next;
    if (next) scheduleRuntimeScreenshotCanvasDraw(next);
    else drawRuntimeScreenshotCanvas(runtimeScreenshotCanvasRef.current, null);
    setRuntimeScreenshotEditor(next);
  }, [drawRuntimeScreenshotCanvas, scheduleRuntimeScreenshotCanvasDraw]);

  const setRuntimeScreenshotCanvasElement = useCallback((canvas: HTMLCanvasElement | null) => {
    runtimeScreenshotCanvasRef.current = canvas;
    if (canvas) {
      drawRuntimeScreenshotCanvas(canvas, runtimeScreenshotEditor, {
        hiddenAnnotationId: getActiveRuntimeScreenshotInlineTextId(runtimeScreenshotEditor),
      });
    }
  }, [drawRuntimeScreenshotCanvas, getActiveRuntimeScreenshotInlineTextId, runtimeScreenshotEditor]);

  useEffect(() => {
    runtimeScreenshotEditorRef.current = runtimeScreenshotEditor;
    return drawRuntimeScreenshotCanvas(runtimeScreenshotCanvasRef.current, runtimeScreenshotEditor, {
      hiddenAnnotationId: getActiveRuntimeScreenshotInlineTextId(runtimeScreenshotEditor),
    });
  }, [drawRuntimeScreenshotCanvas, getActiveRuntimeScreenshotInlineTextId, runtimeScreenshotEditor]);

  useEffect(() => () => {
    if (runtimeScreenshotCanvasFrameRef.current !== null) {
      window.cancelAnimationFrame(runtimeScreenshotCanvasFrameRef.current);
      runtimeScreenshotCanvasFrameRef.current = null;
    }
  }, []);

  const getRuntimeAnnotationPointFromClient = useCallback((clientX: number, clientY: number) => {
    const canvas = runtimeScreenshotCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: clampNumber(((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width, 0, canvas.width),
      y: clampNumber(((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height, 0, canvas.height),
    };
  }, []);

  const getRuntimeAnnotationPoint = useCallback((event: { clientX: number; clientY: number }) => (
    getRuntimeAnnotationPointFromClient(event.clientX, event.clientY)
  ), [getRuntimeAnnotationPointFromClient]);

  const getRuntimeAnnotationPointsFromPointerEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const nativeEvent = event.nativeEvent;
    const coalescedEvents = typeof nativeEvent.getCoalescedEvents === 'function'
      ? nativeEvent.getCoalescedEvents()
      : [];
    const points = coalescedEvents.map((coalescedEvent) => (
      getRuntimeAnnotationPointFromClient(coalescedEvent.clientX, coalescedEvent.clientY)
    ));
    const currentPoint = getRuntimeAnnotationPointFromClient(event.clientX, event.clientY);
    const lastPoint = points[points.length - 1];
    if (!lastPoint || runtimeScreenshotPointDistance(lastPoint, currentPoint) >= 0.35) {
      points.push(currentPoint);
    }
    return points;
  }, [getRuntimeAnnotationPointFromClient]);

  const updateRuntimeScreenshotHistoryCounts = useCallback(() => {
    setRuntimeScreenshotHistoryCounts({
      undo: runtimeScreenshotUndoStackRef.current.length,
      redo: runtimeScreenshotRedoStackRef.current.length,
    });
  }, []);

  const resetRuntimeScreenshotHistory = useCallback(() => {
    runtimeScreenshotUndoStackRef.current = [];
    runtimeScreenshotRedoStackRef.current = [];
    updateRuntimeScreenshotHistoryCounts();
  }, [updateRuntimeScreenshotHistoryCounts]);

  const pushRuntimeScreenshotUndoSnapshot = useCallback((previous: RuntimeScreenshotEditorState | null) => {
    if (!previous) return;
    const snapshot = runtimeScreenshotEditorHistorySnapshot(previous);
    const stack = runtimeScreenshotUndoStackRef.current;
    const lastSnapshot = stack[stack.length - 1];
    if (lastSnapshot && runtimeScreenshotHistorySnapshotKey(lastSnapshot) === runtimeScreenshotHistorySnapshotKey(snapshot)) return;
    stack.push(snapshot);
    if (stack.length > RUNTIME_SCREENSHOT_HISTORY_LIMIT) stack.shift();
    runtimeScreenshotRedoStackRef.current = [];
    updateRuntimeScreenshotHistoryCounts();
  }, [updateRuntimeScreenshotHistoryCounts]);

  const commitRuntimeScreenshotEditor = useCallback((
    next: RuntimeScreenshotEditorState | null,
    options: { historyFrom?: RuntimeScreenshotEditorState | null } = {}
  ) => {
    if (options.historyFrom) pushRuntimeScreenshotUndoSnapshot(options.historyFrom);
    runtimeScreenshotEditorRef.current = next;
    drawRuntimeScreenshotCanvas(runtimeScreenshotCanvasRef.current, next, {
      hiddenAnnotationId: getActiveRuntimeScreenshotInlineTextId(next),
    });
    setRuntimeScreenshotEditor(next);
  }, [drawRuntimeScreenshotCanvas, getActiveRuntimeScreenshotInlineTextId, pushRuntimeScreenshotUndoSnapshot]);

  const updateRuntimeScreenshotEditor = useCallback((
    patch: Partial<RuntimeScreenshotEditorState>,
    options: { recordHistory?: boolean } = {}
  ) => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    commitRuntimeScreenshotEditor(
      { ...current, ...patch },
      { historyFrom: options.recordHistory ? current : null }
    );
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor]);

  const updateSelectedRuntimeScreenshotAnnotation = useCallback((
    current: RuntimeScreenshotEditorState,
    updater: (annotation: RuntimeScreenshotAnnotation) => RuntimeScreenshotAnnotation
  ): RuntimeScreenshotEditorState => {
    if (!current.selectedAnnotationId) return current;
    return {
      ...current,
      annotations: current.annotations.map((annotation) => (
        annotation.id === current.selectedAnnotationId ? updater(annotation) : annotation
      )),
    };
  }, []);

  const applyRuntimeScreenshotOutlineColor = useCallback((outlineColor: string) => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => {
      if (annotation.type === 'text') return { ...annotation, color: outlineColor };
      return { ...annotation, outlineColor };
    });
    commitRuntimeScreenshotEditor({ ...next, outlineColor, outlineEnabled: true }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const toggleRuntimeScreenshotOutline = useCallback(() => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    const nextEnabled = !current.outlineEnabled;
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => {
      if (annotation.type === 'text') return annotation;
      return { ...annotation, outlineColor: nextEnabled ? current.outlineColor : 'transparent' };
    });
    commitRuntimeScreenshotEditor({ ...next, outlineEnabled: nextEnabled }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const applyRuntimeScreenshotFillColor = useCallback((fillColor: string) => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => {
      if (annotation.type === 'shape') return { ...annotation, fillColor };
      if (annotation.type === 'text') return { ...annotation, color: fillColor };
      return annotation;
    });
    commitRuntimeScreenshotEditor({ ...next, fillColor }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const applyRuntimeScreenshotFillOpacity = useCallback((fillOpacity: number) => {
    const nextOpacity = clampNumber(fillOpacity, 0, 1);
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => (
      annotation.type === 'shape' ? { ...annotation, fillOpacity: nextOpacity } : annotation
    ));
    commitRuntimeScreenshotEditor({ ...next, fillOpacity: nextOpacity }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const applyRuntimeScreenshotStrokeWidth = useCallback((strokeWidth: number) => {
    const nextWidth = clampNumber(Number(strokeWidth) || 1, 1, 18);
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => {
      if (annotation.type === 'text') return { ...annotation, fontSize: Math.max(12, nextWidth * 5) };
      if (annotation.type === 'freehand' || annotation.type === 'shape' || annotation.type === 'connector') {
        return { ...annotation, strokeWidth: nextWidth };
      }
      return annotation;
    });
    commitRuntimeScreenshotEditor({ ...next, strokeWidth: nextWidth }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const applyRuntimeScreenshotStrokeStyle = useCallback((strokeStyle: RuntimeScreenshotLineStyle) => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => (
      annotation.type === 'freehand' || annotation.type === 'shape' || annotation.type === 'connector'
        ? { ...annotation, strokeStyle }
        : annotation
    ));
    commitRuntimeScreenshotEditor({ ...next, strokeStyle }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const applyRuntimeScreenshotText = useCallback((text: string) => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => (
      annotation.type === 'text' ? { ...annotation, text } : annotation
    ));
    commitRuntimeScreenshotEditor({ ...next, text }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const applyRuntimeScreenshotInlineText = useCallback((text: string) => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    if (!runtimeScreenshotTextEditBaseRef.current) {
      runtimeScreenshotTextEditBaseRef.current = current;
      runtimeScreenshotTextEditHistoryPushedRef.current = false;
    }
    if (!runtimeScreenshotTextEditHistoryPushedRef.current) {
      pushRuntimeScreenshotUndoSnapshot(runtimeScreenshotTextEditBaseRef.current);
      runtimeScreenshotTextEditHistoryPushedRef.current = true;
    }
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => (
      annotation.type === 'text' ? { ...annotation, text } : annotation
    ));
    runtimeScreenshotEditorRef.current = { ...next, text };
  }, [pushRuntimeScreenshotUndoSnapshot, runtimeScreenshotEditor, updateSelectedRuntimeScreenshotAnnotation]);

  const syncRuntimeScreenshotInlineText = useCallback(() => {
    const input = runtimeScreenshotInlineTextInputRef.current;
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!input || !current?.selectedAnnotationId) return current;
    const selected = current.annotations.find((annotation) => annotation.id === current.selectedAnnotationId);
    if (selected?.type !== 'text') return current;
    const text = input.value;
    const width = Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_WIDTH, input.offsetWidth / runtimeScreenshotEditorZoom);
    const height = Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_HEIGHT, input.offsetHeight / runtimeScreenshotEditorZoom);
    const next = updateSelectedRuntimeScreenshotAnnotation(current, (annotation) => (
      annotation.type === 'text' ? { ...annotation, text, width, height } : annotation
    ));
    const updated = { ...next, text };
    runtimeScreenshotEditorRef.current = updated;
    setRuntimeScreenshotEditor(updated);
    runtimeScreenshotTextEditBaseRef.current = null;
    runtimeScreenshotTextEditHistoryPushedRef.current = false;
    return updated;
  }, [runtimeScreenshotEditor, runtimeScreenshotEditorZoom, updateSelectedRuntimeScreenshotAnnotation]);

  const startRuntimeScreenshotTextBoxDrag = useCallback((
    event: React.PointerEvent<HTMLElement>,
    mode: 'move' | 'resize'
  ) => {
    const current = syncRuntimeScreenshotInlineText() || runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    const selected = current?.annotations.find((annotation) => annotation.id === current.selectedAnnotationId);
    if (!current || selected?.type !== 'text') return;
    runtimeScreenshotTextBoxDragRef.current = {
      mode,
      annotationId: selected.id,
      startX: event.clientX,
      startY: event.clientY,
      original: selected,
      baseEditor: current,
      changed: false,
    };
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [runtimeScreenshotEditor, syncRuntimeScreenshotInlineText]);

  const runtimeScreenshotTextBoxDragResult = useCallback((drag: NonNullable<typeof runtimeScreenshotTextBoxDragRef.current>, clientX: number, clientY: number) => {
    const dx = (clientX - drag.startX) / runtimeScreenshotEditorZoom;
    const dy = (clientY - drag.startY) / runtimeScreenshotEditorZoom;
    if (drag.mode === 'move') {
      return {
        annotation: {
          ...drag.original,
          x: drag.original.x + dx,
          y: drag.original.y + dy,
        },
        bounds: runtimeScreenshotAnnotationBounds({
          ...drag.original,
          x: drag.original.x + dx,
          y: drag.original.y + dy,
        }),
      };
    }
    const annotation = {
      ...drag.original,
      width: Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_WIDTH, drag.original.width + dx),
      height: Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_HEIGHT, drag.original.height + dy),
    };
    return {
      annotation,
      bounds: runtimeScreenshotAnnotationBounds(annotation),
    };
  }, [runtimeScreenshotEditorZoom]);

  const applyRuntimeScreenshotTextBoxDragDom = useCallback((drag: NonNullable<typeof runtimeScreenshotTextBoxDragRef.current>, clientX: number, clientY: number) => {
    const { bounds, annotation } = runtimeScreenshotTextBoxDragResult(drag, clientX, clientY);
    const left = bounds.left * runtimeScreenshotEditorZoom;
    const top = bounds.top * runtimeScreenshotEditorZoom;
    const width = runtimeScreenshotTextBoxWidth(annotation) * runtimeScreenshotEditorZoom;
    const height = runtimeScreenshotTextBoxHeight(annotation) * runtimeScreenshotEditorZoom;
    const input = runtimeScreenshotInlineTextInputRef.current;
    if (input) {
      input.style.left = `${left}px`;
      input.style.top = `${top}px`;
      input.style.width = `${width}px`;
      input.style.height = `${height}px`;
    }
    const moveHandle = runtimeScreenshotTextBoxMoveHandleRef.current;
    if (moveHandle) {
      moveHandle.style.left = `${left - 10}px`;
      moveHandle.style.top = `${top - 10}px`;
    }
    const resizeHandle = runtimeScreenshotTextBoxResizeHandleRef.current;
    if (resizeHandle) {
      resizeHandle.style.left = `${left + width - 8}px`;
      resizeHandle.style.top = `${top + height - 8}px`;
    }
  }, [runtimeScreenshotEditorZoom, runtimeScreenshotTextBoxDragResult]);

  const moveRuntimeScreenshotTextBoxDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = runtimeScreenshotTextBoxDragRef.current;
    if (!drag) return;
    drag.changed = true;
    applyRuntimeScreenshotTextBoxDragDom(drag, event.clientX, event.clientY);
  }, [applyRuntimeScreenshotTextBoxDragDom]);

  const finishRuntimeScreenshotTextBoxDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = runtimeScreenshotTextBoxDragRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag?.changed) {
      const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
      if (current) {
        const { annotation: finalAnnotation } = runtimeScreenshotTextBoxDragResult(drag, event.clientX, event.clientY);
        const next = {
          ...current,
          annotations: current.annotations.map((annotation) => (
            annotation.id === drag.annotationId && annotation.type === 'text' ? finalAnnotation : annotation
          )),
        };
        commitRuntimeScreenshotEditor(next, { historyFrom: drag.baseEditor });
      }
    }
    runtimeScreenshotTextBoxDragRef.current = null;
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, runtimeScreenshotTextBoxDragResult]);

  const deleteSelectedRuntimeScreenshotAnnotation = useCallback(() => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    commitRuntimeScreenshotEditor({
      ...current,
      annotations: current.annotations.filter((annotation) => annotation.id !== current.selectedAnnotationId),
      selectedAnnotationId: null,
      notice: null,
    }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor]);

  const copySelectedRuntimeScreenshotAnnotation = useCallback(() => {
    const current = syncRuntimeScreenshotInlineText() || runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current?.selectedAnnotationId) return;
    const selected = current.annotations.find((annotation) => annotation.id === current.selectedAnnotationId);
    if (!selected) return;
    runtimeScreenshotAnnotationClipboardRef.current = cloneRuntimeScreenshotAnnotation(selected);
    runtimeScreenshotAnnotationPasteCountRef.current = 0;
    setRuntimeScreenshotAnnotationClipboardReady(true);
    commitRuntimeScreenshotEditor({ ...current, notice: 'Copied selected drawing item. Paste to duplicate it.' });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, syncRuntimeScreenshotInlineText]);

  const pasteRuntimeScreenshotAnnotation = useCallback(() => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    const copied = runtimeScreenshotAnnotationClipboardRef.current;
    if (!current || !copied) return;
    runtimeScreenshotAnnotationPasteCountRef.current += 1;
    const duplicate = duplicateRuntimeScreenshotAnnotation(copied, runtimeScreenshotAnnotationPasteCountRef.current * 18);
    commitRuntimeScreenshotEditor({
      ...current,
      annotations: [...current.annotations, duplicate],
      selectedAnnotationId: duplicate.id,
      tool: 'select',
      ...runtimeScreenshotControlPatchForAnnotation(duplicate),
      notice: 'Pasted duplicated drawing item.',
    }, { historyFrom: current });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor]);

  const setRuntimeScreenshotEditorBusy = useCallback((busy: boolean) => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!current) return;
    commitRuntimeScreenshotEditor({ ...current, busy });
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor]);

  const undoRuntimeScreenshotEdit = useCallback(() => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    const previous = runtimeScreenshotUndoStackRef.current.pop();
    if (!current || !previous) return;
    runtimeScreenshotRedoStackRef.current.push(runtimeScreenshotEditorHistorySnapshot(current));
    commitRuntimeScreenshotEditor(runtimeScreenshotEditorFromHistorySnapshot(current, previous));
    updateRuntimeScreenshotHistoryCounts();
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateRuntimeScreenshotHistoryCounts]);

  const redoRuntimeScreenshotEdit = useCallback(() => {
    const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    const next = runtimeScreenshotRedoStackRef.current.pop();
    if (!current || !next) return;
    runtimeScreenshotUndoStackRef.current.push(runtimeScreenshotEditorHistorySnapshot(current));
    commitRuntimeScreenshotEditor(runtimeScreenshotEditorFromHistorySnapshot(current, next));
    updateRuntimeScreenshotHistoryCounts();
  }, [commitRuntimeScreenshotEditor, runtimeScreenshotEditor, updateRuntimeScreenshotHistoryCounts]);

  const changeRuntimeScreenshotZoom = useCallback((direction: 'in' | 'out') => {
    setRuntimeScreenshotEditorZoom((current) => {
      const currentIndex = RUNTIME_SCREENSHOT_ZOOM_LEVELS.findIndex((level) => level >= current);
      const normalizedIndex = currentIndex === -1 ? RUNTIME_SCREENSHOT_ZOOM_LEVELS.length - 1 : currentIndex;
      const nextIndex = direction === 'in'
        ? Math.min(RUNTIME_SCREENSHOT_ZOOM_LEVELS.length - 1, normalizedIndex + 1)
        : Math.max(0, normalizedIndex - (RUNTIME_SCREENSHOT_ZOOM_LEVELS[normalizedIndex] === current ? 1 : 0));
      return RUNTIME_SCREENSHOT_ZOOM_LEVELS[nextIndex] ?? 1;
    });
  }, []);

  const annotatedRuntimeScreenshotDataUrl = useCallback((editor: RuntimeScreenshotEditorState) => new Promise<string>((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Unable to create screenshot canvas.'));
      return;
    }
    const image = new Image();
    image.onload = () => {
      canvas.width = editor.width;
      canvas.height = editor.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      drawRuntimeScreenshotAnnotations(context, editor, false);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('Unable to render screenshot image.'));
    image.src = editor.baseDataUrl;
  }), []);

  const saveRuntimeScreenshotToFile = useCallback(async (attachToPrompt: boolean) => {
    const editorForSave = syncRuntimeScreenshotInlineText() || runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!editorForSave) return;
    setRuntimeScreenshotEditorBusy(true);
    try {
      const latestEditor = runtimeScreenshotEditorRef.current || editorForSave;
      const dataUrl = await annotatedRuntimeScreenshotDataUrl(latestEditor);
      if (!dataUrl) throw new Error('No screenshot is available to save.');
      if (attachToPrompt) {
        const result = await accomplish.saveDataUrlToFile(dataUrl, 'runtime-preview-screenshot');
        setPromptAttachedFiles((current) => current.includes(result.filePath) ? current : [...current, result.filePath]);
        updateRuntimeScreenshotEditor({ notice: `Attached to prompt: ${result.filePath}` });
      } else {
        const result = await accomplish.saveDataUrlToFileAs(dataUrl, 'runtime-preview-screenshot');
        if (result.cancelled || !result.filePath) {
          updateRuntimeScreenshotEditor({ notice: 'Export cancelled.' });
          return;
        }
        updateRuntimeScreenshotEditor({ notice: `Exported: ${result.filePath}` });
        void accomplish.openPath(result.filePath).catch(() => undefined);
      }
    } catch (err) {
      updateRuntimeScreenshotEditor({ notice: err instanceof Error ? err.message : String(err) });
    } finally {
      setRuntimeScreenshotEditorBusy(false);
    }
  }, [accomplish, annotatedRuntimeScreenshotDataUrl, runtimeScreenshotEditor, setRuntimeScreenshotEditorBusy, syncRuntimeScreenshotInlineText, updateRuntimeScreenshotEditor]);

  const openRuntimeScreenshotDocumentDialog = useCallback(async () => {
    const editorForSave = syncRuntimeScreenshotInlineText() || runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!editorForSave) return;
    setRuntimeScreenshotEditorBusy(true);
    setRuntimeScreenshotDocumentError(null);
    try {
      const latestEditor = runtimeScreenshotEditorRef.current || editorForSave;
      const dataUrl = await annotatedRuntimeScreenshotDataUrl(latestEditor);
      if (!dataUrl) throw new Error('No screenshot is available to save.');
      const defaultProjectId = getDefaultSaveTargetUsageProjectId();
      const selectedProject = usageProjects.find((project) => project.id === defaultProjectId) || null;
      const fallbackProject = selectedProject || usageProjects[0] || null;
      const activeSessionTitle = historySessions.find((entry) => entry.id === activeHistorySessionId)?.title;
      const defaultTitle = defaultRuntimeScreenshotFileBaseName();

      setRuntimeScreenshotDocumentPending({ dataUrl });
      runtimeScreenshotDocumentFileTitleRef.current = defaultTitle;
      setRuntimeScreenshotDocumentFileTitle(defaultTitle);
      setRuntimeScreenshotDocumentDialogMode(fallbackProject ? 'existing-project' : 'new-project');
      setRuntimeScreenshotDocumentTargetProjectId(fallbackProject?.id || '');
      setRuntimeScreenshotDocumentTargetWorkItemId('');
      setRuntimeScreenshotDocumentWorkItems([]);
      setRuntimeScreenshotDocumentWorkItemsProjectId(fallbackProject?.id || '');
      setRuntimeScreenshotDocumentNewProjectName(
        selectedPreset?.name
          ? `${selectedPreset.name} budget`
          : activeSessionTitle
            ? `${activeSessionTitle} budget`
            : 'Build budget project'
      );
      setRuntimeScreenshotDocumentNewWorkItemTitle(activeSessionTitle || goalPrompt.trim() || 'Runtime preview screenshot');
      setRuntimeScreenshotDocumentDialogOpen(true);
      if (fallbackProject?.id) void loadRuntimeScreenshotDocumentWorkItemsForProject(fallbackProject.id);
    } catch (err) {
      updateRuntimeScreenshotEditor({ notice: err instanceof Error ? err.message : String(err) });
    } finally {
      setRuntimeScreenshotEditorBusy(false);
    }
  }, [
    activeHistorySessionId,
    annotatedRuntimeScreenshotDataUrl,
    getDefaultSaveTargetUsageProjectId,
    goalPrompt,
    historySessions,
    loadRuntimeScreenshotDocumentWorkItemsForProject,
    runtimeScreenshotEditor,
    selectedPreset?.name,
    setRuntimeScreenshotEditorBusy,
    syncRuntimeScreenshotInlineText,
    updateRuntimeScreenshotEditor,
    usageProjects,
  ]);

  const saveRuntimeScreenshotAsWorkItemDocument = useCallback(async () => {
    if (!runtimeScreenshotDocumentPending) return;
    setRuntimeScreenshotDocumentSaving(true);
    setRuntimeScreenshotDocumentError(null);
    try {
      const fileTitle = sanitizeSuggestedFileBaseName(
        runtimeScreenshotDocumentFileTitleRef.current,
        defaultRuntimeScreenshotFileBaseName()
      );
      const saved = await accomplish.saveDataUrlToFileAs(runtimeScreenshotDocumentPending.dataUrl, fileTitle);
      if (saved.cancelled || !saved.filePath) {
        updateRuntimeScreenshotEditor({ notice: 'Screenshot export cancelled.' });
        return;
      }

      let project: UsageProject | null = null;
      if (runtimeScreenshotDocumentDialogMode === 'new-project') {
        const created = await createUsageProject({
          name: runtimeScreenshotDocumentNewProjectName.trim() || 'Build budget project',
          color: '#2dd4bf',
          trackingEnabled: true,
        });
        if (!created) throw new Error('Unable to create project.');
        project = created;
        setRuntimeScreenshotDocumentTargetProjectId(created.id);
      } else {
        project = usageProjects.find((entry) => entry.id === runtimeScreenshotDocumentTargetProjectId) || null;
      }
      if (!project) throw new Error('Choose a project before attaching the screenshot.');

      await attachBuildUsageProjectSilently(project.id);

      const documentLink: UsageProjectWorkItemDocumentLink = {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: fileTitle,
        kind: 'local',
        path: saved.filePath,
        createdAt: new Date().toISOString(),
      };

      let workItem: UsageProjectWorkItem | null = null;
      if (runtimeScreenshotDocumentTargetWorkItemId && runtimeScreenshotDocumentTargetWorkItemId !== '__new__') {
        const cachedItems = runtimeScreenshotDocumentWorkItemsProjectId === project.id ? runtimeScreenshotDocumentWorkItems : [];
        workItem = cachedItems.find((item) => item.id === runtimeScreenshotDocumentTargetWorkItemId) || null;
        if (!workItem) {
          const items = await accomplish.listUsageProjectWorkItems({ projectId: project.id, includeArchived: true });
          workItem = items.find((item) => item.id === runtimeScreenshotDocumentTargetWorkItemId) || null;
        }
      }

      if (!workItem) {
        workItem = await accomplish.createUsageProjectWorkItem({
          usageProjectId: project.id,
          title: runtimeScreenshotDocumentNewWorkItemTitle.trim() || 'Runtime preview screenshot',
          sourceType: 'build_session',
          sourceId: activeHistorySessionId || activeHistoryRunTaskId || undefined,
          documents: [documentLink],
        });
      } else {
        workItem = await accomplish.updateUsageProjectWorkItem(workItem.id, {
          documents: [documentLink, ...(workItem.documents || [])],
        });
      }

      setRuntimeScreenshotDocumentDialogOpen(false);
      setRuntimeScreenshotDocumentPending(null);
      setRuntimeScreenshotDocumentWorkItems([]);
      setRuntimeScreenshotDocumentWorkItemsProjectId('');
      setRuntimeScreenshotDocumentTargetWorkItemId('');
      setRuntimeScreenshotDocumentNewWorkItemTitle('');
      updateRuntimeScreenshotEditor({
        notice: `Saved screenshot and attached it to "${workItem.title}" in "${project.name}".`,
      });
    } catch (err) {
      setRuntimeScreenshotDocumentError(err instanceof Error ? err.message : String(err));
    } finally {
      setRuntimeScreenshotDocumentSaving(false);
    }
  }, [
    accomplish,
    activeHistoryRunTaskId,
    activeHistorySessionId,
    attachBuildUsageProjectSilently,
    createUsageProject,
    runtimeScreenshotDocumentDialogMode,
    runtimeScreenshotDocumentNewProjectName,
    runtimeScreenshotDocumentNewWorkItemTitle,
    runtimeScreenshotDocumentPending,
    runtimeScreenshotDocumentTargetProjectId,
    runtimeScreenshotDocumentTargetWorkItemId,
    runtimeScreenshotDocumentWorkItems,
    runtimeScreenshotDocumentWorkItemsProjectId,
    updateRuntimeScreenshotEditor,
    usageProjects,
  ]);

  const updateRuntimeScreenshotAnnotationDrag = useCallback((point: { x: number; y: number }) => {
    const editor = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!editor) return false;
    const drag = runtimeScreenshotAnnotationDragRef.current;
    if (!drag || editor.tool !== 'select') return false;

    if (drag.mode === 'resize' && drag.handle) {
      const nextEditor = {
        ...editor,
        annotations: editor.annotations.map((annotation) => (
          annotation.id === drag.annotationId ? resizeRuntimeScreenshotAnnotation(drag.original, drag.handle as RuntimeScreenshotResizeHandle, point) : annotation
        )),
      };
      drag.moved = true;
      scheduleRuntimeScreenshotCanvasDraw(nextEditor);
      return true;
    }

    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    const nextEditor = {
      ...editor,
      annotations: editor.annotations.map((annotation) => (
        annotation.id === drag.annotationId ? offsetRuntimeScreenshotAnnotation(drag.original, dx, dy) : annotation
      )),
    };
    drag.moved = true;
    scheduleRuntimeScreenshotCanvasDraw(nextEditor);
    return true;
  }, [runtimeScreenshotEditor, scheduleRuntimeScreenshotCanvasDraw]);

  const startRuntimeScreenshotAnnotationResize = useCallback((
    event: React.PointerEvent<HTMLElement>,
    annotation: RuntimeScreenshotAnnotation,
    handle: RuntimeScreenshotResizeHandle
  ) => {
    const editor = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!editor || annotation.type === 'freehand' || annotation.type === 'text') return;
    event.preventDefault();
    event.stopPropagation();
    const point = getRuntimeAnnotationPoint(event);
    runtimeScreenshotAnnotationDragRef.current = {
      mode: 'resize',
      annotationId: annotation.id,
      startX: point.x,
      startY: point.y,
      original: annotation,
      baseEditor: editor,
      handle,
      moved: false,
    };
    previewRuntimeScreenshotEditor({
      ...editor,
      selectedAnnotationId: annotation.id,
      ...runtimeScreenshotControlPatchForAnnotation(annotation),
      notice: null,
    });
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }, [getRuntimeAnnotationPoint, previewRuntimeScreenshotEditor, runtimeScreenshotEditor]);

  const moveRuntimeScreenshotAnnotationHandleDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!runtimeScreenshotAnnotationDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    updateRuntimeScreenshotAnnotationDrag(getRuntimeAnnotationPoint(event));
  }, [getRuntimeAnnotationPoint, updateRuntimeScreenshotAnnotationDrag]);

  const handleRuntimeScreenshotCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const editor = syncRuntimeScreenshotInlineText() || runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!editor) return;
    const point = getRuntimeAnnotationPoint(event);
    if (editor.tool === 'select') {
      event.preventDefault();
      const selectedAnnotation = editor.annotations.find((annotation) => annotation.id === editor.selectedAnnotationId) || null;
      const resizeHandle = selectedAnnotation
        ? runtimeScreenshotResizeHandleAtPoint(selectedAnnotation, point, Math.max(8, 8 / runtimeScreenshotEditorZoom))
        : null;
      if (selectedAnnotation && resizeHandle) {
        runtimeScreenshotAnnotationDragRef.current = {
          mode: 'resize',
          annotationId: selectedAnnotation.id,
          startX: point.x,
          startY: point.y,
          original: selectedAnnotation,
          baseEditor: editor,
          handle: resizeHandle,
          moved: false,
        };
        previewRuntimeScreenshotEditor({ ...editor, selectedAnnotationId: selectedAnnotation.id, notice: null });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      const hit = [...editor.annotations].reverse().find((annotation) => runtimeScreenshotAnnotationContainsPoint(annotation, point)) || null;
      if (!hit) {
        previewRuntimeScreenshotEditor({ ...editor, selectedAnnotationId: null, notice: null });
        return;
      }
      runtimeScreenshotAnnotationDragRef.current = {
        mode: 'move',
        annotationId: hit.id,
        startX: point.x,
        startY: point.y,
        original: hit,
        baseEditor: editor,
        moved: false,
      };
      const nextEditor = {
        ...editor,
        selectedAnnotationId: hit.id,
        ...runtimeScreenshotControlPatchForAnnotation(hit),
        notice: null,
      };
      previewRuntimeScreenshotEditor(nextEditor);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (editor.tool === 'text') {
      const fontSize = Math.max(12, editor.strokeWidth * 5);
      const annotation: RuntimeScreenshotAnnotation = {
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'text',
        color: editor.fillColor === 'transparent' ? '#000000' : editor.fillColor,
        text: '',
        x: point.x + RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_X,
        y: point.y + RUNTIME_SCREENSHOT_TEXT_BOX_PADDING_TOP + fontSize,
        fontSize,
        width: 180,
        height: 48,
      };
      const nextEditor = {
        ...editor,
        annotations: [...editor.annotations, annotation],
        selectedAnnotationId: annotation.id,
        notice: null,
      };
      commitRuntimeScreenshotEditor(nextEditor, { historyFrom: editor });
      return;
    }
    const id = `mark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const annotation: RuntimeScreenshotAnnotation = editor.tool === 'draw'
      ? {
          id,
          type: 'freehand',
          outlineColor: editor.outlineEnabled ? editor.outlineColor : 'transparent',
          strokeWidth: editor.strokeWidth,
          strokeStyle: editor.strokeStyle,
          points: [point],
        }
      : editor.tool === 'line' || editor.tool === 'arrow'
        ? {
            id,
            type: 'connector',
            connector: editor.tool,
            outlineColor: editor.outlineEnabled ? editor.outlineColor : 'transparent',
            strokeWidth: editor.strokeWidth,
            strokeStyle: editor.strokeStyle,
            x1: point.x,
            y1: point.y,
            x2: point.x,
            y2: point.y,
          }
        : {
            id,
            type: 'shape',
            shape: editor.tool,
            outlineColor: editor.outlineEnabled ? editor.outlineColor : 'transparent',
            fillColor: editor.fillColor,
            fillOpacity: editor.fillOpacity,
            strokeWidth: editor.strokeWidth,
            strokeStyle: editor.strokeStyle,
            x1: point.x,
            y1: point.y,
            x2: point.x,
            y2: point.y,
    };
    runtimeScreenshotDrawingIdRef.current = id;
    runtimeScreenshotDrawingBaseRef.current = editor;
    const nextEditor = { ...editor, annotations: [...editor.annotations, annotation], selectedAnnotationId: annotation.id, notice: null };
    runtimeScreenshotEditorRef.current = nextEditor;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [commitRuntimeScreenshotEditor, getRuntimeAnnotationPoint, previewRuntimeScreenshotEditor, runtimeScreenshotEditor, runtimeScreenshotEditorZoom, syncRuntimeScreenshotInlineText]);

  const handleRuntimeScreenshotCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const editor = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    if (!editor) return;
    const point = getRuntimeAnnotationPoint(event);
    if (updateRuntimeScreenshotAnnotationDrag(point)) {
      return;
    }
    const drawingId = runtimeScreenshotDrawingIdRef.current;
    if (!drawingId || editor.tool === 'text') return;
    const freehandPoints = editor.tool === 'draw'
      ? getRuntimeAnnotationPointsFromPointerEvent(event)
      : [point];
    const nextEditor = {
      ...editor,
      annotations: editor.annotations.map((annotation) => (
        annotation.type === 'freehand' && annotation.id === drawingId
          ? { ...annotation, points: appendRuntimeScreenshotFreehandPoints(annotation.points, freehandPoints) }
          : (annotation.type === 'shape' || annotation.type === 'connector') && annotation.id === drawingId
            ? { ...annotation, x2: point.x, y2: point.y }
          : annotation
      )),
    };
    scheduleRuntimeScreenshotCanvasDraw(nextEditor);
  }, [
    getRuntimeAnnotationPoint,
    getRuntimeAnnotationPointsFromPointerEvent,
    runtimeScreenshotEditor,
    scheduleRuntimeScreenshotCanvasDraw,
    updateRuntimeScreenshotAnnotationDrag,
  ]);

  const finishRuntimeScreenshotDrawing = useCallback(() => {
    const latestEditor = runtimeScreenshotEditorRef.current;
    const drawingId = runtimeScreenshotDrawingIdRef.current;
    const drag = runtimeScreenshotAnnotationDragRef.current;
    if (latestEditor) {
      commitRuntimeScreenshotEditor(
        drawingId ? { ...latestEditor, selectedAnnotationId: null } : latestEditor,
        { historyFrom: drawingId ? runtimeScreenshotDrawingBaseRef.current : drag?.moved ? drag.baseEditor : null }
      );
    }
    runtimeScreenshotAnnotationDragRef.current = null;
    runtimeScreenshotDrawingIdRef.current = null;
    runtimeScreenshotDrawingBaseRef.current = null;
  }, [commitRuntimeScreenshotEditor]);

  const finishRuntimeScreenshotAnnotationHandleDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishRuntimeScreenshotDrawing();
  }, [finishRuntimeScreenshotDrawing]);

  const selectedRuntimeScreenshotAnnotation = useMemo(() => (
    runtimeScreenshotEditor?.annotations.find((annotation) => annotation.id === runtimeScreenshotEditor.selectedAnnotationId) || null
  ), [runtimeScreenshotEditor]);
  const selectedRuntimeScreenshotResizeHandles = useMemo(() => {
    if (
      !selectedRuntimeScreenshotAnnotation
      || selectedRuntimeScreenshotAnnotation.type === 'text'
      || selectedRuntimeScreenshotAnnotation.type === 'freehand'
    ) {
      return [];
    }
    return runtimeScreenshotResizeHandlePoints(selectedRuntimeScreenshotAnnotation).map(([handle, x, y]) => ({
      handle,
      x,
      y,
      cursor: handle === 'nw' || handle === 'se'
        ? 'nwse-resize'
        : handle === 'ne' || handle === 'sw'
          ? 'nesw-resize'
          : 'grab',
    }));
  }, [selectedRuntimeScreenshotAnnotation]);
  const selectedRuntimeScreenshotTextAnnotation = selectedRuntimeScreenshotAnnotation?.type === 'text'
    ? selectedRuntimeScreenshotAnnotation
    : null;
  const selectedRuntimeScreenshotTextBounds = useMemo(() => (
    selectedRuntimeScreenshotTextAnnotation
      ? runtimeScreenshotAnnotationBounds(selectedRuntimeScreenshotTextAnnotation)
      : null
  ), [selectedRuntimeScreenshotTextAnnotation]);

  const runtimeScreenshotFillControlVisible = Boolean(
    runtimeScreenshotEditor
      && (selectedRuntimeScreenshotAnnotation?.type === 'shape'
        || runtimeScreenshotEditor.tool === 'rectangle'
        || runtimeScreenshotEditor.tool === 'ellipse'
        || runtimeScreenshotEditor.tool === 'triangle')
  );
  const runtimeScreenshotFillRemoved = selectedRuntimeScreenshotAnnotation?.type === 'shape'
    ? selectedRuntimeScreenshotAnnotation.fillColor === 'transparent'
    : runtimeScreenshotEditor?.fillColor === 'transparent';
  const runtimeScreenshotFillColorDisabled = Boolean(
    runtimeScreenshotEditor && (
      selectedRuntimeScreenshotAnnotation
        ? selectedRuntimeScreenshotAnnotation.type === 'freehand' || selectedRuntimeScreenshotAnnotation.type === 'connector'
        : runtimeScreenshotEditor.tool === 'line'
          || runtimeScreenshotEditor.tool === 'arrow'
          || runtimeScreenshotEditor.tool === 'draw'
          || runtimeScreenshotEditor.tool === 'select'
    )
  );

  useEffect(() => {
    if (!selectedRuntimeScreenshotTextAnnotation) {
      runtimeScreenshotLastFocusedTextIdRef.current = null;
      runtimeScreenshotTextEditBaseRef.current = null;
      runtimeScreenshotTextEditHistoryPushedRef.current = false;
      return;
    }
    if (runtimeScreenshotLastFocusedTextIdRef.current === selectedRuntimeScreenshotTextAnnotation.id) return;
    runtimeScreenshotLastFocusedTextIdRef.current = selectedRuntimeScreenshotTextAnnotation.id;
    runtimeScreenshotTextEditBaseRef.current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
    runtimeScreenshotTextEditHistoryPushedRef.current = false;
    window.requestAnimationFrame(() => {
      const input = runtimeScreenshotInlineTextInputRef.current;
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = `${Math.max(34, input.scrollHeight)}px`;
      input.focus();
      input.select();
    });
  }, [runtimeScreenshotEditor, selectedRuntimeScreenshotTextAnnotation]);

  useEffect(() => {
    if (!runtimeScreenshotEditor) return undefined;
    const handleScreenshotEditorKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
      }
      const current = runtimeScreenshotEditorRef.current || runtimeScreenshotEditor;
      if (!current || current.busy) return;
      const key = event.key.toLowerCase();
      const isModifier = event.ctrlKey || event.metaKey;
      if (isModifier && key === 'c' && current.selectedAnnotationId) {
        event.preventDefault();
        event.stopPropagation();
        copySelectedRuntimeScreenshotAnnotation();
        return;
      }
      if (isModifier && key === 'v' && runtimeScreenshotAnnotationClipboardRef.current) {
        event.preventDefault();
        event.stopPropagation();
        pasteRuntimeScreenshotAnnotation();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!current.selectedAnnotationId) return;
        event.preventDefault();
        event.stopPropagation();
        deleteSelectedRuntimeScreenshotAnnotation();
      }
    };
    window.addEventListener('keydown', handleScreenshotEditorKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleScreenshotEditorKeyDown, true);
    };
  }, [
    copySelectedRuntimeScreenshotAnnotation,
    deleteSelectedRuntimeScreenshotAnnotation,
    pasteRuntimeScreenshotAnnotation,
    runtimeScreenshotEditor,
  ]);

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
    const handleAgentPickerOpen = () => {
      window.dispatchEvent(new CustomEvent('opendeskmate:open-settings', { detail: { query: 'agent' } }));
    };
    const handleProjectPickerOpen = () => {
      const projectSelector = document.querySelector<HTMLSelectElement>('select[data-usage-project-selector="build"]');
      projectSelector?.focus();
    };
    const handlePromptPickerOpen = () => {
      openSavedPrompts('select');
    };
    const handleRecipePickerOpen = () => {
      openSavedPrompts('select');
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
    window.addEventListener(APP_COMMAND_EVENTS.agentPickerOpen, handleAgentPickerOpen);
    window.addEventListener(APP_COMMAND_EVENTS.projectPickerOpen, handleProjectPickerOpen);
    window.addEventListener(APP_COMMAND_EVENTS.workboardOpen, openProjectWorkPopup);
    window.addEventListener(APP_COMMAND_EVENTS.promptPickerOpen, handlePromptPickerOpen);
    window.addEventListener(APP_COMMAND_EVENTS.recipePickerOpen, handleRecipePickerOpen);

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
      window.removeEventListener(APP_COMMAND_EVENTS.agentPickerOpen, handleAgentPickerOpen);
      window.removeEventListener(APP_COMMAND_EVENTS.projectPickerOpen, handleProjectPickerOpen);
      window.removeEventListener(APP_COMMAND_EVENTS.workboardOpen, openProjectWorkPopup);
      window.removeEventListener(APP_COMMAND_EVENTS.promptPickerOpen, handlePromptPickerOpen);
      window.removeEventListener(APP_COMMAND_EVENTS.recipePickerOpen, handleRecipePickerOpen);
    };
  }, [
    handleStartNewHistorySession,
    handleStopPrompt,
    openPreviewInBrowser,
    openProjectWorkPopup,
    openSavedPrompts,
    refreshSubagentRuns,
    runRuntimeAction,
  ]);

  const handleCopyAssistantMessage = useCallback(async (
    messageId: string,
    content: string,
    sourceElement?: HTMLElement | null
  ) => {
    try {
      const contentElement = sourceElement || assistantMessageContentRefs.current[messageId] || null;
      const plainText = contentElement?.innerText || content || '';
      const html = buildWordFriendlyClipboardHtml(contentElement, content);
      const rtf = await buildWordFriendlyClipboardRtf(contentElement, content);
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const rtfBlob = new Blob([rtf], { type: 'text/rtf' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
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

  const handleCopyAssistantMessageClick = useCallback((
    messageId: string,
    content: string,
    sourceElement?: HTMLElement | null
  ) => {
    void handleCopyAssistantMessage(messageId, content, sourceElement);
  }, [handleCopyAssistantMessage]);

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

  const buildTopBarControls = useMemo(() => (
    <TooltipProvider delayDuration={250}>
      <div className="flex max-w-[min(78vw,1520px)] items-center gap-2 overflow-x-auto rounded-full border border-border/60 bg-card/85 px-2 py-1 shadow-md backdrop-blur-md">
        <div className="shrink-0">
          <ModeSwitch />
        </div>
        <BuildTooltip
          content={`Active Build agent: ${activeAgent?.name || activeAgentId || 'None'}. Build tasks use this agent's model, persona prompt, workspace defaults, permissions, memory, and task history.`}
          side="bottom"
          align="start"
        >
          <div className="inline-flex max-w-[170px] shrink-0 items-center gap-1.5 truncate rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Agent: {activeAgent?.name || activeAgentId}</span>
          </div>
        </BuildTooltip>
        {modelBadgeLabel ? (
          <BuildTooltip
            content={modelBadgeLabel}
            side="bottom"
            align="start"
          >
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Code className="h-3.5 w-3.5 shrink-0" />
              <span>Model</span>
            </div>
          </BuildTooltip>
        ) : null}
        <BuildTooltip
          content={`Current Build runtime status: ${formatRuntimeStatus(snapshot?.runtime.status ?? 'stopped')}. This shows whether the project preview/dev server is stopped, starting, running, stopping, or in an error state.`}
          side="bottom"
          align="start"
        >
          <div className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', statusBadgeClass)}>
            {snapshot?.runtime.status === 'running' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            {formatRuntimeStatus(snapshot?.runtime.status ?? 'stopped')}
          </div>
        </BuildTooltip>
        {snapshot?.runtime.port ? (
          <BuildTooltip
            content={`The Build runtime preview server is using local port ${snapshot.runtime.port}, usually available at http://localhost:${snapshot.runtime.port}.`}
            side="bottom"
            align="start"
          >
            <div className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              Port {snapshot.runtime.port}
            </div>
          </BuildTooltip>
        ) : null}
        {snapshot?.runtime.buildStatus && snapshot.runtime.buildStatus !== 'unknown' ? (
          <div className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs',
            snapshot.runtime.buildStatus === 'success' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 text-destructive'
          )}>
            Build {snapshot.runtime.buildStatus}
          </div>
        ) : null}

        <div className="contents" data-focus-secondary="build-toolbar">
        <div className="h-5 w-px shrink-0 bg-border/70" />

        <BuildTooltip
          content="Open reusable workflow recipes for Build, Research, Automation, Files, Connectors, and Troubleshooting."
          side="bottom"
          align="end"
        >
          <Button
            size="icon-sm"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setRecipeCatalogOpen(true)}
            aria-label="Open recipe library"
          >
            <ClipboardList className="h-3.5 w-3.5" />
          </Button>
        </BuildTooltip>
        <BuildTooltip
          content="Scan the workspace and suggest runtime commands, check commands, protected files, and an agent role."
          side="bottom"
          align="end"
        >
          <Button
            size="icon-sm"
            variant="outline"
            className={cn(
              'h-8 w-8',
              shouldShowWorkspaceSetupPrompt ? 'border-primary/60 bg-primary/10 text-primary' : ''
            )}
            onClick={() => void scanWorkspaceSetup()}
            disabled={!activeAgentId || workspaceSetupScanning}
            aria-label="Scan workspace"
          >
            {workspaceSetupScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          </Button>
        </BuildTooltip>
        <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={() => {
              setTerminalSectionHidden(false); setRuntimeLogsSectionHidden(false); setDiffSectionHidden(false);
            }}>Show tools</Button>
            <Popover open={sectionsDropdownOpen} onOpenChange={setSectionsDropdownOpen}>
          <BuildTooltip
            content={hiddenBuildSections.length > 0
              ? `Closed sections: ${hiddenBuildSections.join(', ')}`
              : 'Show or hide collapsible Build Mode sections.'}
            side="bottom"
            align="end"
          >
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  'h-8 gap-1.5 px-2 text-[11px]',
                  hiddenBuildSections.length > 0
                    ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : ''
                )}
              >
                Sections
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
          </BuildTooltip>
          <PopoverContent align="start" className="w-64 p-1.5">
            <div className="space-y-1">
              <div className="border-b border-border/60 pb-1">
                <div className="flex items-center gap-1 rounded-md hover:bg-accent">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleAiBuildOperatorOnly();
                      keepSectionsDropdownOpen();
                    }}
                    title={aiBuildOperatorOnlyActive
                      ? 'Show all Build Mode sections again.'
                      : 'Show only the AI Build Operator and hide every other Build Mode section.'}
                  >
                    <span className="min-w-0 truncate">AI Build Operator Only</span>
                    {aiBuildOperatorOnlyActive ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground',
                      aiBuildOperatorOnlyLocked ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/45'
                    )}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleAiBuildOperatorOnlyLock();
                      keepSectionsDropdownOpen();
                    }}
                    title={aiBuildOperatorOnlyLocked
                      ? 'AI Build Operator Only is locked and will stay that way when you switch modes or restart. Click to stop persisting this.'
                      : 'Keep only the AI Build Operator visible when you switch modes or restart the app.'}
                    aria-label={aiBuildOperatorOnlyLocked
                      ? 'Stop persisting AI Build Operator Only layout'
                      : 'Persist AI Build Operator Only layout'}
                  >
                    <Lock className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {([
                ['workspace', 'Project & Workspace', leftPanelCollapsed],
                ['runtimePreview', 'Runtime Preview', runtimePreviewSectionHidden],
                ['terminal', 'Terminal', terminalSectionHidden],
                ['runtimeLogs', 'Runtime Logs', runtimeLogsSectionHidden],
                ['diff', 'Changes & Git', diffSectionHidden],
              ] as Array<[BuildSectionKey, string, boolean]>).map(([section, label, hidden]) => {
                const locked = Boolean(hiddenSectionLocks[section]);
                return (
                  <div key={section} className="flex items-center gap-1 rounded-md hover:bg-accent">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setBuildSectionHidden(section, !hidden);
                        keepSectionsDropdownOpen();
                      }}
                      title={`Toggle the ${label} section.`}
                    >
                      <span className="min-w-0 truncate">{label}</span>
                      {hidden ? (
                        <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      )}
                    </button>
                    {hidden ? (
                      <button
                        type="button"
                        className={cn(
                          'mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground',
                          locked ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/45'
                        )}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleHiddenSectionLock(section);
                          keepSectionsDropdownOpen();
                        }}
                        title={locked
                          ? `${label} is locked hidden and will stay hidden when you switch modes or restart. Click to stop persisting this.`
                          : `Keep ${label} hidden when you switch modes or restart the app.`}
                        aria-label={locked ? `Stop persisting hidden ${label}` : `Persist hidden ${label}`}
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <Popover open={presetDropdownOpen} onOpenChange={setPresetDropdownOpen}>
          <BuildTooltip
            content="Build presets save workspace-specific commands, environment profiles, and related build settings. If you choose a preset that belongs to another workspace, Build Mode can switch to that workspace path after confirmation."
            side="bottom"
            align="end"
          >
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 max-w-[180px] gap-1.5 px-2 text-[11px]"
              >
                <span className="truncate">{selectedPreset?.name || 'No preset'}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
          </BuildTooltip>
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
        <BuildTooltip
          content={`Auto-restart is ${autoRestart ? 'on' : 'off'}. Automatically restart the project runtime when Build mode changes settings that affect the preview server.`}
          side="bottom"
          align="end"
        >
          <Button
            size="icon-sm"
            variant={autoRestart ? 'secondary' : 'outline'}
            className="h-8 w-8"
            onClick={() => setAutoRestart((current) => !current)}
            aria-pressed={autoRestart}
            aria-label="Toggle auto-restart"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </BuildTooltip>
        <BuildTooltip
          content={`Auto-repair with AI is ${autoRepairEnabled ? 'on' : 'off'}. When runtime or build errors are detected, Build mode can ask the AI to run a follow-up repair task using the error context.`}
          side="bottom"
          align="end"
        >
          <Button
            size="icon-sm"
            variant={autoRepairEnabled ? 'secondary' : 'outline'}
            className="h-8 w-8"
            onClick={() => setAutoRepairEnabled((current) => !current)}
            aria-pressed={autoRepairEnabled}
            aria-label="Toggle auto-repair with AI"
          >
            <Wrench className="h-3.5 w-3.5" />
          </Button>
        </BuildTooltip>
        </div>
        <BuildTooltip content="Start the current project runtime (dev/server process)." side="bottom" align="end">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-0 px-2 2xl:gap-1.5"
            aria-label="Start preview" onClick={() => void runRuntimeAction('start')}
            disabled={busyAction !== null}
          >
            <Play className="h-4 w-4" />
            <span className="hidden 2xl:inline">Start preview</span>
          </Button>
        </BuildTooltip>
        <BuildTooltip content="Stop the currently running project runtime." side="bottom" align="end">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-0 px-2 2xl:gap-1.5"
            aria-label="Stop preview" onClick={() => void runRuntimeAction('stop')}
            disabled={busyAction !== null}
          >
            <Square className="h-4 w-4" />
            <span className="hidden 2xl:inline">Stop</span>
          </Button>
        </BuildTooltip>
        <BuildTooltip content="Restart the project runtime using current settings." side="bottom" align="end">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-0 px-2 2xl:gap-1.5"
            aria-label="Restart preview" onClick={() => void runRuntimeAction('restart')}
            disabled={busyAction !== null}
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden 2xl:inline">Restart</span>
          </Button>
        </BuildTooltip>
        <BuildTooltip content="Run the project's build command once." side="bottom" align="end">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-0 px-2 2xl:gap-1.5"
            aria-label="Build project" onClick={() => void runRuntimeAction('build')}
            disabled={busyAction !== null}
          >
            <Wrench className="h-4 w-4" />
            <span className="hidden 2xl:inline">Build project</span>
          </Button>
        </BuildTooltip>
      </div>
    </TooltipProvider>
  ), [
    activeAgent?.name,
    activeAgentId,
    aiBuildOperatorOnlyActive,
    aiBuildOperatorOnlyLocked,
    autoRepairEnabled,
    autoRestart,
    busyAction,
    diffSectionHidden,
    handleSelectPreset,
    hiddenBuildSections,
    hiddenSectionLocks,
    keepSectionsDropdownOpen,
    leftPanelCollapsed,
    modelBadgeLabel,
    presetDropdownOpen,
    presets,
    runRuntimeAction,
    runtimeLogsSectionHidden,
    runtimePreviewSectionHidden,
    scanWorkspaceSetup,
    sectionsDropdownOpen,
    selectedPreset?.name,
    selectedPresetId,
    setBuildSectionHidden,
    setPresetDropdownOpen,
    setRecipeCatalogOpen,
    setSectionsDropdownOpen,
    shouldShowWorkspaceSetupPrompt,
    snapshot,
    statusBadgeClass,
    terminalSectionHidden,
    toggleAiBuildOperatorOnly,
    toggleAiBuildOperatorOnlyLock,
    toggleHiddenSectionLock,
    workspaceSetupScanning,
  ]);
  useTopBarControls(buildTopBarControls);

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const subagentAgentNames = new Map(agents.map((agent) => [agent.id, agent.name || agent.id]));
  const activeSubagentCount = subagentRuns.filter(isActiveSubagentRun).length;

  return (
    <AgentCharacterProvider agentId={activeAgentId || undefined} taskId={subagentParentTaskId || ''}
      status={aiBusy ? 'running' : journeyTask?.status} messages={aiMessages} runs={subagentRuns}
      onOpenRun={run => void loadSubagentDetail(run)}
      onGuideParent={() => buildPageRef.current?.querySelector<HTMLTextAreaElement>('[aria-label="Build prompt"]')?.focus()}
      onOpenMessage={id => {
        const index = assistantMessages.findIndex(message => message.id === id);
        if (index >= 0) assistantMessagesVirtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
      }}>
    <AnswerActionsProvider taskId={subagentParentTaskId || ''} messages={aiMessages} canDraft={!aiBusy && !autoRepairBusy}
      buildSessionId={activeHistorySessionId}
      incognito={journeyTask?.privacyMode === 'incognito'} mode="build" onDraft={insertTextIntoBuildPrompt}>
    <GuidanceContext.Provider value={guidance}>
    <TooltipProvider delayDuration={250}>
    <div ref={buildPageRef} className="focus-build-scene h-full flex flex-col bg-background"
      style={focusBackground ? focusSceneBackground(focusBackground.src) : undefined}>
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
      <Dialog open={workspaceSetupOpen} onOpenChange={setWorkspaceSetupOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Workspace setup</DialogTitle>
            <DialogDescription>
              Scan the current project and turn detected commands into a reusable Build preset.
            </DialogDescription>
          </DialogHeader>

          {workspaceSetupScanning ? (
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning workspace...
            </div>
          ) : workspaceSetupSuggestions && snapshot ? (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">Project</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{snapshot.detection.projectType}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {snapshot.detection.packageManager} · confidence {Math.round(snapshot.detection.confidence * 100)}%
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">Preset</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{workspaceSetupSuggestions.presetName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{workspaceRelativePath || '.'}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">Last scan</div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {workspaceSetupLastScanAt ? formatTimestamp(workspaceSetupLastScanAt) : 'Current snapshot'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Refresh before applying if files changed.</div>
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                <div className="mb-2 text-xs font-medium text-foreground">Suggested commands</div>
                <div className="grid gap-1.5 text-xs">
                  {[
                    ['Start', workspaceSetupSuggestions.startEntries.map((entry) => entry.command).join(' | ')],
                    ['Run once', workspaceSetupSuggestions.runCommand],
                    ['Typecheck', workspaceSetupSuggestions.typecheckCommand],
                    ['Lint', workspaceSetupSuggestions.lintCommand],
                    ['Test', workspaceSetupSuggestions.testCommand],
                    ['Build', workspaceSetupSuggestions.buildCommand],
                  ].map(([label, command]) => (
                    <div key={label} className="grid grid-cols-[86px_minmax(0,1fr)] gap-2 rounded-md border border-border/50 bg-background/60 px-2 py-1.5">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="min-w-0 truncate font-mono text-[11px] text-foreground" title={command || 'Not detected'}>
                        {command || 'Not detected'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                  <div className="mb-2 text-xs font-medium text-foreground">Protected files</div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {workspaceSetupSuggestions.protectedFiles.length > 0 ? (
                      workspaceSetupSuggestions.protectedFiles.map((filePath) => (
                        <div key={filePath} className="truncate rounded bg-background/70 px-2 py-1 font-mono text-[11px]" title={filePath}>
                          {filePath}
                        </div>
                      ))
                    ) : (
                      <div>No protected files detected in the current tree scan.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                  <div className="mb-2 text-xs font-medium text-foreground">Suggested agent role</div>
                  <div className="text-xs leading-relaxed text-muted-foreground">
                    {workspaceSetupSuggestions.agentRole}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              No workspace snapshot is available yet. Run a scan after the workspace loads.
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => void scanWorkspaceSetup()} disabled={workspaceSetupScanning || !activeAgentId}>
              {workspaceSetupScanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Rescan
            </Button>
            <Button
              variant="outline"
              onClick={insertWorkspaceSetupNotes}
              disabled={!workspaceSetupSuggestions}
            >
              Insert notes
            </Button>
            <Button
              onClick={() => void applyWorkspaceSetupPreset()}
              disabled={!workspaceSetupSuggestions || !activeAgentId}
            >
              Apply preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={recipeCatalogOpen} onOpenChange={setRecipeCatalogOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Recipe library</DialogTitle>
            <DialogDescription>
              Insert bundled recipes and saved prompts from the same category view.
            </DialogDescription>
          </DialogHeader>

          {recipeNotice ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              {recipeNotice}
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/10 p-1">
              {promptLibraryCategories.map((category) => {
                const active = selectedRecipeCategory === category;
                const count = promptLibraryItems.filter((item) => item.category === category).length;
                return (
                  <button
                    key={category}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs',
                      active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                    onClick={() => setSelectedRecipeCategory(category)}
                  >
                    <span>{category}</span>
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px]">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="grid gap-2 lg:grid-cols-2">
                {selectedPromptLibraryItems.map((item) => (
                  <div key={item.id} className="rounded-md border border-border/60 bg-background/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{item.title}</div>
                        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {item.category}
                        </div>
                        <div className={cn(
                          'rounded-full px-2 py-0.5 text-[10px]',
                          item.source === 'saved'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted/70 text-muted-foreground'
                        )}>
                          {item.source === 'saved' ? 'Saved' : 'Recipe'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
                      {item.prompt}
                    </pre>
                    <div className="mt-3 flex justify-end gap-2">
                      {item.source === 'recipe' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => saveRecipeAsPrompt(item)}
                        >
                          <Star className="mr-1.5 h-3.5 w-3.5" />
                          Save prompt
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => insertPromptLibraryItem(item)}
                      >
                        Insert
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <SavedPromptsDialog
        open={savedPromptsOpen}
        onOpenChange={setSavedPromptsOpen}
        onSelectPrompt={selectSavedPrompt}
        mode={savedPromptsMode}
      />
      <Dialog open={gitReviewDialogOpen} onOpenChange={(open) => {
        setGitReviewDialogOpen(open);
        if (!open) setGitReviewDialogFullscreen(false);
      }}>
        <DialogContent
          className={cn(
            'flex flex-col overflow-hidden',
            gitReviewDialogFullscreen
              ? 'h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-none p-4'
              : 'max-h-[92vh] w-[94vw] max-w-6xl'
          )}
        >
          <DialogHeader className="pr-8">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <FileDiff className="h-4 w-4" />
                  Changes & Git Review
                </DialogTitle>
                <DialogDescription>
                  Review changed files, Git status, checks, and sources before committing or pushing.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1 px-2 text-xs"
                onClick={() => setGitReviewDialogFullscreen((current) => !current)}
                title={gitReviewDialogFullscreen ? 'Exit full screen Changes & Git review' : 'Open Changes & Git review full screen'}
              >
                {gitReviewDialogFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {gitReviewDialogFullscreen ? 'Exit full screen' : 'Full screen'}
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {renderBuildGitReviewContent({ inDialog: true, fullscreen: gitReviewDialogFullscreen })}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={gitMismatchDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'resolve-mismatch') setGitMismatchDialogOpen(false);
      }}>
        <DialogContent className="flex max-h-[92vh] w-[94vw] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Resolve Git mismatch</DialogTitle>
            <DialogDescription>
              Review local-only and remote-only commits, then choose how to reconcile the branch.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto pr-1">
            {gitMismatchBusy && !gitMismatchSummary ? (
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching latest Git status...
              </div>
            ) : gitMismatchSummary ? (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-4">
                  {[
                    ['Branch', gitMismatchSummary.branch || 'None'],
                    ['Upstream', gitMismatchSummary.upstream || 'None'],
                    ['Local only', `${gitMismatchSummary.ahead} commit${gitMismatchSummary.ahead === 1 ? '' : 's'}`],
                    ['Remote only', `${gitMismatchSummary.behind} commit${gitMismatchSummary.behind === 1 ? '' : 's'}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-border/50 bg-background/60 p-2">
                      <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
                      <div className="truncate text-sm font-medium text-foreground" title={value}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1 rounded-md border border-border/60 bg-muted/10 p-1">
                  {([
                    ['resolve', 'Resolve conflicts'],
                    ['history', 'Commit graph'],
                    ['recover', 'Recover previous state'],
                  ] as Array<[typeof gitMismatchView, string]>).map(([view, label]) => (
                    <button
                      key={view}
                      type="button"
                      className={cn(
                        'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                        gitMismatchView === view ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      )}
                      onClick={() => setGitMismatchView(view)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {gitMismatchSummary.guidance.length > 0 ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    <div className="font-medium">Guidance</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {gitMismatchSummary.guidance.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {gitMismatchSummary.inProgressOperation !== 'none' ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    A {gitMismatchSummary.inProgressOperation} is in progress. Resolve conflicts in the changed files, then use the continue/abort actions below.
                  </div>
                ) : null}

                {gitMismatchView === 'resolve' && gitMismatchSummary.conflictFiles.length > 0 ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1 text-sm font-medium text-destructive">
                          Resolve conflicts
                          <GitHelpInfo label="Conflict" enabled={showGitHelpTips}>
                            A conflict means local and remote changes edited the same part of a file. Choose one side or edit the file manually, then mark it resolved.
                          </GitHelpInfo>
                        </div>
                        <div className="text-xs text-destructive/80">
                          Choose a side for simple hunks, or open the file and edit the conflict markers manually.
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-[11px]"
                        disabled={gitActionBusy === 'stage-files' || gitSelectedConflictPaths.length === 0}
                        onClick={() => void handleRunBuildGitStageResolved()}
                      >
                        {gitActionBusy === 'stage-files' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                        Mark selected resolved
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {gitMismatchSummary.conflictFiles.map((file) => (
                        <div key={`conflict-${file.relativePath}`} className="rounded-md border border-destructive/30 bg-background/80 p-2">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
                              <input
                                type="checkbox"
                                checked={gitSelectedConflictPaths.includes(file.relativePath)}
                                onChange={() => toggleGitConflictPath(file.relativePath)}
                              />
                              <span className="truncate" title={file.relativePath}>{file.relativePath}</span>
                            </label>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => handleOpenGitConflictFile(file)}>
                                Edit manually
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => void handleRunBuildGitStageResolved([file.relativePath])}>
                                Mark resolved
                              </Button>
                            </div>
                          </div>
                          {file.hunks.length > 0 ? (
                            <div className="space-y-2">
                              {file.hunks.map((hunk) => (
                                <div key={`${file.relativePath}-${hunk.id}`} className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs">
                                  <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">
                                    Lines {hunk.startLine}-{hunk.endLine}
                                  </div>
                                  <div className="grid gap-2 md:grid-cols-2">
                                    <div className="min-w-0">
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="truncate text-[10px] font-medium text-muted-foreground">Local: {hunk.localLabel}</span>
                                        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => void handleApplyGitConflictHunkChoice(file, hunk, 'local')}>
                                          Use local
                                        </Button>
                                      </div>
                                      <pre className="max-h-28 overflow-auto rounded bg-background/80 p-2 text-[10px] leading-relaxed">{hunk.localContent || '(empty)'}</pre>
                                    </div>
                                    <div className="min-w-0">
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="truncate text-[10px] font-medium text-muted-foreground">Remote: {hunk.remoteLabel}</span>
                                        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => void handleApplyGitConflictHunkChoice(file, hunk, 'remote')}>
                                          Use remote
                                        </Button>
                                      </div>
                                      <pre className="max-h-28 overflow-auto rounded bg-background/80 p-2 text-[10px] leading-relaxed">{hunk.remoteContent || '(empty)'}</pre>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-md border border-border/50 bg-muted/20 p-2 text-xs text-muted-foreground">
                              No conflict markers were parsed. Open the file and resolve it manually, then mark it resolved.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {gitMismatchSummary.inProgressOperation === 'merge' ? (
                      <div className="mt-3 rounded-md border border-border/60 bg-background/80 p-2">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-merge-message">
                          Merge commit message
                        </label>
                        <Input
                          id="build-git-merge-message"
                          value={gitMergeCommitMessage}
                          onChange={(event) => setGitMergeCommitMessage(event.target.value)}
                          className="mt-1 h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          className="mt-2 h-8 px-2 text-[11px]"
                          disabled={gitActionBusy === 'finish-merge' || gitMismatchSummary.conflictedCount > 0}
                          onClick={() => void handleRunBuildGitFinishMerge()}
                        >
                          {gitActionBusy === 'finish-merge' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          Finish merge commit
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md border border-border/60 bg-muted/10 p-2">
                    <div className="mb-2 text-xs font-medium text-foreground">Local commits not on remote</div>
                    <div className="max-h-48 space-y-1 overflow-auto">
                      {gitMismatchSummary.localCommits.length > 0 ? gitMismatchSummary.localCommits.map((commit) => (
                        <div key={commit.hash} className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5 text-xs">
                          <div className="truncate font-medium text-foreground" title={commit.subject}>{commit.subject}</div>
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {commit.shortHash}{commit.author ? ` · ${commit.author}` : ''}{commit.date ? ` · ${formatTimestamp(commit.date)}` : ''}
                          </div>
                        </div>
                      )) : (
                        <div className="text-xs text-muted-foreground">No local-only commits.</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/10 p-2">
                    <div className="mb-2 text-xs font-medium text-foreground">Remote commits not local yet</div>
                    <div className="max-h-48 space-y-1 overflow-auto">
                      {gitMismatchSummary.remoteCommits.length > 0 ? gitMismatchSummary.remoteCommits.map((commit) => (
                        <div key={commit.hash} className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5 text-xs">
                          <div className="truncate font-medium text-foreground" title={commit.subject}>{commit.subject}</div>
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {commit.shortHash}{commit.author ? ` · ${commit.author}` : ''}{commit.date ? ` · ${formatTimestamp(commit.date)}` : ''}
                          </div>
                        </div>
                      )) : (
                        <div className="text-xs text-muted-foreground">No remote-only commits.</div>
                      )}
                    </div>
                  </div>
                </div>

                {gitMismatchView === 'history' ? (
                  <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      Compact commit graph
                      <GitHelpInfo label="Merge base" enabled={showGitHelpTips}>
                        The merge base is the last commit shared by both your local branch and the remote branch. Local-only and remote-only commits split after this point.
                      </GitHelpInfo>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[1fr_160px_1fr]">
                      <div className="rounded-md border border-border/50 bg-background/70 p-2">
                        <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Local-only</div>
                        <div className="space-y-1">
                          {gitMismatchSummary.localCommits.slice(0, 6).map((commit) => (
                            <div key={`graph-local-${commit.hash}`} className="rounded bg-muted/40 px-2 py-1 text-xs">
                              <span className="font-mono text-[10px] text-muted-foreground">{commit.shortHash}</span>{' '}
                              <span className="text-foreground">{commit.subject}</span>
                            </div>
                          ))}
                          {gitMismatchSummary.localCommits.length === 0 ? <div className="text-xs text-muted-foreground">No local-only commits.</div> : null}
                        </div>
                      </div>
                      <div className="rounded-md border border-border/50 bg-background/70 p-2 text-center text-xs">
                        <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Shared base</div>
                        <div className="font-mono text-foreground">{gitMismatchSummary.mergeBaseShort || 'Unknown'}</div>
                      </div>
                      <div className="rounded-md border border-border/50 bg-background/70 p-2">
                        <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Remote-only</div>
                        <div className="space-y-1">
                          {gitMismatchSummary.remoteCommits.slice(0, 6).map((commit) => (
                            <div key={`graph-remote-${commit.hash}`} className="rounded bg-muted/40 px-2 py-1 text-xs">
                              <span className="font-mono text-[10px] text-muted-foreground">{commit.shortHash}</span>{' '}
                              <span className="text-foreground">{commit.subject}</span>
                            </div>
                          ))}
                          {gitMismatchSummary.remoteCommits.length === 0 ? <div className="text-xs text-muted-foreground">No remote-only commits.</div> : null}
                        </div>
                      </div>
                    </div>
                    {gitMismatchSummary.reflog.length > 0 ? (
                      <div className="mt-3">
                        <div className="mb-1 text-xs font-medium text-foreground">Recent history</div>
                        <div className="max-h-36 overflow-auto rounded-md border border-border/50 bg-background/70">
                          {gitMismatchSummary.reflog.slice(0, 8).map((entry) => (
                            <div key={`${entry.selector}-${entry.hash}`} className="flex items-center gap-2 border-b border-border/40 px-2 py-1.5 text-xs last:border-b-0">
                              <span className="font-mono text-[10px] text-muted-foreground">{entry.selector || entry.shortHash}</span>
                              <span className="min-w-0 flex-1 truncate text-foreground" title={entry.message}>{entry.message}</span>
                              {entry.date ? <span className="shrink-0 text-[10px] text-muted-foreground">{formatTimestamp(entry.date)}</span> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {gitMismatchView === 'recover' ? (
                  <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      Recover previous state
                      <GitHelpInfo label="Backup branch" enabled={showGitHelpTips}>
                        Backup branches are created by the app before risky mismatch actions. Restoring one resets the current branch to that saved commit and creates another safety backup first.
                      </GitHelpInfo>
                    </div>
                    {gitMismatchSummary.backupBranches.length > 0 ? (
                      <div className="space-y-1">
                        {gitMismatchSummary.backupBranches.map((branch) => (
                          <div key={branch.name} className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-background/70 p-2 text-xs">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground" title={branch.name}>{branch.name}</div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {branch.shortCommit || 'commit'}{branch.subject ? ` · ${branch.subject}` : ''}{branch.createdAt ? ` · ${formatTimestamp(branch.createdAt)}` : ''}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 px-2 text-[10px]"
                              disabled={gitActionBusy === 'restore-backup' || Boolean(gitMismatchSummary.hasLocalChanges) || gitMismatchSummary.conflictedCount > 0}
                              onClick={() => void handleRunBuildGitRestoreBackup(branch.name)}
                            >
                              {gitActionBusy === 'restore-backup' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                              Restore
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-border/50 bg-background/70 p-2 text-xs text-muted-foreground">
                        No app-created backup branches found for this repository.
                      </div>
                    )}
                    <div className="mt-3 rounded-md border border-border/50 bg-background/70 p-2">
                      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground">
                        Advanced reflog
                        <GitHelpInfo label="Reflog" enabled={showGitHelpTips}>
                          Reflog is Git's local record of recent branch movements. It can help recover work, but restoring from it is advanced and not automated here.
                        </GitHelpInfo>
                      </div>
                      <div className="max-h-36 overflow-auto">
                        {gitMismatchSummary.reflog.slice(0, 10).map((entry) => (
                          <div key={`recover-${entry.selector}-${entry.hash}`} className="border-b border-border/40 py-1 text-xs last:border-b-0">
                            <div className="truncate text-foreground" title={entry.message}>{entry.message}</div>
                            <div className="text-[10px] text-muted-foreground">{entry.selector || entry.shortHash} · {entry.shortHash}{entry.date ? ` · ${formatTimestamp(entry.date)}` : ''}</div>
                          </div>
                        ))}
                        {gitMismatchSummary.reflog.length === 0 ? <div className="text-xs text-muted-foreground">No reflog entries available.</div> : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {gitMismatchView === 'resolve' ? (
                <div className="rounded-md border border-border/60 bg-muted/10 p-2">
                  <div className="mb-2 text-xs font-medium text-foreground">Choose action</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {([
                      'backup',
                      'merge',
                      'rebase',
                      'reset-to-remote',
                      'force-push',
                      'continue-rebase',
                      'abort-rebase',
                      'abort-merge',
                    ] as BuildGitResolveMismatchAction[]).map((action) => {
                      const available = isBuildGitMismatchActionAvailable(gitMismatchSummary, action);
                      const danger = action === 'reset-to-remote' || action === 'force-push' || action.startsWith('abort');
                      return (
                        <button
                          key={action}
                          type="button"
                          disabled={!available}
                          className={cn(
                            'rounded-md border p-2 text-left text-xs transition-colors',
                            gitMismatchAction === action
                              ? danger
                                ? 'border-destructive/60 bg-destructive/10 text-destructive'
                                : 'border-primary/60 bg-primary/10 text-primary'
                              : 'border-border bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                            !available ? 'cursor-not-allowed opacity-45 hover:bg-background/60 hover:text-muted-foreground' : ''
                          )}
                          onClick={() => {
                            if (available) setGitMismatchAction(action);
                          }}
                        >
                          <div className="flex items-center gap-1 font-medium">
                            {getBuildGitMismatchActionLabel(action)}
                            {action === 'rebase' ? (
                              <GitHelpInfo label="Rebase" enabled={showGitHelpTips}>
                                Rebase replays your local commits on top of the remote branch. It can make history cleaner, but conflicts must be resolved before it can finish.
                              </GitHelpInfo>
                            ) : null}
                            {action === 'force-push' ? (
                              <GitHelpInfo label="Force push with lease" enabled={showGitHelpTips}>
                                Force push updates the remote branch to match local history. With lease means Git refuses if the remote changed since your last fetch.
                              </GitHelpInfo>
                            ) : null}
                          </div>
                          <div className="mt-1 leading-relaxed">{getBuildGitMismatchActionDescription(action)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                ) : null}

                {gitMismatchView === 'resolve' && (gitMismatchAction === 'backup'
                  || gitMismatchAction === 'merge'
                  || gitMismatchAction === 'rebase'
                  || gitMismatchAction === 'reset-to-remote'
                  || gitMismatchAction === 'force-push') ? (
                  <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                    {gitMismatchAction !== 'reset-to-remote' && gitMismatchAction !== 'backup' ? (
                      <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={gitMismatchCreateBackup}
                          onChange={(event) => setGitMismatchCreateBackup(event.target.checked)}
                          className="h-4 w-4"
                        />
                        Create a backup branch before running this action
                      </label>
                    ) : null}
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-mismatch-backup">
                      Backup branch name
                    </label>
                    <Input
                      id="build-git-mismatch-backup"
                      value={gitMismatchBackupBranchName}
                      onChange={(event) => setGitMismatchBackupBranchName(event.target.value)}
                      className="mt-1 h-9 text-sm"
                      placeholder={gitMismatchSummary.backupBranchName || 'backup/current-branch'}
                    />
                    {gitMismatchAction === 'reset-to-remote' ? (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        Reset always creates a backup branch first so local commits are still recoverable.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                No mismatch summary is available yet.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitMismatchBusy || gitActionBusy === 'resolve-mismatch'} onClick={() => void refreshGitMismatchSummary({ fetchFirst: true })}>
              {gitMismatchBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" disabled={gitActionBusy === 'resolve-mismatch'} onClick={() => setGitMismatchDialogOpen(false)}>
              Close
            </Button>
            <Button
              variant={gitMismatchAction === 'reset-to-remote' || gitMismatchAction === 'force-push' || gitMismatchAction.startsWith('abort') ? 'destructive' : 'default'}
              disabled={
                gitActionBusy === 'resolve-mismatch'
                || gitMismatchBusy
                || !isBuildGitMismatchActionAvailable(gitMismatchSummary, gitMismatchAction)
                || (
                  (gitMismatchAction === 'backup'
                    || gitMismatchAction === 'reset-to-remote'
                    || ((gitMismatchAction === 'merge' || gitMismatchAction === 'rebase' || gitMismatchAction === 'force-push') && gitMismatchCreateBackup))
                  && !gitMismatchBackupBranchName.trim()
                )
              }
              onClick={() => void handleRunBuildGitResolveMismatch()}
            >
              {gitActionBusy === 'resolve-mismatch' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {getBuildGitMismatchActionLabel(gitMismatchAction)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitInitDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'init') setGitInitDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Initialize Git repository?</DialogTitle>
            <DialogDescription>
              This creates a local Git repository in the selected Build workspace. It does not commit, push, or publish anything.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            Workspace: <span className="font-medium text-foreground">{workspaceRelativePath || '.'}</span>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'init'} onClick={() => setGitInitDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={gitActionBusy === 'init'} onClick={() => void handleRunBuildGitInit()}>
              {gitActionBusy === 'init' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
              Initialize Git
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitCommitDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'commit') setGitCommitDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-xl">
          <DialogHeader>
            <DialogTitle>Commit workspace changes?</DialogTitle>
            <DialogDescription>
              This stages and commits the changed files in the selected Build workspace only. It does not push to a remote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              <div className="font-medium text-foreground">
                {effectiveChangedFileCount} changed file{effectiveChangedFileCount === 1 ? '' : 's'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                <span className="text-emerald-500">+{effectiveAddedLines}</span>
                <span> </span>
                <span className="text-red-500">-{effectiveDeletedLines}</span>
                {gitSummary?.untrackedCount ? ` · ${gitSummary.untrackedCount} untracked` : ''}
              </div>
            </div>
            {gitSummary?.isRepository && !gitSummary.remoteName ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                This will create a local commit only. No GitHub repository or other remote is configured, so nothing will be uploaded.
              </div>
            ) : gitSummary?.isRepository && gitSummary.remoteName && !gitSummary.upstream ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                This branch has no upstream branch. The commit will stay local until an upstream is configured and pushed.
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-commit-message">
                Commit message
              </label>
              <Textarea
                id="build-git-commit-message"
                value={gitCommitMessage}
                onChange={(event) => setGitCommitMessage(event.target.value)}
                placeholder={defaultCommitMessage}
                className="min-h-[88px] text-sm"
              />
            </div>
            {gitSummary?.remoteName && gitSummary.upstream ? (
              <label className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={gitCommitPushAfter}
                  onChange={(event) => setGitCommitPushAfter(event.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Push after commit succeeds
                  <span className="mt-0.5 block text-[11px]">
                    This still runs as two steps. If the commit succeeds but push fails, your local commit remains safe.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'commit'} onClick={() => setGitCommitDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={gitActionBusy === 'commit' || !gitCommitMessage.trim()} onClick={() => void handleRunBuildGitCommit()}>
              {gitActionBusy === 'commit' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              {gitCommitPushAfter ? 'Commit and push' : 'Commit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitRemoteDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'add-remote') setGitRemoteDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-xl">
          <DialogHeader>
            <DialogTitle>Add remote repository</DialogTitle>
            <DialogDescription>
              Link this local Git repository to an existing remote repository. This does not create the remote repository for you.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Remote provider</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ['github', 'GitHub'],
                  ['gitlab', 'GitLab'],
                  ['bitbucket', 'Bitbucket'],
                  ['custom', 'Custom'],
                ] as Array<[BuildGitRemoteProvider, string]>).map(([provider, label]) => (
                  <button
                    key={provider}
                    type="button"
                    className={cn(
                      'rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                      gitRemoteProvider === provider
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border bg-muted/10 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    )}
                    onClick={() => setGitRemoteProvider(provider)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-remote-name">
                  Remote name
                </label>
                <Input
                  id="build-git-remote-name"
                  value={gitRemoteName}
                  onChange={(event) => setGitRemoteName(event.target.value)}
                  placeholder="origin"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-remote-url">
                  Remote URL
                </label>
                <Input
                  id="build-git-remote-url"
                  value={gitRemoteUrl}
                  onChange={(event) => setGitRemoteUrl(event.target.value)}
                  placeholder={getBuildGitRemoteUrlPlaceholder(gitRemoteProvider)}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              Create the repository on {gitRemoteProvider === 'custom' ? 'your Git host' : gitRemoteProvider} first, then paste its clone URL here. After adding the remote, use Push to publish the current branch.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'add-remote'} onClick={() => setGitRemoteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={gitActionBusy === 'add-remote' || !gitRemoteName.trim() || !gitRemoteUrl.trim()}
              onClick={() => void handleRunBuildGitAddRemote()}
            >
              {gitActionBusy === 'add-remote' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
              Add remote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitRemoteCreateDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'add-remote') setGitRemoteCreateDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-xl">
          <DialogHeader>
            <DialogTitle>Create remote repository</DialogTitle>
            <DialogDescription>
              GitHub repositories can be created automatically when GitHub CLI is installed and signed in. Other providers show guided manual steps.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ['github', 'GitHub'],
                ['gitlab', 'GitLab'],
                ['bitbucket', 'Bitbucket'],
                ['custom', 'Other'],
              ] as Array<[BuildGitRemoteProvider, string]>).map(([provider, label]) => (
                <button
                  key={`create-remote-provider-${provider}`}
                  type="button"
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                    gitRemoteCreateProvider === provider
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border bg-muted/10 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  )}
                  onClick={() => setGitRemoteCreateProvider(provider)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-create-remote-name">
                  Repository name
                </label>
                <Input
                  id="build-git-create-remote-name"
                  value={gitRemoteCreateName}
                  onChange={(event) => setGitRemoteCreateName(event.target.value)}
                  placeholder="owner/repository or repository"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-create-remote-visibility">
                  Visibility
                </label>
                <select
                  id="build-git-create-remote-visibility"
                  value={gitRemoteCreateVisibility}
                  onChange={(event) => setGitRemoteCreateVisibility(event.target.value === 'public' ? 'public' : 'private')}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </div>
            </div>
            {gitRemoteCreateProvider === 'github' && (!gitSummary?.githubCli.available || !gitSummary.githubCli.authenticated) ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                GitHub CLI is not ready. The app will show setup steps instead of creating the repository automatically.
              </div>
            ) : null}
            {gitRemoteCreateSteps.length > 0 ? (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">Manual steps</div>
                <ol className="list-decimal space-y-1 pl-4">
                  {gitRemoteCreateSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'add-remote'} onClick={() => setGitRemoteCreateDialogOpen(false)}>
              Close
            </Button>
            <Button disabled={gitActionBusy === 'add-remote' || !gitRemoteCreateName.trim()} onClick={() => void handleRunBuildGitCreateRemoteRepository()}>
              {gitActionBusy === 'add-remote' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Github className="mr-1.5 h-4 w-4" />}
              {gitRemoteCreateProvider === 'github' ? 'Create remote' : 'Show steps'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitPrDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'push') setGitPrDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-xl">
          <DialogHeader>
            <DialogTitle>Create pull request</DialogTitle>
            <DialogDescription>
              Creates a draft pull request for GitHub when GitHub CLI is signed in. GitLab and Bitbucket show manual guidance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-pr-title">
                Pull request title
              </label>
              <Input
                id="build-git-pr-title"
                value={gitPrTitle}
                onChange={(event) => setGitPrTitle(event.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-pr-body">
                Description
              </label>
              <Textarea
                id="build-git-pr-body"
                value={gitPrBody}
                onChange={(event) => setGitPrBody(event.target.value)}
                placeholder="Describe what changed and why."
                className="min-h-[120px] text-sm"
              />
            </div>
            {gitPrSteps.length > 0 ? (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">Manual steps</div>
                <ol className="list-decimal space-y-1 pl-4">
                  {gitPrSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'push'} onClick={() => setGitPrDialogOpen(false)}>
              Close
            </Button>
            <Button disabled={gitActionBusy === 'push' || !gitPrTitle.trim()} onClick={() => void handleRunBuildGitCreatePr()}>
              {gitActionBusy === 'push' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Github className="mr-1.5 h-4 w-4" />}
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitRemoteEditDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'update-remote') setGitRemoteEditDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit remote URL</DialogTitle>
            <DialogDescription>
              Update where this local repository pushes and fetches from. This does not create or delete a remote repository.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-edit-remote-name">
                  Remote name
                </label>
                <Input
                  id="build-git-edit-remote-name"
                  value={gitRemoteEditName}
                  readOnly
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-edit-remote-url">
                  Remote URL
                </label>
                <Input
                  id="build-git-edit-remote-url"
                  value={gitRemoteEditUrl}
                  onChange={(event) => setGitRemoteEditUrl(event.target.value)}
                  placeholder={getBuildGitRemoteUrlPlaceholder(gitSummary?.remoteProvider || 'custom')}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              Only change this if the repository was renamed, moved, or the current URL is wrong. Existing local commits and files are not changed.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'update-remote'} onClick={() => setGitRemoteEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={gitActionBusy === 'update-remote' || !gitRemoteEditName.trim() || !gitRemoteEditUrl.trim()}
              onClick={() => void handleRunBuildGitUpdateRemote()}
            >
              {gitActionBusy === 'update-remote' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
              Save remote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitPullDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'pull') setGitPullDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Pull remote changes?</DialogTitle>
            <DialogDescription>
              This updates the current branch only if Git can fast-forward without creating a merge commit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            <div>
              Branch: <span className="font-medium text-foreground">{gitSummary?.branch || 'Unknown'}</span>
            </div>
            <div>
              Upstream: <span className="font-medium text-foreground">{gitSummary?.upstream || 'None'}</span>
            </div>
            <div>
              Remote commits waiting: <span className="font-medium text-foreground">{gitSummary?.behind || 0}</span>
            </div>
          </div>
          {gitSummary?.hasChanges || gitSummary?.conflictedCount ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              Commit or discard local changes before pulling. This keeps remote updates from overwriting local work.
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              If the branch has diverged, this action will stop and explain the mismatch instead of auto-merging.
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'pull'} onClick={() => setGitPullDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={gitActionBusy === 'pull' || !gitSummary?.upstream || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)}
              onClick={() => void handleRunBuildGitPull()}
            >
              {gitActionBusy === 'pull' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Pull
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitBranchDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'switch-branch' && gitActionBusy !== 'create-branch') setGitBranchDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-xl">
          <DialogHeader>
            <DialogTitle>Branches</DialogTitle>
            <DialogDescription>
              Switch to an existing local branch or create a new branch from the current commit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(['switch', 'create'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                    gitBranchMode === mode
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border bg-muted/10 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  )}
                  onClick={() => {
                    setGitBranchMode(mode);
                    setGitBranchName(mode === 'switch' ? (gitSummary?.branch || '') : '');
                  }}
                >
                  {mode === 'switch' ? 'Switch branch' : 'Create branch'}
                </button>
              ))}
            </div>
            {gitSummary?.hasChanges || gitSummary?.conflictedCount ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                Commit or discard local changes before changing branches. This prevents uncommitted work from being carried into the wrong branch.
              </div>
            ) : null}
            {gitBranchMode === 'switch' && gitSummary?.branches.length ? (
              <div className="max-h-36 overflow-auto rounded-md border border-border/60 bg-muted/10 p-1">
                {gitSummary.branches.filter((branch) => !branch.remote).map((branch) => (
                  <button
                    key={branch.name}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs',
                      gitBranchName === branch.name ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                    onClick={() => setGitBranchName(branch.name)}
                  >
                    <span className="truncate">{branch.name}</span>
                    {branch.current ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">current</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {gitBranchMode === 'switch' && gitSummary?.branches.some((branch) => branch.remote) ? (
              <div className="rounded-md border border-border/60 bg-muted/10 p-2">
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
                  Remote branches
                  <GitHelpInfo label="Remote branch" enabled={showGitHelpTips}>
                    A remote branch exists on GitHub, GitLab, Bitbucket, or another Git host. Creating a local branch from it lets you work on that branch on this computer.
                  </GitHelpInfo>
                </div>
                <div className="max-h-32 space-y-1 overflow-auto">
                  {gitSummary.branches.filter((branch) => branch.remote).map((branch) => (
                    <div key={`remote-branch-${branch.name}`} className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-background/70 px-2 py-1.5 text-xs">
                      <span className="min-w-0 truncate text-muted-foreground" title={branch.name}>{branch.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 shrink-0 px-1.5 text-[10px]"
                        disabled={gitActionBusy === 'checkout-remote' || Boolean(gitSummary?.hasChanges) || Boolean(gitSummary?.conflictedCount)}
                        onClick={() => void handleRunBuildGitCheckoutRemoteBranch(branch.name)}
                      >
                        {gitActionBusy === 'checkout-remote' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                        Create local
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-branch-name">
                {gitBranchMode === 'switch' ? 'Branch to switch to' : 'New branch name'}
              </label>
              <Input
                id="build-git-branch-name"
                value={gitBranchName}
                onChange={(event) => setGitBranchName(event.target.value)}
                placeholder={gitBranchMode === 'switch' ? 'main' : 'feature/my-change'}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'switch-branch' || gitActionBusy === 'create-branch'} onClick={() => setGitBranchDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                gitActionBusy === 'switch-branch'
                || gitActionBusy === 'create-branch'
                || !gitBranchName.trim()
                || Boolean(gitSummary?.hasChanges)
                || Boolean(gitSummary?.conflictedCount)
              }
              onClick={() => void handleRunBuildGitBranchAction()}
            >
              {gitActionBusy === 'switch-branch' || gitActionBusy === 'create-branch' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
              {gitBranchMode === 'switch' ? 'Switch' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitDiscardDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'discard') setGitDiscardDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Discard file changes?</DialogTitle>
            <DialogDescription>
              This reverts the selected file to the last committed version. If it is untracked, Git removes the file.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            File: <span className="break-all font-medium text-foreground">{gitDiscardPath}</span>
          </div>
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            This cannot be undone from inside the app unless the file exists elsewhere. Commit anything you want to keep before discarding.
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'discard'} onClick={() => setGitDiscardDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={gitActionBusy === 'discard' || !gitDiscardPath}
              onClick={() => void handleRunBuildGitDiscard()}
            >
              {gitActionBusy === 'discard' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={gitPushDialogOpen} onOpenChange={(open) => {
        if (!open && gitActionBusy !== 'push') setGitPushDialogOpen(false);
      }}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Push branch?</DialogTitle>
            <DialogDescription>
              This pushes the current branch to its configured upstream remote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            <div>
              Branch: <span className="font-medium text-foreground">{gitSummary?.branch || 'Unknown'}</span>
            </div>
            <div>
              Upstream: <span className="font-medium text-foreground">{gitSummary?.upstream || 'None'}</span>
            </div>
            <div>
              Local commits: <span className="font-medium text-foreground">{gitSummary?.ahead || 0}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="build-git-push-branch">
              Branch to push
            </label>
            <Input
              id="build-git-push-branch"
              value={gitPushBranchName}
              onChange={(event) => setGitPushBranchName(event.target.value)}
              placeholder={gitSummary?.branch || 'main'}
              className="h-9 text-sm"
            />
            <div className="text-[11px] text-muted-foreground">
              For the first push, the app will set this as the upstream branch on the selected remote.
            </div>
          </div>
          {gitSummary?.authStatus === 'missing' || gitSummary?.authStatus === 'unknown' || gitSummary?.authStatus === 'failed' ? (
            <div className={cn(
              'rounded-md border p-3 text-xs',
              gitSummary.authStatus === 'failed'
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            )}>
              <div className="font-medium">{formatBuildGitAuthStatus(gitSummary)}</div>
              <div className="mt-1 leading-relaxed">{gitSummary.authDetail}</div>
              {gitSummary.authSetupHints.length > 0 ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4">
                  {gitSummary.authSetupHints.slice(0, 3).map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={gitActionBusy === 'push'} onClick={() => setGitPushDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={gitActionBusy === 'push' || !gitSummary?.remoteName || !gitPushBranchName.trim()} onClick={() => void handleRunBuildGitPush()}>
              {gitActionBusy === 'push' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1.5 h-4 w-4" />}
              Push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Legacy Build header moved to the global usage bar.
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-4 py-3">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ModeSwitch />
            <BuildTooltip
              content={`Active Build agent: ${activeAgent?.name || activeAgentId || 'None'}. Build tasks use this agent's model, persona prompt, workspace defaults, permissions, memory, and task history.`}
              side="bottom"
              align="start"
            >
              <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                <Wrench className="h-3.5 w-3.5" />
                Agent: {activeAgent?.name || activeAgentId}
              </div>
            </BuildTooltip>
            {modelBadgeLabel ? (
              <BuildTooltip
                content={modelBadgeLabel}
                side="bottom"
                align="start"
              >
                <div className="inline-flex max-w-[320px] items-center gap-1.5 truncate rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  <Code className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Model</span>
                </div>
              </BuildTooltip>
            ) : null}
            <BuildTooltip
              content={selectedPreset
                ? `Current Build preset: ${selectedPreset.name}. Presets store workspace, runtime, preview, linked project, and check settings for this Build setup.`
                : 'No Build preset is selected. Presets store workspace, runtime, preview, linked project, and check settings for a Build setup.'}
              side="bottom"
              align="start"
            >
              <div className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                Preset: {selectedPreset?.name || 'None'}
              </div>
            </BuildTooltip>
            <BuildTooltip
              content={`Current Build runtime status: ${formatRuntimeStatus(snapshot?.runtime.status ?? 'stopped')}. This shows whether the project preview/dev server is stopped, starting, running, stopping, or in an error state.`}
              side="bottom"
              align="start"
            >
              <div className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', statusBadgeClass)}>
                {snapshot?.runtime.status === 'running' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                {formatRuntimeStatus(snapshot?.runtime.status ?? 'stopped')}
              </div>
            </BuildTooltip>
            {snapshot?.runtime.port ? (
              <BuildTooltip
                content={`The Build runtime preview server is using local port ${snapshot.runtime.port}, usually available at http://localhost:${snapshot.runtime.port}.`}
                side="bottom"
                align="start"
              >
                <div className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  Port {snapshot.runtime.port}
                </div>
              </BuildTooltip>
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
            <BuildTooltip
              content="Open reusable workflow recipes for Build, Research, Automation, Files, Connectors, and Troubleshooting."
              side="bottom"
              align="end"
            >
              <Button
                size="icon-sm"
                variant="outline"
                className="h-8 w-8"
                onClick={() => setRecipeCatalogOpen(true)}
                aria-label="Open recipe library"
              >
                <ClipboardList className="h-3.5 w-3.5" />
              </Button>
            </BuildTooltip>
            <BuildTooltip
              content="Scan the workspace and suggest runtime commands, check commands, protected files, and an agent role."
              side="bottom"
              align="end"
            >
              <Button
                size="icon-sm"
                variant="outline"
                className={cn(
                  'h-8 w-8',
                  shouldShowWorkspaceSetupPrompt ? 'border-primary/60 bg-primary/10 text-primary' : ''
                )}
                onClick={() => void scanWorkspaceSetup()}
                disabled={!activeAgentId || workspaceSetupScanning}
                aria-label="Scan workspace"
              >
                {workspaceSetupScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              </Button>
            </BuildTooltip>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={() => {
              setTerminalSectionHidden(false); setRuntimeLogsSectionHidden(false); setDiffSectionHidden(false);
            }}>Show tools</Button>
            <Popover open={sectionsDropdownOpen} onOpenChange={setSectionsDropdownOpen}>
              <BuildTooltip
                content={hiddenBuildSections.length > 0
                  ? `Closed sections: ${hiddenBuildSections.join(', ')}`
                  : 'Show or hide collapsible Build Mode sections.'}
                side="bottom"
                align="end"
              >
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      'h-8 gap-1.5 px-2 text-[11px]',
                      hiddenBuildSections.length > 0
                        ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : ''
                    )}
                  >
                    Sections
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
              </BuildTooltip>
              <PopoverContent align="start" className="w-64 p-1.5">
                <div className="space-y-1">
                  <div className="border-b border-border/60 pb-1">
                    <div className="flex items-center gap-1 rounded-md hover:bg-accent">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleAiBuildOperatorOnly();
                          keepSectionsDropdownOpen();
                        }}
                        title={aiBuildOperatorOnlyActive
                          ? 'Show all Build Mode sections again.'
                          : 'Show only the AI Build Operator and hide every other Build Mode section.'}
                      >
                        <span className="min-w-0 truncate">AI Build Operator Only</span>
                        {aiBuildOperatorOnlyActive ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground',
                          aiBuildOperatorOnlyLocked ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/45'
                        )}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleAiBuildOperatorOnlyLock();
                          keepSectionsDropdownOpen();
                        }}
                        title={aiBuildOperatorOnlyLocked
                          ? 'AI Build Operator Only is locked and will stay that way when you switch modes or restart. Click to stop persisting this.'
                          : 'Keep only the AI Build Operator visible when you switch modes or restart the app.'}
                        aria-label={aiBuildOperatorOnlyLocked
                          ? 'Stop persisting AI Build Operator Only layout'
                          : 'Persist AI Build Operator Only layout'}
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {([
                    ['workspace', 'Project & Workspace', leftPanelCollapsed],
                    ['runtimePreview', 'Runtime Preview', runtimePreviewSectionHidden],
                    ['terminal', 'Terminal', terminalSectionHidden],
                    ['runtimeLogs', 'Runtime Logs', runtimeLogsSectionHidden],
                    ['diff', 'Changes & Git', diffSectionHidden],
                  ] as Array<[BuildSectionKey, string, boolean]>).map(([section, label, hidden]) => {
                    const locked = Boolean(hiddenSectionLocks[section]);
                    return (
                      <div key={section} className="flex items-center gap-1 rounded-md hover:bg-accent">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setBuildSectionHidden(section, !hidden);
                            keepSectionsDropdownOpen();
                          }}
                          title={`Toggle the ${label} section.`}
                        >
                          <span className="min-w-0 truncate">{label}</span>
                          {hidden ? (
                            <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          )}
                        </button>
                        {hidden ? (
                          <button
                            type="button"
                            className={cn(
                              'mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground',
                              locked ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/45'
                            )}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleHiddenSectionLock(section);
                              keepSectionsDropdownOpen();
                            }}
                            title={locked
                              ? `${label} is locked hidden and will stay hidden when you switch modes or restart. Click to stop persisting this.`
                              : `Keep ${label} hidden when you switch modes or restart the app.`}
                            aria-label={locked ? `Stop persisting hidden ${label}` : `Persist hidden ${label}`}
                          >
                            <Lock className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={presetDropdownOpen} onOpenChange={setPresetDropdownOpen}>
              <BuildTooltip
                content="Build presets save workspace-specific commands, environment profiles, and related build settings. If you choose a preset that belongs to another workspace, Build Mode can switch to that workspace path after confirmation."
                side="bottom"
                align="end"
              >
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 max-w-[220px] gap-1.5 px-2 text-[11px]"
                  >
                    <span className="truncate">{selectedPreset?.name || 'No preset'}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
              </BuildTooltip>
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
            <BuildTooltip
              content="Automatically restart the project runtime when Build mode changes settings that affect the preview server."
              side="bottom"
              align="end"
            >
              <label className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoRestart}
                  onChange={(event) => setAutoRestart(event.target.checked)}
                />
                Auto-restart
              </label>
            </BuildTooltip>
            <BuildTooltip
              content="When runtime or build errors are detected, Build mode can ask the AI to run a follow-up repair task using the error context."
              side="bottom"
              align="end"
            >
              <label className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoRepairEnabled}
                  onChange={(event) => setAutoRepairEnabled(event.target.checked)}
                />
                Auto-repair with AI
              </label>
            </BuildTooltip>
            <BuildTooltip content="Start the current project runtime (dev/server process)." side="bottom" align="end">
              <Button
                size="sm"
                variant="outline"
                aria-label="Start preview" onClick={() => void runRuntimeAction('start')}
                disabled={busyAction !== null}
              >
                <Play className="h-4 w-4 mr-1.5" />
                Start preview
              </Button>
            </BuildTooltip>
            <BuildTooltip content="Stop the currently running project runtime." side="bottom" align="end">
              <Button
                size="sm"
                variant="outline"
                aria-label="Stop preview" onClick={() => void runRuntimeAction('stop')}
                disabled={busyAction !== null}
              >
                <Square className="h-4 w-4 mr-1.5" />
                Stop
              </Button>
            </BuildTooltip>
            <BuildTooltip content="Restart the project runtime using current settings." side="bottom" align="end">
              <Button
                size="sm"
                variant="outline"
                aria-label="Restart preview" onClick={() => void runRuntimeAction('restart')}
                disabled={busyAction !== null}
              >
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Restart
              </Button>
            </BuildTooltip>
            <BuildTooltip content="Run the project's build command once." side="bottom" align="end">
              <Button
                size="sm"
                variant="outline"
                aria-label="Build project" onClick={() => void runRuntimeAction('build')}
                disabled={busyAction !== null}
              >
                <Wrench className="h-4 w-4 mr-1.5" />
                Build project
              </Button>
            </BuildTooltip>
          </div>
        </div>
      </div>

      */}

      <div className="flex-1 min-h-0 px-3 py-3">
        <div className="flex h-full w-full flex-col gap-3">
          {error ? (
            <Card className="p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </Card>
          ) : null}
          <div
            className="focus-build-grid grid min-h-0 flex-1 grid-cols-1 gap-3"
            data-focus-has-preview={!runtimePreviewSectionHidden}
            style={{ gridTemplateColumns: buildMainGridTemplate }}
          >
            {!leftPanelCollapsed ? (
            <Card data-focus-secondary="workspace" ref={workspacePanelCardRef} className="relative min-h-0 flex flex-col p-3 gap-1">
              <div
                className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize"
                onMouseDown={handleWorkspacePanelResizeStart}
                title="Drag to resize Project & Workspace."
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Project & Workspace"
              />
              <div className="mb-2 rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
                Build has its own working folder. Chat can use a different folder.
                <button type="button" className="mt-1 block font-medium text-primary underline underline-offset-2" disabled={!snapshot?.workspaceRoot} onClick={() => navigate('/', { state: { buildWorkspace: snapshot?.workspaceRoot } })}>Use this folder in Chat</button>
              </div>
              <div className="flex items-start justify-between">
                <div className="text-sm font-medium">Project & Workspace</div>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  title="Hide Project & Workspace section."
                  onClick={() => setLeftPanelCollapsed(true)}
                >
                  <PanelBottomClose className="h-4 w-4" />
                </Button>
              </div>
              <div>
                <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span>Build workspace</span>
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
                      Build uses a dedicated workspace root, separate from the folder selected in Chat. Select a folder inside this root. All project commands and Build agent changes use the selected Build folder.
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
              {shouldShowWorkspaceSetupPrompt ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-2 text-xs">
                  <div className="flex items-start gap-2">
                    <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">Workspace setup available</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        Scan this project to create a reusable preset with runtime and check commands.
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 px-2 text-[11px]"
                        onClick={() => void scanWorkspaceSetup()}
                        disabled={workspaceSetupScanning}
                      >
                        {workspaceSetupScanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                        Scan workspace
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
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
              <details className="mt-2 rounded-lg border border-border bg-background"><summary className="cursor-pointer px-3 py-2 text-sm font-medium">Project settings &amp; presets</summary><div className="mt-1 space-y-2 rounded-md border border-border/60 px-2 pt-2 pb-1 max-h-[320px] overflow-y-auto">
                <div className="text-xs font-semibold text-muted-foreground">Project Preset</div>
                <BuildPresetInputWithHelp
                  value={presetNameInput}
                  onChange={(event) => setPresetNameInput(event.target.value)}
                  placeholder="Preset name"
                  className="h-8 text-xs"
                  helpTitle="Preset name"
                  helpDescription="Give this preset a short label so you can reuse this command and environment setup later."
                />
                <BuildPresetFieldHelp
                  helpTitle="Budget project"
                  helpDescription="Optional usage budget inherited by new Build sessions and AI runs that use this project preset."
                  optional
                >
                  <select
                    value={presetUsageProjectIdInput || ''}
                  onChange={(event) => {
                    const next = event.target.value || null;
                    setPresetUsageProjectIdInput(next);
                    setPresetUsageProjectDirty(true);
                    setSelectedUsageProject('build', next);
                  }}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">No budget project</option>
                    {usageProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </BuildPresetFieldHelp>
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
                <div className="grid gap-2 md:grid-cols-3">
                  <BuildPresetInputWithHelp
                    value={presetTypecheckCommandInput}
                    onChange={(event) => setPresetTypecheckCommandInput(event.target.value)}
                    placeholder="Typecheck command"
                    className="h-8 text-xs font-mono"
                    helpTitle="Typecheck command override"
                    helpDescription="Optional command used by Build review checks instead of the inferred typecheck script. Example: pnpm typecheck."
                    optional
                  />
                  <BuildPresetInputWithHelp
                    value={presetLintCommandInput}
                    onChange={(event) => setPresetLintCommandInput(event.target.value)}
                    placeholder="Lint command"
                    className="h-8 text-xs font-mono"
                    helpTitle="Lint command override"
                    helpDescription="Optional command used by Build review checks instead of the inferred lint script. Example: pnpm lint."
                    optional
                  />
                  <BuildPresetInputWithHelp
                    value={presetTestCommandInput}
                    onChange={(event) => setPresetTestCommandInput(event.target.value)}
                    placeholder="Test command"
                    className="h-8 text-xs font-mono"
                    helpTitle="Test command override"
                    helpDescription="Optional command used by Build review checks instead of the inferred test script. Example: pnpm test:unit."
                    optional
                  />
                </div>
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
              </div></details>
            </Card>
            ) : null}

            {hasVisibleBuildCenterArea ? (
            <div ref={centerColumnRef} className="focus-build-center min-h-0 flex flex-col gap-0" data-focus-secondary={runtimePreviewSectionHidden ? 'center-tools' : undefined}>
              {!runtimePreviewSectionHidden ? (
              <Card className="min-h-0 flex flex-1 flex-col gap-1 px-1.5 pt-2 pb-1.5">
                <div className="focus-preview-toolbar flex items-center justify-between">
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
                    <PreviewComparison key={`${activeAgentId}:${workspaceRelativePath}`} available={runtimeScreenshotAvailable}
                      capture={async () => {
                        if (!snapshot?.runtime.previewUrl) throw new Error('Start the runtime preview first.');
                        return accomplish.captureRuntimePreviewFullPage(snapshot.runtime.previewUrl);
                      }} />
                    <Popover
                      open={runtimeScreenshotCaptureMenuOpen}
                      onOpenChange={(open) => {
                        if (!runtimeScreenshotAvailable || runtimeScreenshotCapturing) {
                          setRuntimeScreenshotCaptureMenuOpen(false);
                          return;
                        }
                        setRuntimeScreenshotCaptureMenuOpen(open);
                      }}
                    >
                      <span
                        className="inline-flex"
                        title={runtimeScreenshotAvailable
                          ? 'Select and screen shot the runtime preview area and save to prompt or export.'
                          : 'Screenshot available when Runtime preview is active.'}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            disabled={!runtimeScreenshotAvailable || runtimeScreenshotCapturing}
                          >
                            {runtimeScreenshotCapturing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Scissors className="mr-1.5 h-3.5 w-3.5" />}
                            Screenshot
                            <ChevronDown className="ml-1 h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                      </span>
                      <PopoverContent align="end" className="w-56 p-1.5">
                        <button
                          type="button"
                          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
                          onClick={beginRuntimeScreenshotSelection}
                        >
                          <Scissors className="mt-0.5 h-3.5 w-3.5 text-primary" />
                          <span>
                            <span className="block font-medium text-foreground">Select area</span>
                            <span className="block text-[11px] leading-snug text-muted-foreground">Drag a dotted rectangle over the visible preview.</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
                          onClick={() => void captureFullRuntimePreview()}
                        >
                          <Maximize2 className="mt-0.5 h-3.5 w-3.5 text-primary" />
                          <span>
                            <span className="block font-medium text-foreground">Full preview</span>
                            <span className="block text-[11px] leading-snug text-muted-foreground">Capture the full preview page, including content below the fold.</span>
                          </span>
                        </button>
                      </PopoverContent>
                    </Popover>
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
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 ml-1 border border-dashed border-muted-foreground/30 hover:border-amber-400/60 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                      title="Hide Runtime Preview section."
                      data-focus-secondary="preview-layout-control"
                      onClick={() => setRuntimePreviewSectionHidden(true)}
                    >
                      <PanelBottomClose className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div data-focus-secondary="fingerprint" className="my-1 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Build Fingerprint</div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => setBuildFingerprintCollapsed((current) => !current)}
                        title={buildFingerprintCollapsed ? 'Expand build fingerprint details.' : 'Collapse build fingerprint details.'}
                      >
                        {buildFingerprintCollapsed ? 'Expand' : 'Collapse'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 px-0"
                        onClick={() => void refreshFingerprint(true)}
                        disabled={fingerprintBusy}
                        title="Recalculate and refresh project fingerprint details."
                      >
                        {fingerprintBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  {!buildFingerprintCollapsed ? (
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] leading-tight text-muted-foreground">
                      <div className="min-w-0 max-w-[48%] truncate" title={workspaceFingerprint?.workspaceRoot || snapshot?.workspaceRoot || ''}>
                        <span className="font-medium text-foreground/70">Workspace:</span> {workspaceFingerprint?.workspaceRoot || snapshot?.workspaceRoot || 'N/A'}
                      </div>
                      <div className="min-w-0 max-w-[28%] truncate" title={workspaceFingerprint?.packageName
                        ? `${workspaceFingerprint.packageName}${workspaceFingerprint.packageVersion ? `@${workspaceFingerprint.packageVersion}` : ''}`
                        : 'N/A'}>
                        <span className="font-medium text-foreground/70">Package:</span> {workspaceFingerprint?.packageName
                          ? `${workspaceFingerprint.packageName}${workspaceFingerprint.packageVersion ? `@${workspaceFingerprint.packageVersion}` : ''}`
                          : 'N/A'}
                      </div>
                      <div className="min-w-0 max-w-[28%] truncate" title={workspaceFingerprint?.git.available
                        ? `${workspaceFingerprint.git.branch || 'detached'} · ${workspaceFingerprint.git.shortCommit || workspaceFingerprint.git.commit || 'unknown'}${workspaceFingerprint.git.dirty ? ' · dirty' : ' · clean'}`
                        : 'Not detected'}>
                        <span className="font-medium text-foreground/70">Git:</span> {workspaceFingerprint?.git.available
                          ? `${workspaceFingerprint.git.branch || 'detached'} · ${workspaceFingerprint.git.shortCommit || workspaceFingerprint.git.commit || 'unknown'}${workspaceFingerprint.git.dirty ? ' · dirty' : ' · clean'}`
                          : 'Not detected'}
                      </div>
                      <div className="min-w-0 max-w-[28%] truncate" title={workspaceFingerprint?.next.buildId
                        ? workspaceFingerprint.next.buildId
                        : workspaceFingerprint?.next.isNextProject
                          ? 'No .next/BUILD_ID yet'
                          : 'Not a Next project'}>
                        <span className="font-medium text-foreground/70">Next build:</span> {workspaceFingerprint?.next.buildId
                          ? workspaceFingerprint.next.buildId
                          : workspaceFingerprint?.next.isNextProject
                            ? 'No .next/BUILD_ID yet'
                            : 'Not a Next project'}
                      </div>
                      <div className="min-w-0 max-w-[40%] truncate" title={snapshot?.runtime.activeCommand || 'N/A'}>
                        <span className="font-medium text-foreground/70">Runtime command:</span> {snapshot?.runtime.activeCommand || 'N/A'}
                      </div>
                      <div className="min-w-0 max-w-[24%] truncate" title={formatTimestamp(workspaceFingerprint?.generatedAt)}>
                        <span className="font-medium text-foreground/70">Refreshed:</span> {formatTimestamp(workspaceFingerprint?.generatedAt)}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div ref={runtimePreviewCaptureRef} className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-background">
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
                    <iframe
                      title="Build Preview"
                      src={snapshot?.runtime.previewUrl ?? ''}
                      className={cn('h-full w-full', runtimeScreenshotSelecting && 'pointer-events-none select-none')}
                    />
                  ) : (
                    <>
                      {snapshot?.runtime.status === 'stopped' ? (
                        <div className="h-full overflow-auto"><div className="min-h-full flex flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground gap-2 [&>*]:shrink-0">
                          <TerminalIcon className="h-6 w-6" />
                          <div className="text-xl font-semibold text-foreground">Ready to work on your project</div>
                          <ol className="my-3 max-w-md space-y-3 text-left text-sm text-foreground">
                            <li><strong>1. Choose your folder.</strong> {focusScene ? 'Use Exit Focus to choose or change the Build workspace.' : 'Confirm the Build workspace on the left.'}</li>
                            <li><strong>2. Describe the task.</strong> Tell the agent what to create or change in the task panel.</li>
                            <li><strong>3. Review the result.</strong> Start the preview, inspect changed files, and run checks.</li>
                          </ol>
                          <div className="mb-2 text-xs">The project preview is currently stopped. Tools, logs, Git, and preset settings remain available.</div>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label="Start preview" onClick={() => void runRuntimeAction('start')}
                            disabled={busyAction !== null}
                            title="Start preview"
                          >
                            <Play className="h-4 w-4 mr-1.5" />
                            Start preview
                          </Button>
                        </div>
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
                  {runtimeScreenshotSelecting ? (
                    <div
                      className="absolute inset-0 z-30 cursor-crosshair"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        startRuntimeScreenshotSelectionDrag(event);
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }
                      }}
                      onPointerMove={(event) => {
                        if (!runtimeScreenshotSelectionDraggingRef.current) return;
                        event.preventDefault();
                        updateRuntimeScreenshotSelectionDrag(event);
                      }}
                      onPointerUp={(event) => {
                        event.preventDefault();
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        finishRuntimeScreenshotSelectionDrag(event);
                      }}
                      onPointerCancel={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        cancelRuntimeScreenshotSelectionDrag();
                      }}
                    >
                      <canvas
                        ref={runtimeScreenshotSelectionCanvasRef}
                        className="pointer-events-none absolute inset-0 h-full w-full"
                      />
                    </div>
                  ) : null}
                </div>
              </Card>
              ) : null}

              {hasVisibleBuildLowerPanel ? (
                <>
                  {!runtimePreviewSectionHidden ? (
                  <div
                    data-focus-secondary="panel-resizer"
                    className="flex h-3 shrink-0 cursor-row-resize select-none touch-none items-center justify-center"
                    onMouseDown={handleBuildCenterPanelResizeStart}
                    title="Drag to resize Runtime Preview and the lower Build panels."
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize runtime preview and lower Build panels"
                  >
                    <div className="h-px w-full rounded-full bg-border/70" />
                  </div>
                  ) : null}
                  <div
                    ref={lowerPanelsGridRef}
                    data-focus-secondary="build-tools"
                    className={cn(
                      'grid min-h-0 gap-3',
                      runtimePreviewSectionHidden ? 'flex-1' : ''
                    )}
                    style={{
                      height: runtimePreviewSectionHidden ? undefined : `${buildLowerPanelHeight}px`,
                      gridTemplateColumns: buildLowerPanelGridTemplate,
                    }}
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
                    <Card className="relative h-full min-h-0 gap-0 rounded-xl p-0 flex flex-col">
                      {!terminalSectionHidden ? (
                        <div
                          className="absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize"
                          onMouseDown={handleRuntimeLogsLeftResizeStart}
                          title="Drag to resize Terminal and Runtime Logs."
                          role="separator"
                          aria-orientation="vertical"
                          aria-label="Resize Terminal and Runtime Logs"
                        />
                      ) : null}
                      {!diffSectionHidden ? (
                        <div
                          className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize"
                          onMouseDown={handleRuntimeLogsRightResizeStart}
                          title="Drag to resize Runtime Logs and Changes & Git."
                          role="separator"
                          aria-orientation="vertical"
                          aria-label="Resize Runtime Logs and Changes & Git"
                        />
                      ) : null}
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

                  {!diffSectionHidden ? (
                    <div className="relative h-full min-h-0">
                      {!terminalSectionHidden && runtimeLogsSectionHidden ? (
                        <div
                          className="absolute -left-2 top-0 z-30 h-full w-3 cursor-col-resize"
                          onMouseDown={handleTerminalDiffResizeStart}
                          title="Drag to resize Terminal and Changes & Git."
                          role="separator"
                          aria-orientation="vertical"
                          aria-label="Resize Terminal and Changes & Git"
                        />
                      ) : null}
                      <div
                        ref={setDiffPanelHost}
                        className="h-full min-h-0 w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                        style={resolvedTheme === 'dark'
                          ? {
                              outline: '1px solid rgba(255, 255, 255, 0.88)',
                              boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.22)',
                            }
                          : undefined}
                      />
                    </div>
                  ) : null}
                  </div>
                </>
              ) : null}
            </div>
            ) : null}

            <Card className="focus-build-operator relative min-h-0 flex flex-col p-3 gap-3">
              <div
                data-focus-secondary="operator-resizer"
                className="absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize"
                onMouseDown={handleOperatorPanelResizeStart}
                title="Drag to resize AI Build Operator."
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize AI Build Operator"
              />
              <div
                className={cn(
                  'focus-content-width min-h-0 flex flex-1 flex-col gap-3',
                  !hasVisibleBuildCenterArea ? 'mx-auto w-full max-w-5xl' : ''
                )}
              >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">AI Build Operator</div>
                  {liveChangedFilesOverview ? (
                    <button
                      type="button"
                      className="inline-flex max-w-[320px] items-center gap-1.5 truncate text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => handleOpenChangedFilesReview(liveChangedFilesOverview.reviewPath)}
                      title={liveChangedFilesOverview.title}
                    >
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <span className="shrink-0">Editing</span>
                      <span className="min-w-0 truncate text-primary">{liveChangedFilesOverview.label}</span>
                      <span className="shrink-0 text-emerald-500">+{liveChangedFilesOverview.addedLines}</span>
                      <span className="shrink-0 text-red-500">-{liveChangedFilesOverview.deletedLines}</span>
                      {liveChangedFilesOverview.fileCount > 1 ? (
                        <span className="shrink-0 text-muted-foreground/80">
                          · {liveChangedFilesOverview.fileCount} files
                        </span>
                      ) : null}
                    </button>
                  ) : activeEditorTab && centerPanelView === 'editor' ? (
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
                      <BuildTooltip content="New task" side="top" align="center">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => {
                            handleStartNewHistorySession();
                            setHistoryDropdownOpen(false);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </BuildTooltip>
                      <BuildTooltip content="Task history" side="top" align="center">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setHistoryDropdownOpen((current) => !current)}
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                      </BuildTooltip>
                      <BuildTooltip content="Archived" side="top" align="center">
                        <Button
                          size="icon"
                          variant={historyArchivedOnly ? 'outline' : 'ghost'}
                          className="h-7 w-7"
                          onClick={() => setHistoryArchivedOnly((current) => !current)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </BuildTooltip>
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

              {subagentParentTaskId && <TaskJourney key={subagentParentTaskId} taskId={subagentParentTaskId}
                status={aiBusy ? (journeyTask?.status === 'waiting_permission' || journeyTask?.status === 'queued' ? journeyTask.status : 'running') : journeyTask?.status}
                messages={aiMessages} activity={journeyTask?.activity} agent={activeAgent}
                onOpenMessage={id => {
                  const index = assistantMessages.findIndex(message => message.id === id);
                  if (index >= 0) assistantMessagesVirtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
                }} />}
              {subagentParentTaskId ? (
                <div
                  className={cn(
                    'rounded-md border border-border/60 bg-card/60 shadow-sm backdrop-blur-sm',
                    subagentsCollapsed ? 'shrink-0 px-2 py-1' : 'p-2'
                  )}
                >
                  <div className={cn('flex items-center justify-between gap-2', subagentsCollapsed ? 'h-6' : 'mb-2')}>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-semibold text-foreground">Background work</div>
                      <div className="text-[11px] text-muted-foreground">
                        {subagentRunsLoading ? 'Refreshing…' : `${activeSubagentCount} active · ${subagentRuns.length} total`}
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
                  {subagentsCollapsed ? null : subagentRuns.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/60 bg-background/50 px-2 py-2 text-[11px] text-muted-foreground">
                      No child agents have been spawned for this task yet.
                    </div>
                  ) : (
                    <div
                      className="overflow-y-auto pr-1"
                      style={{ maxHeight: `${BUILD_SUBAGENTS_PANEL_MAX_HEIGHT}px` }}
                    >
                      <BuildSubagentTreeList
                        nodes={subagentTree}
                        stoppingSubagentRunId={stoppingSubagentRunId}
                        agentNames={subagentAgentNames}
                        onOpen={(run) => void loadSubagentDetail(run)}
                        onInspect={inspectSubagentRun}
                        onStop={(runId) => void stopSubagentRun(runId)}
                        onCloseSession={(runId) => void closeSubagentRun(runId)}
                        onArchive={(runId) => void archiveSubagentRun(runId)}
                        onRecover={recoverSubagentRun}
                        onReplace={replaceSubagentRun}
                      />
                    </div>
                  )}
                </div>
              ) : null}

              <div className="relative min-h-0 flex-1">
                <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/60">
                  {aiBusy ? (
                    <div className="shrink-0 border-b border-border/50 p-2">
                      <AgentToolStateIndicator
                        presence={buildAgentPresence}
                        activitySteps={buildToolActivitySteps}
                        agentName={activeAgent?.name || activeAgentId || 'Agent'}
                        agentRoleName={activeAgent?.roleName}
                        agentAvatar={activeAgent?.avatar}
                        agentAvatarColor={activeAgent?.avatarColor}
                        agentAvatarImageDataUrl={activeAgent?.avatarImageDataUrl}
                        compact
                        className="bg-card/80"
                        testId="build-tool-state-indicator"
                      />
                    </div>
                  ) : null}
                  <div className="relative min-h-0 flex-1">
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
                          return isAtBottom ? 'auto' : false;
                        }}
                        atBottomStateChange={(isAtBottom) => {
                          assistantNearBottomRef.current = isAtBottom;
                          setAssistantNearBottom(isAtBottom);
                        }}
                        rangeChanged={handleBuildPromptNavigatorRangeChanged}
                        itemContent={(index, message) => {
                          const changedFilesPayload = parseBuildChangedFilesSummaryMessage(message);
                          const relayedSubagentMeta = getRelayedSubagentCompletionMeta(message);
                          const relayedSubagentAgent = relayedSubagentMeta
                            ? agentById.get(relayedSubagentMeta.childAgentId)
                            : undefined;
                          return (
                            <div className={cn('px-2', index === 0 ? 'pt-2' : 'pt-0.5', index === assistantMessages.length - 1 ? 'pb-2' : 'pb-1.5')}>
                              {changedFilesPayload ? (
                                <BuildChangedFilesSummaryCard
                                  summary={changedFilesPayload.summary}
                                  canUndo={Boolean(
                                    pendingDiffBaselineId
                                    && diff?.mode === 'synthetic'
                                    && changedFilesPayload.runId === activeRunSummaryIdRef.current
                                  )}
                                  undoBusy={resolvingDiffDecision === 'reject'}
                                  onUndo={() => void resolvePendingDiffBaseline('reject')}
                                  onReview={handleOpenChangedFilesReview}
                                />
                              ) : (
                                <BuildAssistantMessageItem
                                  message={message}
                                  messageVersion={getTaskMessageRenderVersion(message)}
                                  copied={copiedAssistantMessageId === message.id}
                                  expandedToolMessage={Boolean(expandedToolMessageIds[message.id])}
                                  savingProjectNote={projectNoteSavingMessageId === message.id}
                                  savingRtf={rtfSavingMessageId === message.id}
                                  proseClasses={assistantProseClasses}
                                  relayedSubagentAgentName={relayedSubagentAgent?.name || relayedSubagentMeta?.childAgentId}
                                  relayedSubagentAgentRoleName={relayedSubagentAgent?.roleName}
                                  relayedSubagentAgentAvatar={relayedSubagentAgent?.avatar}
                                  relayedSubagentAgentAvatarColor={relayedSubagentAgent?.avatarColor}
                                  relayedSubagentAgentAvatarImageDataUrl={relayedSubagentAgent?.avatarImageDataUrl}
                                  relayedSubagentAvatarFrame={relayedSubagentAgent?.appearance?.avatarFrame}
                                  relayedSubagentLabel={relayedSubagentMeta?.label}
                                  onCopy={handleCopyAssistantMessageClick}
                                  onSaveAsProjectNote={handleOpenSaveAnswerAsProjectNote}
                                  onSaveAsRtf={handleOpenSaveAnswerAsRtf}
                                  onToggleToolMessage={toggleToolMessageExpanded}
                                  onContentRef={handleAssistantMessageContentRef}
                                />
                              )}
                            </div>
                          );
                        }}
                      />
                    )}
                    <PromptNavigator
                      entries={buildPromptNavigatorEntries}
                      activeEntryId={activeBuildPromptNavigatorId}
                      onJump={handleBuildPromptNavigatorJump}
                      storageKey={BUILD_PROMPT_NAVIGATOR_STORAGE_KEY}
                      label="Prompt navigator"
                      tone="build"
                    />
                  </div>
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
                agentId={activeAgentId}
                workspace={snapshot?.workspaceRoot || agentWorkspaceRoot}
                usageProjectId={selectedBuildProjectId}
                askAiToRunTests={askAiToRunTests}
                showWorkingFolder={!hasVisibleBuildCenterArea}
                showProposedDiffPopupButton={diffSectionHidden && !hasVisibleBuildCenterArea}
                promptsCount={promptLibraryItems.length}
                onDraftChange={syncGoalPromptDraftRef}
                onUsageProjectChange={handleBuildUsageProjectChange}
                onAskAiToRunTestsChange={setAskAiToRunTests}
                onRun={handleRunPrompt}
                onStop={handleStopPrompt}
                onAttachFiles={() => {
                  void handleSelectPromptFiles();
                }}
                onAddAttachedFiles={addPromptAttachedFiles}
                onRemoveFile={removePromptAttachedFile}
                onOpenSavedPrompts={openSavedPrompts}
                onSaveCurrentPrompt={saveCurrentBuildPrompt}
                onOpenProjectWork={openProjectWorkPopup}
                onOpenProposedDiffPopup={openBuildGitReviewDialog}
                slashCommands={buildSlashCommands}
              />

              {!diffSectionHidden && diffPanelHost ? createPortal(
                <Card
                  ref={diffPanelRef}
                  className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden rounded-xl border-0 bg-card p-2 shadow-none"
                >
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="shrink-0 text-xs font-medium text-muted-foreground">Changes & Git</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    title="Open Changes & Git in a larger review window."
                    onClick={() => setGitReviewDialogOpen(true)}
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 border border-dashed border-muted-foreground/30 hover:border-amber-400/60 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                    title="Hide Changes & Git section."
                    onClick={() => setDiffSectionHidden(true)}
                  >
                    <PanelBottomClose className="h-3.5 w-3.5" />
                  </Button>
                  </div>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-y-scroll overscroll-contain rounded-md border border-border/60 p-2 pr-3 text-xs"
                >
                  <>
                      {renderBuildGitReviewContent({ compact: diffPanelUsesMinimalGitView })}
                      <div className="hidden">
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
                      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="min-w-0 space-y-2">
                          <BuildUnifiedDiffViewer patch={diff?.patch} compact />
                          {changedDiffFiles.length > 0 ? (
                            <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-[220px_1fr]">
                              <div className="max-h-52 overflow-auto rounded-md border border-border/60 bg-muted/20 p-1">
                                {changedDiffFiles.map((file) => {
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
                              <div className="grid min-h-0 grid-cols-1 gap-2 2xl:grid-cols-2">
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

                        <aside className="space-y-2 rounded-md border border-border/60 bg-muted/10 p-2 text-[11px]">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-foreground">Build review</div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {changedDiffFiles.length > 0
                                  ? `${changedDiffFiles.length} changed file${changedDiffFiles.length === 1 ? '' : 's'}`
                                  : 'No changed files detected'}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              disabled={qualityChecksBusy || !activeAgentId}
                              onClick={() => void handleRunQualityChecks()}
                              title="Run inferred typecheck, lint, test, build, runtime, and preview checks."
                            >
                              {qualityChecksBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                              Run checks
                            </Button>
                          </div>

                          {shouldSuggestQualityChecks ? (
                            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                              <div className="font-medium">Checks suggested</div>
                              <div className="mt-0.5 text-[10px] leading-relaxed">
                                Changed files were detected after the AI task. Run checks before approving or continuing.
                              </div>
                              <div className="mt-2 flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-[11px]"
                                  disabled={qualityChecksBusy || !activeAgentId}
                                  onClick={() => void handleRunQualityChecks()}
                                >
                                  Run checks
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => setDismissedQualityCheckSuggestionKey(currentDiffSignature || null)}
                                >
                                  Dismiss
                                </Button>
                              </div>
                            </div>
                          ) : null}

                          <div className="space-y-1.5">
                            <div className="rounded-md border border-border/50 bg-background/60 p-2">
                              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Summary</div>
                              <div className="line-clamp-4 text-muted-foreground">{diff?.summary || 'No diff summary available.'}</div>
                            </div>

                            <div className="rounded-md border border-border/50 bg-background/60 p-2">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-medium uppercase text-muted-foreground">Runtime</span>
                                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', getRuntimeStatusClasses(buildReviewRuntimeStatus))}>
                                  {buildReviewRuntimeLabel}
                                </span>
                              </div>
                              <div className="line-clamp-2 text-muted-foreground" title={buildReviewRuntimeDetail}>
                                {buildReviewRuntimeDetail}
                              </div>
                            </div>

                            <div className="rounded-md border border-border/50 bg-background/60 p-2">
                              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Preview screenshot</div>
                              {previewScreenshotSrc ? (
                                <img
                                  src={previewScreenshotSrc}
                                  alt="Preview screenshot"
                                  className="mt-1 aspect-video w-full rounded border border-border/50 object-cover"
                                />
                              ) : (
                                <div className="text-muted-foreground">
                                  {snapshot?.runtime.previewUrl
                                    ? 'No screenshot captured in the latest preview check.'
                                    : 'No preview screenshot available.'}
                                </div>
                              )}
                            </div>

                            <div className="rounded-md border border-border/50 bg-background/60 p-2">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-medium uppercase text-muted-foreground">Checks</span>
                                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', getQualityCheckStatusClasses(qualityCheckRun?.status))}>
                                  {formatQualityCheckSummary(qualityCheckRun)}
                                </span>
                              </div>
                              {qualityCheckRun ? (
                                <div className="space-y-1">
                                  {qualityCheckRun.completedAt ? (
                                    <div className="text-[10px] text-muted-foreground">Last run {formatTimestamp(qualityCheckRun.completedAt)}</div>
                                  ) : null}
                                  {qualityCheckRun.checks.map((check) => (
                                    <div key={`${qualityCheckRun.id}-${check.kind}`} className="rounded-md border border-border/40 bg-muted/20 px-2 py-1">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="truncate font-medium text-foreground">{check.label}</span>
                                        <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', getQualityCheckStatusClasses(check.status))}>
                                          {check.status}
                                        </span>
                                      </div>
                                      <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground" title={check.output || check.summary}>
                                        {check.command ? `${check.command}: ` : ''}{check.summary}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground">
                                  Checks are inferred from package scripts and active Build presets. They run only when you click the button.
                                </div>
                              )}
                            </div>

                            {changedDiffFiles.length > 0 ? (
                              <div className="rounded-md border border-border/50 bg-background/60 p-2">
                                <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Changed files</div>
                                <div className="space-y-1">
                                  {changedDiffFiles.slice(0, 6).map((file) => (
                                    <button
                                      key={`review-${file.relativePath}`}
                                      type="button"
                                      className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                      onClick={() => setSelectedDiffFilePath(file.relativePath)}
                                      title={file.relativePath}
                                    >
                                      <span className="truncate">{file.relativePath}</span>
                                      <span className="shrink-0 uppercase">{file.changeType}</span>
                                    </button>
                                  ))}
                                  {changedDiffFiles.length > 6 ? (
                                    <div className="px-1.5 text-[10px] text-muted-foreground">
                                      +{changedDiffFiles.length - 6} more
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}

                            {buildDiffEnforcementMode === 'approval'
                              && pendingDiffBaselineId
                              && diff?.mode === 'synthetic'
                              && changedDiffFiles.length > 0 ? (
                              <div className="rounded-md border border-border/50 bg-background/60 p-2">
                                <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">Approval</div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 flex-1 px-2 text-[11px]"
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
                                    className="h-7 flex-1 px-2 text-[11px]"
                                    disabled={resolvingDiffDecision !== null}
                                    onClick={() => void resolvePendingDiffBaseline('reject')}
                                    title="Reject pending AI changes and restore baseline files."
                                  >
                                    {resolvingDiffDecision === 'reject' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                                    Reject
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </aside>
                      </div>
                      </div>
                    </>
                </div>
              </Card>,
                diffPanelHost
              ) : null}

              </div>
            </Card>
          </div>

        </div>
      </div>
      {projectNoteNotice ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[100] max-w-[min(28rem,calc(100vw-2rem))]">
          <Card className="flex items-start gap-2 border-primary/30 bg-background/95 p-3 text-sm text-primary shadow-xl backdrop-blur">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{projectNoteNotice}</span>
          </Card>
        </div>
      ) : null}
      <Dialog open={projectNoteDialogOpen} onOpenChange={(open) => {
        setProjectNoteDialogOpen(open);
        if (!open && !projectNoteSavingMessageId) {
          projectNoteWorkItemsRequestRef.current += 1;
          setProjectNotePending(null);
          setProjectNoteWorkItems([]);
          setProjectNoteWorkItemsProjectId('');
          setProjectNoteTargetWorkItemId('');
          projectNoteTitleRef.current = '';
          setProjectNoteTitle('');
        }
      }}>
        <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-xl flex-col overflow-hidden">
          <DialogHeader className="pr-8">
            <DialogTitle>Save Final Answer As Note</DialogTitle>
            <DialogDescription>
              Attach this Build task to a budget project, then choose the Workboard item that should receive the note.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-md border border-border/60 bg-background p-3">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-note-title">Note title</label>
              <Input
                key={`note-title:${projectNotePending?.messageId || 'new'}`}
                id="build-final-answer-note-title"
                className="mt-1.5"
                defaultValue={projectNoteTitle}
                onChange={(event) => {
                  projectNoteTitleRef.current = event.target.value;
                }}
                placeholder="Final answer"
              />
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Project</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className={cn(
                    'rounded-md border px-3 py-2 text-left text-sm',
                    projectNoteDialogMode === 'existing-project' ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                  )}
                  onClick={() => {
                    setProjectNoteDialogMode('existing-project');
                    const currentProjectIsValid = Boolean(
                      projectNoteTargetProjectId && usageProjects.some((project) => project.id === projectNoteTargetProjectId)
                    );
                    const nextProjectId = currentProjectIsValid ? projectNoteTargetProjectId : getDefaultSaveTargetUsageProjectId();
                    setProjectNoteTargetProjectId(nextProjectId);
                    if (nextProjectId) void loadProjectNoteWorkItemsForProject(nextProjectId);
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
                    projectNoteDialogMode === 'new-project' ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                  )}
                  onClick={() => {
                    setProjectNoteDialogMode('new-project');
                    projectNoteWorkItemsRequestRef.current += 1;
                    setProjectNoteWorkItems([]);
                    setProjectNoteWorkItemsProjectId('');
                    setProjectNoteTargetWorkItemId('__new__');
                  }}
                >
                  New project
                  <div className="mt-1 text-xs text-muted-foreground">Create a project and attach this task to it.</div>
                </button>
              </div>
              <div className="mt-3 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-note-project">Choose project</label>
                <select
                  id="build-final-answer-note-project"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70"
                  value={projectNoteDialogMode === 'new-project' ? '__new_project__' : projectNoteTargetProjectId}
                  disabled={projectNoteDialogMode === 'new-project'}
                  onChange={(event) => {
                    const nextProjectId = event.target.value;
                    setProjectNoteTargetProjectId(nextProjectId);
                    setProjectNoteTargetWorkItemId('');
                    if (nextProjectId) void loadProjectNoteWorkItemsForProject(nextProjectId);
                  }}
                >
                  {projectNoteDialogMode === 'new-project' ? (
                    <option value="__new_project__">New project</option>
                  ) : usageProjects.length === 0 ? (
                    <option value="">No projects yet</option>
                  ) : usageProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name.trim().toLowerCase() === 'new project' ? 'New project (saved)' : project.name}
                    </option>
                  ))}
                </select>
              </div>
              {projectNoteDialogMode === 'new-project' ? (
                <div className="mt-3 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-note-new-project">New project name</label>
                  <Input
                    id="build-final-answer-note-new-project"
                    value={projectNoteNewProjectName}
                    onChange={(event) => setProjectNoteNewProjectName(event.target.value)}
                    placeholder="Budget project name"
                  />
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Work item</div>
              {projectNoteDialogMode === 'existing-project' && projectNoteTargetProjectId ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-note-work-item">Choose work item</label>
                  <select
                    id="build-final-answer-note-work-item"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70"
                    value={projectNoteWorkItemsLoading ? '__loading__' : (projectNoteTargetWorkItemId || '__new__')}
                    onChange={(event) => setProjectNoteTargetWorkItemId(event.target.value)}
                    disabled={projectNoteWorkItemsLoading}
                  >
                    {projectNoteWorkItemsLoading ? (
                      <option value="__loading__">Loading work items...</option>
                    ) : (
                      <>
                        {(projectNoteWorkItemsProjectId === projectNoteTargetProjectId ? projectNoteWorkItems : []).map((item) => (
                          <option key={item.id} value={item.id}>{item.title}{item.archived ? ' (archived)' : ''}</option>
                        ))}
                        <option value="__new__">Create new work item</option>
                      </>
                    )}
                  </select>
                  {projectNoteWorkItemsLoading ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading work items...
                    </div>
                  ) : null}
                  {!projectNoteWorkItemsLoading
                    && projectNoteWorkItemsProjectId === projectNoteTargetProjectId
                    && projectNoteWorkItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No work items are saved under this project yet.
                    </div>
                  ) : null}
                </div>
              ) : projectNoteDialogMode === 'new-project' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-note-work-item-new-project">Choose work item</label>
                  <select
                    id="build-final-answer-note-work-item-new-project"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm opacity-70"
                    value="__new__"
                    disabled
                  >
                    <option value="__new__">Create new work item</option>
                  </select>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Choose a project to see its work items.</div>
              )}
              {(!projectNoteWorkItemsLoading && (projectNoteDialogMode === 'new-project' || projectNoteTargetWorkItemId === '__new__' || !projectNoteTargetWorkItemId)) ? (
                <div className="mt-3 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-note-new-work-item">New work item title</label>
                  <Input
                    id="build-final-answer-note-new-work-item"
                    value={projectNoteNewWorkItemTitle}
                    onChange={(event) => setProjectNoteNewWorkItemTitle(event.target.value)}
                    placeholder="Work item title"
                  />
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-border/60 bg-background p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Note preview</div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {projectNotePending?.content || ''}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setProjectNoteDialogOpen(false)}
              disabled={projectNoteSavingMessageId !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void savePendingAnswerAsProjectWorkItemNote()}
              disabled={
                projectNoteSavingMessageId !== null
                || !projectNotePending
                || projectNoteWorkItemsLoading
                || (projectNoteDialogMode === 'existing-project' && (
                  !projectNoteTargetProjectId
                  || !usageProjects.some((project) => project.id === projectNoteTargetProjectId)
                ))
                || ((projectNoteTargetWorkItemId === '__new__' || projectNoteDialogMode === 'new-project') && !projectNoteNewWorkItemTitle.trim())
              }
            >
              {projectNoteSavingMessageId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rtfDialogOpen} onOpenChange={(open) => {
        setRtfDialogOpen(open);
        if (!open && !rtfSavingMessageId) {
          rtfWorkItemsRequestRef.current += 1;
          setRtfPending(null);
          setRtfWorkItems([]);
          setRtfWorkItemsProjectId('');
          setRtfTargetWorkItemId('');
          rtfFileTitleRef.current = '';
          setRtfFileTitle('');
        }
      }}>
        <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-xl flex-col overflow-hidden">
          <DialogHeader className="pr-8">
            <DialogTitle>Save Final Answer As RTF</DialogTitle>
            <DialogDescription>
              Choose where to save the Rich Text File. You can also attach the saved file to a Workboard item as a document link.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-md border border-border/60 bg-background p-3">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-rtf-title">File name</label>
              <Input
                key={`rtf-title:${rtfPending?.messageId || 'new'}`}
                id="build-final-answer-rtf-title"
                className="mt-1.5"
                defaultValue={rtfFileTitle}
                onChange={(event) => {
                  rtfFileTitleRef.current = event.target.value;
                }}
                placeholder="Final answer"
              />
              <div className="mt-2 text-[11px] text-muted-foreground">
                The app will ask you where to save the `.rtf` file when you click Save RTF.
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={rtfAttachToWorkItem}
                onChange={(event) => {
                  setRtfAttachToWorkItem(event.target.checked);
                  if (event.target.checked) {
                    const nextProjectId = rtfTargetProjectId || getDefaultSaveTargetUsageProjectId();
                    setRtfTargetProjectId(nextProjectId);
                    if (nextProjectId) void loadRtfWorkItemsForProject(nextProjectId);
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

            {rtfAttachToWorkItem ? (
              <>
                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Project</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className={cn(
                        'rounded-md border px-3 py-2 text-left text-sm',
                        rtfDialogMode === 'existing-project' ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                      )}
                      onClick={() => {
                        setRtfDialogMode('existing-project');
                        const nextProjectId = rtfTargetProjectId || getDefaultSaveTargetUsageProjectId();
                        setRtfTargetProjectId(nextProjectId);
                        if (nextProjectId) void loadRtfWorkItemsForProject(nextProjectId);
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
                        rtfDialogMode === 'new-project' ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                      )}
                      onClick={() => {
                        setRtfDialogMode('new-project');
                        rtfWorkItemsRequestRef.current += 1;
                        setRtfWorkItems([]);
                        setRtfWorkItemsProjectId('');
                        setRtfTargetWorkItemId('__new__');
                      }}
                    >
                      New project
                      <div className="mt-1 text-xs text-muted-foreground">Create a project and attach this task to it.</div>
                    </button>
                  </div>
                  {rtfDialogMode === 'existing-project' ? (
                    <div className="mt-3 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-rtf-project">Choose project</label>
                      <select
                        id="build-final-answer-rtf-project"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={rtfTargetProjectId}
                        onChange={(event) => {
                          const nextProjectId = event.target.value;
                          setRtfTargetProjectId(nextProjectId);
                          setRtfTargetWorkItemId('');
                          if (nextProjectId) void loadRtfWorkItemsForProject(nextProjectId);
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
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-rtf-new-project">New project name</label>
                      <Input
                        id="build-final-answer-rtf-new-project"
                        value={rtfNewProjectName}
                        onChange={(event) => setRtfNewProjectName(event.target.value)}
                        placeholder="Budget project name"
                      />
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Work item</div>
                  {rtfDialogMode === 'existing-project' && rtfTargetProjectId ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-rtf-work-item">Choose work item</label>
                      <select
                        id="build-final-answer-rtf-work-item"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={rtfTargetWorkItemId || '__new__'}
                        onChange={(event) => setRtfTargetWorkItemId(event.target.value)}
                        disabled={rtfWorkItemsLoading}
                      >
                        {(rtfWorkItemsProjectId === rtfTargetProjectId ? rtfWorkItems : []).map((item) => (
                          <option key={item.id} value={item.id}>{item.title}{item.archived ? ' (archived)' : ''}</option>
                        ))}
                        <option value="__new__">Create new work item</option>
                      </select>
                      {rtfWorkItemsLoading ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading work items...
                        </div>
                      ) : null}
                      {!rtfWorkItemsLoading
                        && rtfWorkItemsProjectId === rtfTargetProjectId
                        && rtfWorkItems.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          No work items are saved under this project yet.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Choose a project to see its work items.</div>
                  )}
                  {(!rtfWorkItemsLoading && (rtfDialogMode === 'new-project' || rtfTargetWorkItemId === '__new__' || !rtfTargetWorkItemId)) ? (
                    <div className="mt-3 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="build-final-answer-rtf-new-work-item">New work item title</label>
                      <Input
                        id="build-final-answer-rtf-new-work-item"
                        value={rtfNewWorkItemTitle}
                        onChange={(event) => setRtfNewWorkItemTitle(event.target.value)}
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
              onClick={() => setRtfDialogOpen(false)}
              disabled={rtfSavingMessageId !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void savePendingAnswerAsRtf()}
              disabled={
                rtfSavingMessageId !== null
                || !rtfPending
                || (rtfAttachToWorkItem && rtfDialogMode === 'existing-project' && !rtfTargetProjectId)
                || (rtfAttachToWorkItem && (rtfTargetWorkItemId === '__new__' || rtfDialogMode === 'new-project') && !rtfNewWorkItemTitle.trim())
              }
            >
              {rtfSavingMessageId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Save RTF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <AnswerActionsProvider taskId={subagentDetailTask?.id || ''} messages={subagentDetailTask?.messages || []}
              canDraft={Boolean(subagentDetailTask) && !subagentDetailSending && !subagentDetailMutating && !subagentDetailLoading}
              incognito={subagentDetailTask?.privacyMode === 'incognito' || subagentDetailRun?.inheritedContext?.privacyMode === 'incognito'} mode="build"
              onDraft={prompt => setSubagentDetailPrompt(current => current.trim() ? `${current}\n\n${prompt}` : prompt)}>
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
                          {normalizeMarkdownTables(message.content || '')}
                        </ReactMarkdown>
                      </div>
                      {message.type === 'assistant' && <AnswerActions messageId={message.id} content={splitAssistantReasoningContent(message.content || '').answer} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
            </AnswerActionsProvider>
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
      <Dialog open={Boolean(runtimeScreenshotEditor)} onOpenChange={(open) => {
        if (!open && !runtimeScreenshotEditor?.busy) {
          runtimeScreenshotEditorRef.current = null;
          runtimeScreenshotDrawingIdRef.current = null;
          runtimeScreenshotAnnotationDragRef.current = null;
          setRuntimeScreenshotEditor(null);
          setRuntimeScreenshotEditorFullscreen(false);
          setRuntimeScreenshotEditorZoom(1);
          resetRuntimeScreenshotHistory();
        }
      }}>
        <DialogContent
          className={cn(
            'flex flex-col overflow-hidden',
            runtimeScreenshotEditorFullscreen
              ? 'h-[calc(100vh-1rem)] max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-none p-4'
              : 'max-h-[90vh] w-[94vw] max-w-5xl'
          )}
        >
          <DialogHeader className="pr-8">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <DialogTitle>Runtime preview screenshot</DialogTitle>
                <DialogDescription>
                  Draw or add text to the selected preview screenshot, then attach it to the Build prompt or export it.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1 px-2 text-xs"
                onClick={() => setRuntimeScreenshotEditorFullscreen((current) => !current)}
                title={runtimeScreenshotEditorFullscreen ? 'Exit full screen screenshot editor' : 'Open screenshot editor full screen'}
              >
                {runtimeScreenshotEditorFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {runtimeScreenshotEditorFullscreen ? 'Exit full screen' : 'Full screen'}
              </Button>
            </div>
          </DialogHeader>
          {runtimeScreenshotEditor ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
                <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                  {([
                    ['select', <MousePointer2 key="select" className="h-3.5 w-3.5" />, 'Select'],
                    ['draw', <Edit3 key="draw" className="h-3.5 w-3.5" />, 'Draw'],
                    ['rectangle', <Square key="rectangle" className="h-3.5 w-3.5" />, 'Box'],
                    ['ellipse', <Circle key="ellipse" className="h-3.5 w-3.5" />, 'Circle'],
                    ['triangle', <Triangle key="triangle" className="h-3.5 w-3.5" />, 'Triangle'],
                    ['line', <Minus key="line" className="h-3.5 w-3.5" />, 'Line'],
                    ['arrow', <ArrowRight key="arrow" className="h-3.5 w-3.5" />, 'Arrow'],
                    ['text', <Type key="text" className="h-3.5 w-3.5" />, 'Text'],
                  ] as Array<[RuntimeScreenshotTool, ReactNode, string]>).map(([tool, icon, label]) => (
                    <button
                      key={tool}
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 rounded px-2 py-1 text-xs',
                        runtimeScreenshotEditor.tool === tool
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => updateRuntimeScreenshotEditor({ tool })}
                      title={label}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
                <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 border-r border-border px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={undoRuntimeScreenshotEdit}
                    disabled={runtimeScreenshotHistoryCounts.undo === 0 || runtimeScreenshotEditor.busy}
                    title="Undo the last drawing change"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Undo
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={redoRuntimeScreenshotEdit}
                    disabled={runtimeScreenshotHistoryCounts.redo === 0 || runtimeScreenshotEditor.busy}
                    title="Redo the last undone drawing change"
                  >
                    <Redo2 className="h-3.5 w-3.5" />
                    Redo
                  </button>
                </div>
                <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 border-r border-border px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => changeRuntimeScreenshotZoom('out')}
                    disabled={runtimeScreenshotEditorZoom <= RUNTIME_SCREENSHOT_ZOOM_LEVELS[0]}
                    title="Zoom out"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="h-8 min-w-14 border-r border-border px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    onClick={() => setRuntimeScreenshotEditorZoom(1)}
                    title="Reset zoom to 100%"
                  >
                    {Math.round(runtimeScreenshotEditorZoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => changeRuntimeScreenshotZoom('in')}
                    disabled={runtimeScreenshotEditorZoom >= RUNTIME_SCREENSHOT_ZOOM_LEVELS[RUNTIME_SCREENSHOT_ZOOM_LEVELS.length - 1]}
                    title="Zoom in"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Outline
                  <input
                    type="color"
                    value={runtimeScreenshotEditor.outlineColor}
                    onChange={(event) => applyRuntimeScreenshotOutlineColor(event.target.value)}
                    className="h-8 w-10 rounded border border-input bg-background p-1"
                  />
                </label>
                <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1" title="Outline color swatches">
                  {RUNTIME_SCREENSHOT_COLOR_SWATCHES.map((color) => (
                    <button
                      key={`runtime-outline-${color}`}
                      type="button"
                      className={cn(
                        'h-5 w-5 rounded-sm border border-border shadow-sm hover:ring-1 hover:ring-primary/70',
                        runtimeScreenshotEditor.outlineColor.toLowerCase() === color.toLowerCase() && runtimeScreenshotEditor.outlineEnabled && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => applyRuntimeScreenshotOutlineColor(color)}
                      title={`Set outline to ${color}`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted/60 hover:text-foreground',
                    runtimeScreenshotEditor.outlineEnabled ? 'text-muted-foreground' : 'border-primary bg-primary/10 text-primary'
                  )}
                  onClick={toggleRuntimeScreenshotOutline}
                  title={runtimeScreenshotEditor.outlineEnabled ? 'Remove the outline from selected/new shapes' : 'Add an outline to selected/new shapes'}
                >
                  {runtimeScreenshotEditor.outlineEnabled ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  {runtimeScreenshotEditor.outlineEnabled ? 'Turn outline off' : 'Turn outline on'}
                </button>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Fill/Text
                  <input
                    type="color"
                    value={runtimeScreenshotEditor.fillColor === 'transparent' ? '#ffffff' : runtimeScreenshotEditor.fillColor}
                    onChange={(event) => applyRuntimeScreenshotFillColor(event.target.value)}
                    disabled={runtimeScreenshotFillColorDisabled}
                    className="h-8 w-10 rounded border border-input bg-background p-1 disabled:opacity-40"
                  />
                </label>
                <div
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1',
                    runtimeScreenshotFillColorDisabled && 'opacity-45'
                  )}
                  title={runtimeScreenshotFillColorDisabled ? 'Fill/Text color is not available for the current drawing tool or selection' : 'Fill/Text color swatches'}
                >
                  {RUNTIME_SCREENSHOT_COLOR_SWATCHES.map((color) => (
                    <button
                      key={`runtime-fill-${color}`}
                      type="button"
                      className={cn(
                        'h-5 w-5 rounded-sm border border-border shadow-sm hover:ring-1 hover:ring-primary/70 disabled:cursor-not-allowed',
                        runtimeScreenshotEditor.fillColor !== 'transparent'
                          && runtimeScreenshotEditor.fillColor.toLowerCase() === color.toLowerCase()
                          && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => applyRuntimeScreenshotFillColor(color)}
                      disabled={runtimeScreenshotFillColorDisabled}
                      title={`Set fill/text to ${color}`}
                    />
                  ))}
                </div>
                {runtimeScreenshotFillControlVisible ? (
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55',
                      'text-muted-foreground'
                    )}
                    onClick={() => applyRuntimeScreenshotFillColor('transparent')}
                    disabled={runtimeScreenshotFillRemoved || runtimeScreenshotEditor.busy}
                    title={runtimeScreenshotFillRemoved ? 'Fill is already removed' : 'Remove the fill color from selected/new shapes'}
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove fill
                  </button>
                ) : null}
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Fill opacity
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={Math.round(runtimeScreenshotEditor.fillOpacity * 100)}
                    disabled={!(selectedRuntimeScreenshotAnnotation?.type === 'shape' || runtimeScreenshotEditor.tool === 'rectangle' || runtimeScreenshotEditor.tool === 'ellipse' || runtimeScreenshotEditor.tool === 'triangle')}
                    onChange={(event) => applyRuntimeScreenshotFillOpacity(Number(event.target.value) / 100)}
                    className="h-8 w-24 disabled:opacity-40"
                  />
                  <span className="w-8 text-right">{Math.round(runtimeScreenshotEditor.fillOpacity * 100)}%</span>
                </label>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Width</span>
                  <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
                    {RUNTIME_SCREENSHOT_STROKE_WIDTH_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={cn(
                          'flex h-8 items-center gap-1.5 border-r border-border px-2 text-[11px] last:border-r-0 hover:bg-muted/60 hover:text-foreground',
                          runtimeScreenshotEditor.strokeWidth === preset.value && 'bg-primary/10 text-primary'
                        )}
                        onClick={() => applyRuntimeScreenshotStrokeWidth(preset.value)}
                        title={`${preset.label} line thickness`}
                      >
                        <span className="relative h-3 w-9">
                          <span
                            className="absolute left-0 right-0 top-1/2 rounded-full bg-current"
                            style={{ height: `${preset.value}px`, transform: 'translateY(-50%)' }}
                          />
                        </span>
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Line
                  <select
                    value={runtimeScreenshotEditor.strokeStyle}
                    onChange={(event) => applyRuntimeScreenshotStrokeStyle(event.target.value as RuntimeScreenshotLineStyle)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="solid">solid</option>
                    <option value="dashed">dashed</option>
                    <option value="dotted">dotted</option>
                  </select>
                </label>
                {selectedRuntimeScreenshotAnnotation?.type === 'text' ? (
                  <input
                    value={runtimeScreenshotEditor.text}
                    onChange={(event) => applyRuntimeScreenshotText(event.target.value)}
                    className="h-8 min-w-[220px] flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Selected text"
                  />
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  onClick={copySelectedRuntimeScreenshotAnnotation}
                  disabled={!selectedRuntimeScreenshotAnnotation || runtimeScreenshotEditor.busy}
                  title={selectedRuntimeScreenshotAnnotation ? 'Copy the selected drawing item.' : 'Select a drawing item to copy it.'}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  onClick={pasteRuntimeScreenshotAnnotation}
                  disabled={!runtimeScreenshotAnnotationClipboardReady || runtimeScreenshotEditor.busy}
                  title={runtimeScreenshotAnnotationClipboardReady ? 'Paste another copy of the copied drawing item.' : 'Copy a drawing item before pasting.'}
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  Paste
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={deleteSelectedRuntimeScreenshotAnnotation}
                  disabled={!selectedRuntimeScreenshotAnnotation || runtimeScreenshotEditor.busy}
                  title={selectedRuntimeScreenshotAnnotation ? 'Delete the selected drawing item.' : 'Select a drawing item to delete it.'}
                >
                  Delete selected
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => updateRuntimeScreenshotEditor({ annotations: [], selectedAnnotationId: null, notice: null }, { recordHistory: true })}
                  disabled={runtimeScreenshotEditor.annotations.length === 0 || runtimeScreenshotEditor.busy}
                >
                  Clear marks
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-3">
                <div
                  className="relative mx-auto"
                  style={{
                    width: `${runtimeScreenshotEditor.width * runtimeScreenshotEditorZoom}px`,
                    height: `${runtimeScreenshotEditor.height * runtimeScreenshotEditorZoom}px`,
                  }}
                >
                  <canvas
                    ref={setRuntimeScreenshotCanvasElement}
                    className={cn(
                      'block h-full w-full rounded-md border border-border bg-background shadow-sm',
                      runtimeScreenshotEditor.tool === 'select'
                        ? 'cursor-move'
                        : runtimeScreenshotEditor.tool === 'text'
                          ? 'cursor-text'
                          : 'cursor-crosshair'
                    )}
                    style={{ touchAction: 'none' }}
                    onPointerDown={handleRuntimeScreenshotCanvasPointerDown}
                    onPointerMove={handleRuntimeScreenshotCanvasPointerMove}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      finishRuntimeScreenshotDrawing();
                    }}
                    onPointerCancel={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      finishRuntimeScreenshotDrawing();
                    }}
                  />
                  {selectedRuntimeScreenshotAnnotation
                    && selectedRuntimeScreenshotAnnotation.type !== 'text'
                    && selectedRuntimeScreenshotAnnotation.type !== 'freehand'
                    ? selectedRuntimeScreenshotResizeHandles.map(({ handle, x, y, cursor }) => (
                      <button
                        key={`${selectedRuntimeScreenshotAnnotation.id}-${handle}`}
                        type="button"
                        className="absolute z-20 h-4 w-4 rounded-sm border border-background bg-primary shadow-[0_0_0_1px_rgba(20,184,166,0.45)]"
                        style={{
                          left: `${x * runtimeScreenshotEditorZoom - 8}px`,
                          top: `${y * runtimeScreenshotEditorZoom - 8}px`,
                          cursor,
                          touchAction: 'none',
                        }}
                        title="Drag to resize selected item"
                        onPointerDown={(event) => startRuntimeScreenshotAnnotationResize(event, selectedRuntimeScreenshotAnnotation, handle)}
                        onPointerMove={moveRuntimeScreenshotAnnotationHandleDrag}
                        onPointerUp={finishRuntimeScreenshotAnnotationHandleDrag}
                        onPointerCancel={finishRuntimeScreenshotAnnotationHandleDrag}
                      />
                    ))
                    : null}
                  {selectedRuntimeScreenshotTextAnnotation && selectedRuntimeScreenshotTextBounds ? (
                    <>
                      <textarea
                        key={selectedRuntimeScreenshotTextAnnotation.id}
                        ref={runtimeScreenshotInlineTextInputRef}
                        defaultValue={selectedRuntimeScreenshotTextAnnotation.text}
                        onChange={(event) => applyRuntimeScreenshotInlineText(event.target.value)}
                        onBlur={() => {
                          syncRuntimeScreenshotInlineText();
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerMove={(event) => event.stopPropagation()}
                        onPointerUp={(event) => event.stopPropagation()}
                        placeholder="Type text..."
                        className="absolute z-10 resize-none overflow-hidden rounded border border-primary bg-transparent px-1 py-0.5 font-sans shadow-[0_0_0_1px_rgba(20,184,166,0.25)] outline-none [scrollbar-gutter:auto] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        style={{
                          left: `${selectedRuntimeScreenshotTextBounds.left * runtimeScreenshotEditorZoom}px`,
                          top: `${selectedRuntimeScreenshotTextBounds.top * runtimeScreenshotEditorZoom}px`,
                          width: `${Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_WIDTH, runtimeScreenshotTextBoxWidth(selectedRuntimeScreenshotTextAnnotation)) * runtimeScreenshotEditorZoom}px`,
                          height: `${Math.max(RUNTIME_SCREENSHOT_TEXT_BOX_MIN_HEIGHT, runtimeScreenshotTextBoxHeight(selectedRuntimeScreenshotTextAnnotation)) * runtimeScreenshotEditorZoom}px`,
                          color: selectedRuntimeScreenshotTextAnnotation.color,
                          fontSize: `${selectedRuntimeScreenshotTextAnnotation.fontSize * runtimeScreenshotEditorZoom}px`,
                          lineHeight: '1.15',
                          WebkitAppearance: 'none',
                          appearance: 'none',
                        }}
                      />
                      <button
                        type="button"
                        ref={runtimeScreenshotTextBoxMoveHandleRef}
                        className="absolute z-20 flex h-5 w-5 cursor-move items-center justify-center rounded border border-primary bg-background/90 text-primary shadow-sm"
                        style={{
                          left: `${selectedRuntimeScreenshotTextBounds.left * runtimeScreenshotEditorZoom - 10}px`,
                          top: `${selectedRuntimeScreenshotTextBounds.top * runtimeScreenshotEditorZoom - 10}px`,
                          touchAction: 'none',
                        }}
                        title="Move text box"
                        onPointerDown={(event) => startRuntimeScreenshotTextBoxDrag(event, 'move')}
                        onPointerMove={moveRuntimeScreenshotTextBoxDrag}
                        onPointerUp={finishRuntimeScreenshotTextBoxDrag}
                        onPointerCancel={finishRuntimeScreenshotTextBoxDrag}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        ref={runtimeScreenshotTextBoxResizeHandleRef}
                        className="absolute z-20 h-4 w-4 cursor-nwse-resize rounded-sm border border-primary bg-primary shadow-sm"
                        style={{
                          left: `${selectedRuntimeScreenshotTextBounds.right * runtimeScreenshotEditorZoom - 8}px`,
                          top: `${selectedRuntimeScreenshotTextBounds.bottom * runtimeScreenshotEditorZoom - 8}px`,
                          touchAction: 'none',
                        }}
                        title="Resize text box"
                        onPointerDown={(event) => startRuntimeScreenshotTextBoxDrag(event, 'resize')}
                        onPointerMove={moveRuntimeScreenshotTextBoxDrag}
                        onPointerUp={finishRuntimeScreenshotTextBoxDrag}
                        onPointerCancel={finishRuntimeScreenshotTextBoxDrag}
                      />
                    </>
                  ) : null}
                </div>
              </div>
              {runtimeScreenshotEditor.notice ? (
                <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  {runtimeScreenshotEditor.notice}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRuntimeScreenshotEditorFullscreen(false);
                setRuntimeScreenshotEditorZoom(1);
                resetRuntimeScreenshotHistory();
                setRuntimeScreenshotEditor(null);
              }}
              disabled={runtimeScreenshotEditor?.busy}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveRuntimeScreenshotToFile(false)}
              disabled={!runtimeScreenshotEditor || runtimeScreenshotEditor.busy}
            >
              {runtimeScreenshotEditor?.busy ? 'Saving...' : 'Export'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void openRuntimeScreenshotDocumentDialog()}
              disabled={!runtimeScreenshotEditor || runtimeScreenshotEditor.busy}
            >
              {runtimeScreenshotEditor?.busy ? 'Preparing...' : 'Save to work item'}
            </Button>
            <Button
              type="button"
              onClick={() => void saveRuntimeScreenshotToFile(true)}
              disabled={!runtimeScreenshotEditor || runtimeScreenshotEditor.busy}
            >
              {runtimeScreenshotEditor?.busy ? 'Saving...' : 'Attach to prompt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runtimeScreenshotDocumentDialogOpen} onOpenChange={(open) => {
        setRuntimeScreenshotDocumentDialogOpen(open);
        if (!open && !runtimeScreenshotDocumentSaving) {
          runtimeScreenshotDocumentWorkItemsRequestRef.current += 1;
          setRuntimeScreenshotDocumentPending(null);
          setRuntimeScreenshotDocumentWorkItems([]);
          setRuntimeScreenshotDocumentWorkItemsProjectId('');
          setRuntimeScreenshotDocumentTargetWorkItemId('');
          setRuntimeScreenshotDocumentFileTitle('');
          runtimeScreenshotDocumentFileTitleRef.current = '';
          setRuntimeScreenshotDocumentError(null);
        }
      }}>
        <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-xl flex-col overflow-hidden">
          <DialogHeader className="pr-8">
            <DialogTitle>Save Screenshot To Work Item</DialogTitle>
            <DialogDescription>
              Save the annotated screenshot as a PNG, then link that saved file to a Workboard item as a document.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-md border border-border/60 bg-background p-3">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="runtime-screenshot-document-title">File name</label>
              <Input
                key={`runtime-screenshot-document-title:${runtimeScreenshotDocumentFileTitle}`}
                id="runtime-screenshot-document-title"
                className="mt-1.5"
                defaultValue={runtimeScreenshotDocumentFileTitle}
                onChange={(event) => {
                  runtimeScreenshotDocumentFileTitleRef.current = event.target.value;
                }}
                placeholder="Runtime preview screenshot"
              />
              <div className="mt-2 text-[11px] text-muted-foreground">
                The app will ask you where to save the `.png` file when you click Save screenshot. If the file is moved later, the document link will break.
              </div>
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Project</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className={cn(
                    'rounded-md border px-3 py-2 text-left text-sm',
                    runtimeScreenshotDocumentDialogMode === 'existing-project' ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                  )}
                  onClick={() => {
                    setRuntimeScreenshotDocumentDialogMode('existing-project');
                    const nextProjectId = runtimeScreenshotDocumentTargetProjectId || getDefaultSaveTargetUsageProjectId();
                    setRuntimeScreenshotDocumentTargetProjectId(nextProjectId);
                    if (nextProjectId) void loadRuntimeScreenshotDocumentWorkItemsForProject(nextProjectId);
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
                    runtimeScreenshotDocumentDialogMode === 'new-project' ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/40'
                  )}
                  onClick={() => {
                    setRuntimeScreenshotDocumentDialogMode('new-project');
                    runtimeScreenshotDocumentWorkItemsRequestRef.current += 1;
                    setRuntimeScreenshotDocumentWorkItems([]);
                    setRuntimeScreenshotDocumentWorkItemsProjectId('');
                    setRuntimeScreenshotDocumentTargetWorkItemId('__new__');
                  }}
                >
                  New project
                  <div className="mt-1 text-xs text-muted-foreground">Create a project and attach this screenshot to it.</div>
                </button>
              </div>
              {runtimeScreenshotDocumentDialogMode === 'existing-project' ? (
                <div className="mt-3 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="runtime-screenshot-document-project">Choose project</label>
                  <select
                    id="runtime-screenshot-document-project"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={runtimeScreenshotDocumentTargetProjectId}
                    onChange={(event) => {
                      const nextProjectId = event.target.value;
                      setRuntimeScreenshotDocumentTargetProjectId(nextProjectId);
                      setRuntimeScreenshotDocumentTargetWorkItemId('');
                      if (nextProjectId) void loadRuntimeScreenshotDocumentWorkItemsForProject(nextProjectId);
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
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="runtime-screenshot-document-new-project">New project name</label>
                  <Input
                    id="runtime-screenshot-document-new-project"
                    value={runtimeScreenshotDocumentNewProjectName}
                    onChange={(event) => setRuntimeScreenshotDocumentNewProjectName(event.target.value)}
                    placeholder="Budget project name"
                  />
                </div>
              )}
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Work item</div>
              {runtimeScreenshotDocumentDialogMode === 'existing-project' && runtimeScreenshotDocumentTargetProjectId ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="runtime-screenshot-document-work-item">Choose work item</label>
                  <select
                    id="runtime-screenshot-document-work-item"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={runtimeScreenshotDocumentTargetWorkItemId || '__new__'}
                    onChange={(event) => setRuntimeScreenshotDocumentTargetWorkItemId(event.target.value)}
                    disabled={runtimeScreenshotDocumentWorkItemsLoading}
                  >
                    {(runtimeScreenshotDocumentWorkItemsProjectId === runtimeScreenshotDocumentTargetProjectId ? runtimeScreenshotDocumentWorkItems : []).map((item) => (
                      <option key={item.id} value={item.id}>{item.title}{item.archived ? ' (archived)' : ''}</option>
                    ))}
                    <option value="__new__">Create new work item</option>
                  </select>
                  {runtimeScreenshotDocumentWorkItemsLoading ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading work items...
                    </div>
                  ) : null}
                  {!runtimeScreenshotDocumentWorkItemsLoading
                    && runtimeScreenshotDocumentWorkItemsProjectId === runtimeScreenshotDocumentTargetProjectId
                    && runtimeScreenshotDocumentWorkItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No work items are saved under this project yet.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Choose a project to see its work items.</div>
              )}
              {(!runtimeScreenshotDocumentWorkItemsLoading
                && (
                  runtimeScreenshotDocumentDialogMode === 'new-project'
                  || runtimeScreenshotDocumentTargetWorkItemId === '__new__'
                  || !runtimeScreenshotDocumentTargetWorkItemId
                )) ? (
                <div className="mt-3 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="runtime-screenshot-document-new-work-item">New work item title</label>
                  <Input
                    id="runtime-screenshot-document-new-work-item"
                    value={runtimeScreenshotDocumentNewWorkItemTitle}
                    onChange={(event) => setRuntimeScreenshotDocumentNewWorkItemTitle(event.target.value)}
                    placeholder="Work item title"
                  />
                </div>
              ) : null}
            </div>

            {runtimeScreenshotDocumentError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {runtimeScreenshotDocumentError}
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRuntimeScreenshotDocumentDialogOpen(false)}
              disabled={runtimeScreenshotDocumentSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveRuntimeScreenshotAsWorkItemDocument()}
              disabled={
                runtimeScreenshotDocumentSaving
                || !runtimeScreenshotDocumentPending
                || (runtimeScreenshotDocumentDialogMode === 'existing-project' && (
                  !runtimeScreenshotDocumentTargetProjectId
                  || !usageProjects.some((project) => project.id === runtimeScreenshotDocumentTargetProjectId)
                ))
                || ((runtimeScreenshotDocumentTargetWorkItemId === '__new__' || runtimeScreenshotDocumentDialogMode === 'new-project') && !runtimeScreenshotDocumentNewWorkItemTitle.trim())
              }
            >
              {runtimeScreenshotDocumentSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
              Save screenshot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BuildProjectWorkPopup
        open={projectWorkPopupOpen}
        projects={usageProjects}
        assignees={usageAssignees}
        presetProjectId={selectedPreset?.usageProjectId ?? null}
        selectedPresetName={selectedPreset?.name ?? null}
        initialProjectId={projectWorkPopupInitialProjectId}
        anchorRect={projectWorkPopupAnchorRect}
        storageScope="build-left"
        defaultSide="left"
        agentId={activeAgentId}
        onInsertPrompt={insertTextIntoBuildPrompt}
        onClose={() => setProjectWorkPopupOpen(false)}
      />
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
    </TooltipProvider>
    </GuidanceContext.Provider>
    </AnswerActionsProvider>
    </AgentCharacterProvider>
  );
}
