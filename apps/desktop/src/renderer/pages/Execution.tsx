'use client';

import { useEffect, useState, useRef, useMemo, useCallback, memo, forwardRef, useImperativeHandle, useLayoutEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '../stores/taskStore';
import { useSavedPromptsStore } from '../stores/savedPromptsStore';
import { useAgentStore } from '../stores/agentStore';
import { getAccomplish } from '../lib/accomplish';
import { springs } from '../lib/animations';
import type {
  ContextWindowEstimateResponse,
  ProviderConfig,
  SelectedModel,
  TaskMessage,
  UserSkillSharingScope,
} from '@accomplish/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { XCircle, CornerDownLeft, ArrowLeft, CheckCircle2, AlertCircle, Terminal, Wrench, FileText, Search, Code, Brain, Clock, Square, Play, Download, File, Bug, ChevronUp, ChevronDown, Trash2, Check, Folder, X, Bookmark, BookmarkCheck, Settings, User, Mic, Copy, Plus, Image, Sparkles, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { StreamingText } from '../components/ui/streaming-text';
import { isWaitingForUser } from '../lib/waiting-detection';
import SavedPromptsDialog from '../components/layout/SavedPromptsDialog';
import ContextWindowIndicator from '../components/chat/ContextWindowIndicator';
import { useVoiceWakeTalkMode } from '../hooks/useVoiceWakeTalkMode';
import { useAttachmentStore } from '../stores/attachmentStore';
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

// Debounce utility
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  }) as T;
}

function createLocalTaskMessageId(): string {
  return `local_msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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

// Helper for file operation badge colors
function getOperationBadgeClasses(operation?: string): string {
  switch (operation) {
    case 'delete': return 'bg-red-500/10 text-red-600';
    case 'overwrite': return 'bg-orange-500/10 text-orange-600';
    case 'modify': return 'bg-yellow-500/10 text-yellow-600';
    case 'create': return 'bg-green-500/10 text-green-600';
    case 'rename':
    case 'move': return 'bg-blue-500/10 text-blue-600';
    default: return 'bg-gray-500/10 text-gray-600';
  }
}

// --- FollowUpBar: isolated component that owns its own typing state ---
// By moving followUp / attachedFiles / workingFolder state here, keystrokes
// only re-render this subtree instead of the entire ExecutionPage (which
// includes the expensive message list).

interface FollowUpBarHandle {
  setValue: (text: string) => void;
  focus: () => void;
}

interface FollowUpBarProps {
  isLoading: boolean;
  hasSession: boolean;
  currentTaskStatus: string;
  promptsCount: number;
  onSend: (message: string, files?: string[], workingFolder?: string | null, privacyMode?: 'normal' | 'incognito') => Promise<void>;
  onOpenSavedPrompts: (mode: 'select' | 'manage') => void;
  onPlanNextJobs?: () => Promise<void>;
  planningJobs?: boolean;
  taskId?: string;
  agentId?: string;
  privacyMode?: 'normal' | 'incognito';
  onPrivacyModeChange?: (mode: 'normal' | 'incognito') => void;
}

const FollowUpBar = forwardRef<FollowUpBarHandle, FollowUpBarProps>(
  function FollowUpBar(
    { isLoading, hasSession, currentTaskStatus, promptsCount, onSend, onOpenSavedPrompts, onPlanNextJobs, planningJobs, taskId, agentId, privacyMode = 'normal', onPrivacyModeChange },
    ref
  ) {
    const [followUp, setFollowUp] = useState('');
    const [contextStats, setContextStats] = useState<ContextWindowEstimateResponse | null>(null);
    const attachedFiles = useAttachmentStore((state) => state.files);
    const addAttachedFiles = useAttachmentStore((state) => state.addFiles);
    const removeAttachedFile = useAttachmentStore((state) => state.removeFile);
    const clearAttachedFiles = useAttachmentStore((state) => state.clearFiles);
    const [workingFolder, setWorkingFolder] = useState<string | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const resizeRafRef = useRef<number>(0);
    const accomplish = getAccomplish();

    useImperativeHandle(ref, () => ({
      setValue: (text: string) => {
        setFollowUp(text);
      },
      focus: () => {
        inputRef.current?.focus();
      },
    }));

    // Auto-focus on mount
    useEffect(() => {
      inputRef.current?.focus();
    }, []);

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
      await onSend(message, files, workingFolder, privacyMode);
      setFollowUp('');
      clearAttachedFiles();
      setWorkingFolder(null);
    }, [followUp, attachedFiles, workingFolder, onSend, clearAttachedFiles]);

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
      onChange: setFollowUp,
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
      <div className="flex-shrink-0 border-t border-border bg-card/50 px-6 py-4">
        <div className="max-w-5xl mx-auto space-y-2">
          <div className="flex items-center justify-between gap-2">
            <ContextWindowIndicator stats={contextStats} />
            {privacyMode === 'incognito' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                <Shield className="h-3 w-3" />
                Incognito (not saved)
              </span>
            )}
          </div>
          {privacyMode === 'incognito' && (
            <p className="text-[11px] text-muted-foreground">
              Chat content is not saved. Usage totals still include this session.
            </p>
          )}
          {/* Input field with Ideas/Send buttons */}
          <div className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={(e) => {
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
              className="followup-textarea-scrollbar min-h-[40px] max-h-[120px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 leading-relaxed"
              data-testid="execution-follow-up-input"
            />
            {onPlanNextJobs && (
              <Button
                onClick={() => void onPlanNextJobs()}
                disabled={isLoading || Boolean(planningJobs)}
                variant="outline"
                title="Ask Deskmate for ideas based on your memory"
              >
                <Sparkles className={`h-4 w-4 ${planningJobs ? 'mr-1.5' : ''}`} />
                {planningJobs ? (
                  <span className="inline-flex items-center gap-2">
                    Thinking
                    <TypingDots />
                  </span>
                ) : null}
              </Button>
            )}
            <Button
              onClick={() => void handleSubmit()}
              disabled={!followUp.trim() || isLoading}
              variant="outline"
            >
              <CornerDownLeft className="h-4 w-4 mr-1.5" />
              {hasSession || currentTaskStatus === 'interrupted' ? 'Send' : 'Start'}
            </Button>
          </div>

          {/* Action buttons under prompt input */}
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={isLoading}
                  className="flex items-center gap-1.5 shrink-0 px-2.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 hover:border-border"
                  title="Add files"
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

            <button
              type="button"
              onClick={handleSelectFolder}
              disabled={isLoading}
              className="flex items-center gap-1.5 shrink-0 px-2.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 hover:border-border"
              title="Select a working folder"
            >
              <Folder className="h-3.5 w-3.5" />
              <span>Work in folder</span>
            </button>

            {onPrivacyModeChange && (
              <button
                type="button"
                onClick={() => onPrivacyModeChange(privacyMode === 'incognito' ? 'normal' : 'incognito')}
                disabled={isLoading}
                className={`flex items-center gap-1.5 shrink-0 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 border ${
                  privacyMode === 'incognito'
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700'
                    : 'border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/60 hover:border-border'
                }`}
                title="Toggle incognito mode for this task/session"
              >
                <Shield className="h-3.5 w-3.5" />
                <span>{privacyMode === 'incognito' ? 'Incognito on' : 'Incognito'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenSavedPrompts('select')}
              disabled={isLoading || promptsCount === 0}
              className="flex items-center gap-1.5 shrink-0 px-2.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 hover:border-border"
              title={promptsCount === 0 ? 'No saved prompts' : 'Use a saved prompt'}
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
              className="flex items-center gap-1.5 shrink-0 px-2.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 hover:border-border"
              title="Manage saved prompts"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={toggleVoiceWake}
              disabled={voiceToggleBusy || isLoading || !voiceAccessKeySet || talkModeActive}
              className={`flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                voiceEnabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted/40 text-muted-foreground'
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
  const accomplish = getAccomplish();
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const followUpBarRef = useRef<FollowUpBarHandle>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<'normal' | 'incognito'>('normal');
  const [taskRunCount, setTaskRunCount] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [currentToolInput, setCurrentToolInput] = useState<unknown>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugModeEnabled, setDebugModeEnabled] = useState(false);
  const [debugExported, setDebugExported] = useState(false);
  const [planningJobs, setPlanningJobs] = useState(false);
  const [globalSelectedModel, setGlobalSelectedModel] = useState<SelectedModel | null>(null);
  const [modelProviders, setModelProviders] = useState<ProviderConfig[]>([]);
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
  const debugPanelRef = useRef<HTMLDivElement>(null);
  const addAttachedFiles = useAttachmentStore((state) => state.addFiles);
  const autoFollowUpSentRef = useRef<Set<string>>(new Set());
  const { agents, activeAgentId, loadAgents } = useAgentStore();

  const {
    currentTask,
    loadTaskById,
    isLoading,
    error,
    addTaskUpdate,
    addTaskUpdateBatch,
    updateTaskStatus,
    setPermissionRequest,
    permissionRequest,
    respondToPermission,
    sendFollowUp,
    startTask,
    interruptTask,
    setupProgress,
    setupProgressTaskId,
    setupDownloadStep,
  } = useTaskStore();

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
  const saveSkillOwnerAgentId = String(taskAgentId || activeAgentId || '').trim();
  const saveSkillSelectableAgents = useMemo(
    () => agents.filter((agent) => agent.id !== saveSkillOwnerAgentId),
    [agents, saveSkillOwnerAgentId]
  );

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

  const updateScrollDownVisibility = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) {
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= 120;
    isNearBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    updateScrollDownVisibility();
  }, [updateScrollDownVisibility]);

  const scrollToBottomNow = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Debounced scroll function
  const scrollToBottom = useMemo(
    () =>
      debounce(() => {
        scrollToBottomNow('smooth');
      }, 100),
    [scrollToBottomNow]
  );

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
    let cancelled = false;
    const loadModelState = async () => {
      try {
        const [selectedModelRaw, providersRaw] = await Promise.all([
          accomplish.getSelectedModel(),
          accomplish.listModelProviders(),
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
      } catch {
        if (cancelled) return;
        setGlobalSelectedModel(null);
        setModelProviders([]);
      }
    };

    void loadModelState();
    return () => {
      cancelled = true;
    };
  }, [accomplish]);

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

    const unsubscribePermission = accomplish.onPermissionRequest((request) => {
      setPermissionRequest(request);
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
      unsubscribeTaskBatch?.();
      unsubscribePermission();
      unsubscribeStatusChange?.();
      unsubscribeDebugLog();
    };
  }, [id, loadTaskById, addTaskUpdate, addTaskUpdateBatch, updateTaskStatus, setPermissionRequest, accomplish]);

  // Increment counter when task starts/resumes
  useEffect(() => {
    if (currentTask?.status === 'running') {
      setTaskRunCount((c) => c + 1);
    }
  }, [currentTask?.status]);

  // Auto-scroll to bottom (debounced for performance)
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
      return;
    }
    updateScrollDownVisibility();
  }, [currentTask?.messages?.length, scrollToBottom, updateScrollDownVisibility]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateScrollDownVisibility();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentTask?.id, currentTask?.status, updateScrollDownVisibility]);

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
  const canInlinePrompt = isComplete;

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

    const draftResponse = await accomplish.generateUserSkillFromTask({
      taskId: currentTask.id,
      agentId: currentTask.agentId ?? undefined,
    });
    if (!draftResponse.ok || !draftResponse.draft) {
      throw new Error(draftResponse.error || 'Failed to generate skill draft.');
    }
    const draft = draftResponse.draft;

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
    mode: 'normal' | 'incognito' = privacyMode
  ) => {
    if (!currentTask) return;
    if (hasSession || currentTask.status === 'interrupted') {
      await sendFollowUp(message, files);
    } else {
      const task = await startTask({
        prompt: message,
        taskId: currentTask.id,
        workingDirectory: folder ?? undefined,
        attachedFiles: files,
        privacyMode: mode,
      });
      if (task && task.id !== currentTask.id) {
        navigate(`/execution/${task.id}`);
      }
    }
  }, [currentTask, hasSession, navigate, privacyMode, sendFollowUp, startTask]);

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
  const [promptToSave, setPromptToSave] = useState<string | null>(null);
  const [savePromptTitle, setSavePromptTitle] = useState('');
  const [showSavePromptDialog, setShowSavePromptDialog] = useState(false);
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

  const handlePermissionResponse = async (decision: 'allow' | 'allow_all' | 'deny') => {
    if (!permissionRequest || !currentTask) return;
    await respondToPermission({
      requestId: permissionRequest.id,
      taskId: permissionRequest.taskId,
      decision,
    });
  };

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

  const getStatusBadge = () => {
    switch (currentTask.status) {
      case 'queued':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 shrink-0">
            <Clock className="h-3 w-3" />
            Queued
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 shrink-0">
            <span
              className="animate-shimmer bg-gradient-to-r from-primary via-primary/50 to-primary bg-[length:200%_100%] bg-clip-text text-transparent"
            >
              Running
            </span>
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-600 shrink-0">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive shrink-0">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground shrink-0">
            <XCircle className="h-3 w-3" />
            Cancelled
          </span>
        );
      case 'interrupted':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 shrink-0">
            <Square className="h-3 w-3" />
            Stopped
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground shrink-0">
            {currentTask.status}
          </span>
        );
    }
  };

  const taskAgentName =
    agents.find((agent) => agent.id === taskAgentId)?.name || taskAgentId;
  const taskAgent = agents.find((agent) => agent.id === taskAgentId);
  const effectiveSelectedModel = taskAgent?.selectedModel ?? globalSelectedModel;
  const getModelBadgeLabel = () => {
    const selected = effectiveSelectedModel as (SelectedModel & { id?: string }) | null | undefined;
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
  };
  const modelBadgeLabel = getModelBadgeLabel();
  const getModelBadge = () => {
    if (!modelBadgeLabel) return null;
    return (
      <span
        data-testid="execution-model-badge"
        title={modelBadgeLabel}
        className="inline-flex max-w-[300px] items-center gap-1.5 truncate px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground shrink-0"
      >
        <Code className="h-3 w-3 shrink-0" />
        <span className="truncate">Model: {modelBadgeLabel}</span>
      </span>
    );
  };
  const getAgentBadge = () => {
    if (!taskAgentId) return null;
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground shrink-0">
        <User className="h-3 w-3" />
        Agent: {taskAgentName}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Task header */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-6 py-4">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="shrink-0 no-drag"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <h1 className="text-base font-medium text-foreground truncate min-w-0">
                {currentTask.prompt}
              </h1>
              <span data-testid="execution-status-badge">
                {getStatusBadge()}
              </span>
              {getModelBadge()}
              {planningJobs && (
                <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary shrink-0">
                  <Sparkles className="h-3 w-3" />
                  Planning
                  <TypingDots className="text-primary" />
                </span>
              )}
              {getAgentBadge()}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
              <FileText className="h-4 w-4 mr-2" />
              Save as skill
            </Button>
          </div>
        </div>
      </div>

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
          className="flex-1 flex flex-col items-center justify-center gap-6 px-6"
        >
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
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          <div className="max-w-5xl mx-auto space-y-4">
            {currentTask.messages
              .filter((m) => !(m.type === 'tool' && m.toolName?.toLowerCase() === 'bash'))
              .map((message, index) => (
              <MessageBubble key={`${message.id}-${index}`} message={message} onSavePrompt={handleSavePrompt} debugMode={debugModeEnabled} />
            ))}

            {/* Inline waiting indicator */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.gentle}
              className="flex flex-col items-center gap-4 py-8"
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

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Messages - normal state (running, completed, failed, etc.) */}
      {currentTask.status !== 'queued' && (
        <div
          ref={messagesScrollRef}
          onScroll={handleMessagesScroll}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          <div className="max-w-5xl mx-auto space-y-4">
            {(() => {
              // Filter out Bash tool messages EXCEPT keep the last one if it's the final message
              // This ensures we show the answer when Gemini doesn't emit a final text message
              const messages = currentTask.messages;
              const lastMessage = messages[messages.length - 1];
              const isLastMessageBashTool = lastMessage?.type === 'tool' && lastMessage?.toolName?.toLowerCase() === 'bash';
              const taskIsComplete = ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentTask.status);

              const filtered = messages.filter((m, index) => {
                // Always show non-bash-tool messages
                if (!(m.type === 'tool' && m.toolName?.toLowerCase() === 'bash')) {
                  return true;
                }
                // Show the last bash tool message if task is complete and it's the final message
                // This ensures the answer is visible when Gemini doesn't emit a final text
                if (taskIsComplete && isLastMessageBashTool && index === messages.length - 1) {
                  return true;
                }
                return false;
              });
              return filtered;
            })()
              .map((message, index, filteredMessages) => {
              const isLastMessage = index === filteredMessages.length - 1;
              const isLastAssistantMessage =
                message.type === 'assistant' && isLastMessage;
              // Find the last assistant message index for the continue button
              let lastAssistantIndex = -1;
              for (let i = filteredMessages.length - 1; i >= 0; i--) {
                if (filteredMessages[i].type === 'assistant') {
                  lastAssistantIndex = i;
                  break;
                }
              }
              const isLastAssistantForContinue = index === lastAssistantIndex;
              // Show continue button on last assistant message when:
              // - Task was interrupted (user can always continue)
              // - Task completed AND the message indicates agent is waiting for user action
              const showContinue = isLastAssistantForContinue && !!hasSession &&
                (currentTask.status === 'interrupted' ||
                 (currentTask.status === 'completed' && isWaitingForUser(message.content)));
              return (
                <MessageBubble
                  key={`${message.id}-${index}`}
                  message={message}
                  shouldStream={isLastAssistantMessage && currentTask.status === 'running'}
                  isLastMessage={isLastMessage}
                  isRunning={currentTask.status === 'running'}
                  showContinueButton={showContinue}
                  continueLabel={currentTask.status === 'interrupted' ? 'Continue' : 'Done, Continue'}
                  onContinue={handleContinue}
                  isLoading={isLoading}
                  onSavePrompt={handleSavePrompt}
                  debugMode={debugModeEnabled}
                />
              );
            })}

            <AnimatePresence>
              {currentTask.status === 'running' && !permissionRequest && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={springs.gentle}
                  className="flex items-center gap-2 text-muted-foreground py-2"
                  data-testid="execution-thinking-indicator"
                >
                  <TypingDots />
                  <span className="text-sm">
                    {currentTool
                      ? ((currentToolInput as { description?: string })?.description || TOOL_PROGRESS_MAP[currentTool]?.label || currentTool)
                      : 'Thinking...'}
                  </span>
                  {currentTool && !(currentToolInput as { description?: string })?.description && (
                    <span className="text-xs text-muted-foreground/60">
                      ({currentTool})
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      <AnimatePresence>
        {showScrollToBottom && currentTask.messages.length > 0 && (
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

      {/* Permission Request Modal */}
      <AnimatePresence>
        {permissionRequest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            data-testid="execution-permission-modal"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={springs.bouncy}
            >
              <Card className="w-full max-w-lg p-6 mx-4">
                <div className="flex items-start gap-4">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full shrink-0",
                    permissionRequest.type === 'file' ? "bg-amber-500/10" : "bg-warning/10"
                  )}>
                    {permissionRequest.type === 'file' ? (
                      <File className="h-5 w-5 text-amber-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-warning" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {permissionRequest.type === 'file' ? 'File Permission Required' : 'Permission Required'}
                    </h3>

                    {/* File permission specific UI */}
                    {permissionRequest.type === 'file' && (
                      <>
                        <div className="mb-3">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                            getOperationBadgeClasses(permissionRequest.fileOperation)
                          )}>
                            {permissionRequest.fileOperation?.toUpperCase()}
                          </span>
                        </div>

                        <div className="mb-4 p-3 rounded-lg bg-muted">
                          <p className="text-sm font-mono text-foreground break-all">
                            {permissionRequest.filePath}
                          </p>
                          {permissionRequest.targetPath && (
                            <p className="text-sm font-mono text-muted-foreground mt-1">
                              → {permissionRequest.targetPath}
                            </p>
                          )}
                        </div>

                        {permissionRequest.contentPreview && (
                          <details className="mb-4">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              Preview content
                            </summary>
                            <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-x-auto max-h-32 overflow-y-auto">
                              {permissionRequest.contentPreview}
                            </pre>
                          </details>
                        )}
                      </>
                    )}

                    {/* Standard question/tool UI */}
                    {permissionRequest.type !== 'file' && (
                      <>
                        <p className="text-sm text-muted-foreground mb-4">
                          {permissionRequest.question || `Allow ${permissionRequest.toolName}?`}
                        </p>
                        {permissionRequest.toolName && (
                          <div className="mb-4 p-3 rounded-lg bg-muted text-xs font-mono overflow-x-auto">
                            <p className="text-muted-foreground mb-1">Tool: {permissionRequest.toolName}</p>
                            <pre className="text-foreground">
                              {JSON.stringify(permissionRequest.toolInput, null, 2)}
                            </pre>
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={() => handlePermissionResponse('deny')}
                        className="flex-1"
                        data-testid="permission-deny-button"
                      >
                        Deny
                      </Button>
                      {permissionRequest.type === 'file' && (
                        <Button
                          variant="outline"
                          onClick={() => handlePermissionResponse('allow_all')}
                          className="flex-1"
                          data-testid="permission-allow-all-button"
                        >
                          Allow all (this task)
                        </Button>
                      )}
                      <Button
                        onClick={() => handlePermissionResponse('allow')}
                        className="flex-1"
                        data-testid="permission-allow-button"
                      >
                        Allow
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          </motion.div>
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

{/* Running state input with Stop button */}
      {currentTask.status === 'running' && !permissionRequest && (
        <div className="flex-shrink-0 border-t border-border bg-card/50 px-6 py-4">
          <div className="max-w-5xl mx-auto flex gap-3">
            <Input
              placeholder="Agent is working..."
              disabled
              className="flex-1 opacity-50"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={interruptTask}
              title="Stop agent (Ctrl+C)"
              className="shrink-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
              data-testid="execution-stop-button"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          </div>
        </div>
      )}

      {/* Follow-up input */}
      {canInlinePrompt && (
        <FollowUpBar
          ref={followUpBarRef}
          isLoading={isLoading}
          hasSession={!!hasSession}
          currentTaskStatus={currentTask.status}
          promptsCount={prompts.length}
          onSend={handleFollowUpSend}
          onPlanNextJobs={handlePlanNextJobs}
          planningJobs={planningJobs}
          taskId={currentTask.id}
          agentId={currentTask.agentId}
          privacyMode={privacyMode}
          onPrivacyModeChange={setPrivacyMode}
          onOpenSavedPrompts={(mode) => {
            setSavedPromptsMode(mode);
            setShowSavedPromptsSelector(true);
          }}
        />
      )}

      {/* Saved Prompts Selector Dialog */}
      <SavedPromptsDialog
        open={showSavedPromptsSelector}
        onOpenChange={setShowSavedPromptsSelector}
        onSelectPrompt={handleSelectSavedPrompt}
        mode={savedPromptsMode}
      />

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
        <div className="flex-shrink-0 border-t border-border bg-card/50 px-6 py-4 text-center">
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
  debugMode?: boolean;
}

// Memoized MessageBubble to prevent unnecessary re-renders and markdown re-parsing
const MessageBubble = memo(function MessageBubble({ message, shouldStream = false, isLastMessage = false, isRunning = false, showContinueButton = false, continueLabel, onContinue, isLoading = false, onSavePrompt, debugMode = false }: MessageBubbleProps) {
  const [streamComplete, setStreamComplete] = useState(!shouldStream);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const expandableMeasureRef = useRef<HTMLElement | null>(null);
  const isUser = message.type === 'user';
  const isTool = message.type === 'tool';
  const isSystem = message.type === 'system';
  const isAssistant = message.type === 'assistant';
  const toolContent = message.content?.trim() ?? '';
  const showToolOutput = isTool
    && toolContent.length > 0
    && !/^using tool:/i.test(toolContent)
    && !/^tool\s+.+\s+(completed|error)$/i.test(toolContent);

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
    'text-sm prose prose-sm max-w-none',
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
    'prose-hr:border-border'
  );

  const handleCopyToClipboard = useCallback(async (preferRichHtml: boolean) => {
    try {
      if (preferRichHtml) {
        const html = contentRef.current?.innerHTML || message.content;
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([message.content], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(message.content);
      }
    } catch {
      // Fallback to plain text when rich copy is unavailable
      await navigator.clipboard.writeText(message.content);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 transition-colors duration-150',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isTool
              ? 'bg-muted border border-border'
              : isSystem
              ? 'bg-muted/50 border border-border'
              : 'bg-card border border-border',
          (isAssistant || isUser) && 'group'
        )}
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
            ) : (
              <>
                {isAssistant && shouldStream && !streamComplete ? (
                  <StreamingText
                    text={message.content}
                    speed={120}
                    isComplete={streamComplete}
                    onComplete={() => setStreamComplete(true)}
                  >
                    {(streamedText) => (
                      <div ref={contentRef} className={proseClasses}>
                        <ReactMarkdown>{streamedText}</ReactMarkdown>
                      </div>
                    )}
                  </StreamingText>
                ) : (
                  <div ref={isAssistant ? contentRef : undefined} className={proseClasses}>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                )}
                {isAssistant ? (
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyToClipboard(true)}
                      className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={copied ? 'Copied!' : 'Copy to clipboard'}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs mt-1.5 text-muted-foreground">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </p>
                )}
              </>
            )}
            {/* Continue button inside assistant bubble */}
            {isAssistant && showContinueButton && onContinue && (
              <Button
                size="sm"
                onClick={onContinue}
                disabled={isLoading}
                className="mt-3 gap-1.5"
              >
                <Play className="h-3 w-3" />
                {continueLabel || 'Continue'}
              </Button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}, (prev, next) => prev.message.id === next.message.id && prev.shouldStream === next.shouldStream && prev.isLastMessage === next.isLastMessage && prev.isRunning === next.isRunning && prev.showContinueButton === next.showContinueButton && prev.isLoading === next.isLoading && prev.debugMode === next.debugMode);
