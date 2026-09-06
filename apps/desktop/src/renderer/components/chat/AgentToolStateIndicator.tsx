import { AgentCharacterButton } from '../agents/AgentCharacterCard';
import type { TaskActivityEvent, TaskMessage, TaskStatus } from '@accomplish/shared';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Brain,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  RotateCcw,
  Search,
  Shield,
  Terminal,
  Wrench,
} from 'lucide-react';
import { AgentAvatarIcon } from '@/components/layout/AgentAvatarPicker';
import { isAgentCharacterAvatar } from '@/lib/agent-character-gallery';
import { cn } from '@/lib/utils';

export type AgentPresenceState =
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

export type AgentToolPresence = {
  state: AgentPresenceState;
  label: string;
  detail?: string;
  icon: LucideIcon;
};

export type AgentToolActivityStep = {
  id: string;
  label: string;
  detail?: string;
  status: 'running' | 'success' | 'warning' | 'error' | 'info';
  icon: LucideIcon;
  timestamp?: string;
};

const TOOL_PROGRESS_MAP: Record<string, { label: string; icon: LucideIcon }> = {
  Read: { label: 'Reading files', icon: FileText },
  Glob: { label: 'Finding files', icon: Search },
  Grep: { label: 'Searching code', icon: Search },
  Bash: { label: 'Running command', icon: Terminal },
  Write: { label: 'Writing file', icon: FileText },
  Edit: { label: 'Editing file', icon: FileText },
  Task: { label: 'Running agent', icon: Brain },
  WebFetch: { label: 'Fetching web page', icon: Search },
  WebSearch: { label: 'Searching web', icon: Search },
  dev_browser_execute: { label: 'Executing browser action', icon: Terminal },
};

function isPictureAvatar(avatar: string | undefined, imageDataUrl: string | undefined): boolean {
  return Boolean(imageDataUrl || isAgentCharacterAvatar(avatar));
}

function describeToolInput(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const record = toolInput as Record<string, unknown>;
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (description) return description;
  const command = typeof record.command === 'string' ? record.command.trim() : '';
  if (command) return command;
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  if (path) return path;
  return '';
}

function normalizeToolName(toolName: string | null | undefined): string {
  return String(toolName || '').trim();
}

function iconForTool(toolName: string | null | undefined): LucideIcon {
  const name = normalizeToolName(toolName);
  if (TOOL_PROGRESS_MAP[name]) return TOOL_PROGRESS_MAP[name].icon;
  const normalized = name.toLowerCase();
  if (normalized.includes('web') || normalized.includes('search')) return Search;
  if (normalized.includes('browser')) return Search;
  if (normalized.includes('read') || normalized.includes('grep') || normalized.includes('glob')) return FileText;
  if (normalized.includes('write') || normalized.includes('edit')) return FileText;
  if (normalized.includes('bash') || normalized.includes('terminal') || normalized.includes('command')) return Terminal;
  if (normalized.includes('check') || normalized.includes('test') || normalized.includes('lint')) return CheckCircle2;
  if (normalized.includes('save')) return Download;
  if (normalized.includes('recover') || normalized.includes('resume')) return RotateCcw;
  return Wrench;
}

export function getAgentToolPresence(
  toolName: string | null,
  toolInput: unknown,
  status?: TaskStatus | string,
  waitingForPermission?: boolean
): AgentToolPresence {
  if (waitingForPermission) {
    return { state: 'Waiting for permission', label: 'Waiting for permission', detail: 'User action needed', icon: Shield };
  }
  if (status === 'queued') {
    return { state: 'Queued', label: 'Queued', detail: 'Waiting for the current task slot', icon: Clock };
  }
  if (!toolName) {
    return { state: 'Thinking', label: 'Thinking', icon: Brain };
  }

  const description = describeToolInput(toolInput);
  const normalized = toolName.toLowerCase();
  if (normalized.includes('websearch') || normalized.includes('webfetch') || normalized.includes('web_search') || normalized.includes('web_fetch')) {
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

export function getLatestToolPresenceFromMessages(
  messages: TaskMessage[],
  status?: TaskStatus | string,
  waitingForPermission?: boolean
): AgentToolPresence {
  if (waitingForPermission || status === 'queued') {
    return getAgentToolPresence(null, null, status, waitingForPermission);
  }
  const latestToolMessage = [...messages].reverse().find((message) => message.type === 'tool' && (message.toolName || message.content));
  if (!latestToolMessage) return getAgentToolPresence(null, null, status, false);
  const toolName = latestToolMessage.toolName || latestToolMessage.content?.match(/Using tool: ([\w:-]+)/)?.[1] || 'Tool';
  return getAgentToolPresence(toolName, latestToolMessage.toolInput, status, false);
}

function activityStatusToStepStatus(status: TaskActivityEvent['status'], kind: TaskActivityEvent['kind']): AgentToolActivityStep['status'] {
  if (kind === 'tool_started') return 'running';
  if (status === 'success') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'error') return 'error';
  if (status === 'running' || status === 'pending') return 'running';
  return 'info';
}

export function getToolActivityStepsFromActivity(
  activity: TaskActivityEvent[] | undefined,
  activeTool?: { toolName: string | null; toolInput?: unknown } | null,
  limit = 4
): AgentToolActivityStep[] {
  const steps = (activity || [])
    .filter((event) => (
      event.kind === 'tool_started'
      || event.kind === 'tool_finished'
      || event.kind === 'permission_requested'
      || event.kind === 'permission_resolved'
      || event.kind === 'memory_updated'
      || event.kind === 'skill_created'
      || event.kind === 'skill_updated'
    ))
    .slice()
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-limit)
    .map((event): AgentToolActivityStep => {
      const toolName = event.toolName || event.detail || event.title;
      return {
        id: event.id,
        label: event.title || event.kind.replace(/_/g, ' '),
        detail: event.detail || event.toolName,
        status: activityStatusToStepStatus(event.status, event.kind),
        icon: event.kind === 'permission_requested' || event.kind === 'permission_resolved'
          ? Shield
          : event.kind === 'memory_updated' || event.kind === 'skill_created' || event.kind === 'skill_updated'
            ? Brain
            : iconForTool(toolName),
        timestamp: event.timestamp,
      };
    });

  if (activeTool?.toolName && !steps.some((step) => step.status === 'running' && step.detail === activeTool.toolName)) {
    const presence = getAgentToolPresence(activeTool.toolName, activeTool.toolInput);
    steps.push({
      id: `active:${activeTool.toolName}`,
      label: presence.label,
      detail: activeTool.toolName,
      status: 'running',
      icon: presence.icon,
    });
  }

  return steps.slice(-limit);
}

export function getToolActivityStepsFromMessages(
  messages: TaskMessage[],
  aiBusy = false,
  limit = 4
): AgentToolActivityStep[] {
  const toolMessages = messages
    .filter((message) => message.type === 'tool')
    .slice(-limit);

  return toolMessages.map((message, index): AgentToolActivityStep => {
    const toolName = message.toolName || message.content?.match(/Using tool: ([\w:-]+)/)?.[1] || 'Tool';
    const isLatest = index === toolMessages.length - 1;
    return {
      id: message.id,
      label: TOOL_PROGRESS_MAP[toolName]?.label || toolName,
      detail: toolName,
      status: aiBusy && isLatest ? 'running' : 'success',
      icon: iconForTool(toolName),
      timestamp: message.timestamp,
    };
  });
}

function stateClassName(state: AgentPresenceState): string {
  return state.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function AgentToolStateIndicator({
  presence,
  activitySteps = [],
  agentName,
  agentRoleName,
  agentAvatar,
  agentAvatarColor,
  agentAvatarImageDataUrl,
  className,
  style,
  compact = false,
  testId,
}: {
  presence: AgentToolPresence;
  activitySteps?: AgentToolActivityStep[];
  agentName?: string | null;
  agentRoleName?: string | null;
  agentAvatar?: string;
  agentAvatarColor?: string;
  agentAvatarImageDataUrl?: string;
  className?: string;
  style?: CSSProperties;
  compact?: boolean;
  testId?: string;
}) {
  const PresenceIcon = presence.icon;
  const stateClass = stateClassName(presence.state);

  return (
    <div
      className={cn(
        'agent-tool-state-card flex min-w-0 flex-wrap items-start gap-2.5 rounded-2xl border border-border/70 bg-card/90 px-3 py-2 text-card-foreground shadow-sm backdrop-blur-md sm:flex-nowrap sm:items-center',
        `agent-tool-state--${stateClass}`,
        compact && 'rounded-xl px-2.5 py-2',
        className
      )}
      style={style}
      data-testid={testId}
    >
      <AgentCharacterButton aria-label={`Open agent card for ${agentName || 'Agent'}`}
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted/70',
          compact ? 'h-8 w-8' : 'h-9 w-9'
        )}
        style={{ backgroundColor: agentAvatarColor ? `${agentAvatarColor}18` : undefined }}
      >
        <AgentAvatarIcon
          avatar={agentAvatar}
          color={agentAvatarColor || 'hsl(var(--primary))'}
          imageDataUrl={agentAvatarImageDataUrl}
          className={isPictureAvatar(agentAvatar, agentAvatarImageDataUrl) ? 'h-full w-full' : compact ? 'h-4 w-4' : 'h-5 w-5'}
        />
      </AgentCharacterButton>
      <div className="agent-tool-state-orb relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/50">
        <PresenceIcon className="agent-tool-state-icon h-4 w-4 opacity-90" />
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{presence.label}</span>
          <TypingDots />
        </div>
        <div className="truncate text-xs opacity-70">
          {agentName || 'Agent'}{agentRoleName ? ` • ${agentRoleName}` : ''}{presence.detail ? ` • ${presence.detail}` : ''}
        </div>
        {activitySteps.length > 0 ? (
          <div className="agent-tool-step-strip mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {activitySteps.map((step) => {
              const StepIcon = step.icon;
              return (
                <span
                  key={step.id}
                  className={cn('agent-tool-step inline-flex min-w-0 max-w-[150px] items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', `agent-tool-step--${step.status}`)}
                  title={[step.label, step.detail].filter(Boolean).join(' - ')}
                >
                  <StepIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{step.label}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
