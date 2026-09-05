'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Sparkles } from 'lucide-react';
import type { AgentAppearance } from '@accomplish/shared';
import { cn } from '@/lib/utils';
import {
  CHAT_BACKGROUND_CHANGED_EVENT,
  CHAT_BACKGROUND_STORAGE_KEY,
  CHAT_BACKGROUNDS,
  DEFAULT_CHAT_BACKGROUND_ID,
  getChatBackground,
  normalizeChatBackgroundId,
  readChatBackgroundId,
  writeChatBackgroundId,
} from '@/lib/chat-backgrounds';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { APP_COMMAND_EVENTS } from '@/lib/app-commands';
import { AgentAvatarIcon } from '@/components/layout/AgentAvatarPicker';
import { isAgentCharacterAvatar } from '@/lib/agent-character-gallery';

const AGENT_AVATAR_FRAME_OPTIONS = ['none', 'soft', 'circle', 'badge'] as const;
const AGENT_ANSWER_STYLE_OPTIONS = ['balanced', 'concise', 'detailed', 'playful'] as const;
const AGENT_PRESENCE_ANIMATION_OPTIONS = ['none', 'pulse', 'glow', 'typing'] as const;
const AGENT_REACTION_MODE_OPTIONS = ['off', 'minimal', 'standard', 'playful'] as const;
const AGENT_ACCENT_SWATCHES = [
  '#14b8a6',
  '#38bdf8',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#64748b',
] as const;

function getAvatarFrameClass(frame: string | undefined): string {
  if (frame === 'circle') return 'rounded-full';
  if (frame === 'badge') return 'rounded-2xl ring-2 ring-offset-2 ring-offset-background';
  if (frame === 'soft') return 'rounded-2xl';
  return 'rounded-xl';
}

function getAnswerStylePreviewClass(style: string | undefined): string {
  if (style === 'concise') return 'px-2 py-1 text-[10px]';
  if (style === 'detailed') return 'px-3 py-2 text-[11px]';
  if (style === 'playful') return 'px-2.5 py-1.5 text-[11px] shadow-[0_8px_24px_rgba(20,184,166,0.18)]';
  return 'px-2.5 py-1.5 text-[11px]';
}

function getPresenceAnimationPreviewClass(animation: string | undefined): string {
  if (animation === 'pulse') return 'animate-pulse';
  if (animation === 'glow') return 'shadow-[0_0_18px_rgba(20,184,166,0.42)]';
  if (animation === 'typing') return 'animate-bounce';
  return '';
}

function InfoTip({ text, content }: { text?: string; content?: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          aria-label="More info"
          onClick={(event) => event.stopPropagation()}
        >
          i
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-xs leading-relaxed text-foreground" align="start" sideOffset={6}>
        {content ?? text}
      </PopoverContent>
    </Popover>
  );
}

function InfoHeading({
  children,
  info,
  className,
}: {
  children: ReactNode;
  info: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center', className)}>
      <span>{children}</span>
      <InfoTip content={info} />
    </div>
  );
}

export function useChatBackgroundSelection() {
  const [selectedId, setSelectedIdState] = useState(readChatBackgroundId);

  useEffect(() => {
    const handleBackgroundChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const nextId = typeof detail?.id === 'string' ? detail.id : readChatBackgroundId();
      setSelectedIdState(normalizeChatBackgroundId(nextId));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CHAT_BACKGROUND_STORAGE_KEY) {
        setSelectedIdState(normalizeChatBackgroundId(event.newValue));
      }
    };
    window.addEventListener(CHAT_BACKGROUND_CHANGED_EVENT, handleBackgroundChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(CHAT_BACKGROUND_CHANGED_EVENT, handleBackgroundChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setSelectedId = useCallback((id: string) => {
    const normalized = normalizeChatBackgroundId(id);
    setSelectedIdState(normalized);
    writeChatBackgroundId(normalized);
  }, []);

  const selectedBackground = getChatBackground(selectedId);
  const backgroundStyle = useMemo<CSSProperties>(() => {
    if (!selectedBackground) return {};
    return {
      backgroundImage: `linear-gradient(135deg, hsl(var(--background) / 0.22), hsl(var(--background) / 0.38)), url("${selectedBackground.src}")`,
      backgroundPosition: 'center',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
    };
  }, [selectedBackground]);

  return {
    selectedId,
    selectedBackground,
    backgroundStyle,
    setSelectedId,
  };
}

type ChatBackgroundSwitcherProps = {
  selectedId: string;
  onSelect: (id: string) => void;
  appearance?: AgentAppearance | null;
  onAppearanceChange?: (patch: Partial<AgentAppearance>) => void;
  agentAvatar?: string;
  agentAvatarColor?: string;
  agentAvatarImageDataUrl?: string;
  className?: string;
};

export default function ChatBackgroundSwitcher({
  selectedId,
  onSelect,
  appearance,
  onAppearanceChange,
  agentAvatar,
  agentAvatarColor,
  agentAvatarImageDataUrl,
  className,
}: ChatBackgroundSwitcherProps) {
  const normalizedSelectedId = normalizeChatBackgroundId(selectedId);
  const [open, setOpen] = useState(false);
  const accentValue = typeof appearance?.accentColor === 'string' ? appearance.accentColor : '';
  const avatarFrameValue = appearance?.avatarFrame || 'none';
  const answerStyleValue = appearance?.answerStyle || 'balanced';
  const presenceAnimationValue = appearance?.presenceAnimation || 'none';
  const reactionModeValue = appearance?.reactionMode || 'minimal';
  const showAvatarOnAnswersValue = appearance?.showAvatarOnAnswers !== false;
  const previewAccentColor = /^#[0-9a-f]{6}$/i.test(accentValue) ? accentValue : '#14b8a6';

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(APP_COMMAND_EVENTS.backgroundPickerOpen, handleOpen);
    return () => window.removeEventListener(APP_COMMAND_EVENTS.backgroundPickerOpen, handleOpen);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'absolute right-6 top-4 z-30 rounded-full border border-border/25 bg-background/24 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em]',
            'text-foreground/55 shadow-sm shadow-black/10 backdrop-blur-sm transition-all duration-200',
            'hover:border-border/45 hover:bg-background/42 hover:text-foreground/80',
            'focus:outline-none focus:ring-2 focus:ring-primary/30',
            '[text-shadow:0_1px_7px_rgb(0_0_0_/_0.34)]',
            className
          )}
          aria-label="Choose this agent's chat appearance"
          title="Choose this agent's chat appearance"
        >
          Appearance
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="w-[430px] overflow-hidden p-0"
        style={{ maxHeight: 'min(660px, calc(var(--radix-popover-content-available-height) - 8px))' }}
      >
        <div className="flex max-h-[inherit] flex-col p-3">
          <div className="mb-3 shrink-0">
            <InfoHeading
              className="text-sm font-semibold text-foreground"
              info="These settings change how Chat Mode looks for the current agent only. They do not change the agent's model, tools, permissions, memory, or system prompt."
            >
              Agent appearance
            </InfoHeading>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Changes how Chat Mode looks for the current agent. It does not change the model, tools, or prompt.
            </p>
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            <section className="space-y-2">
              <InfoHeading
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                info="Chooses the Chat Mode background for this agent. If no background is set, the normal dark or light theme background is used. It only changes the chat area background, not chat bubbles or app settings."
              >
                Background
              </InfoHeading>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(DEFAULT_CHAT_BACKGROUND_ID)}
                  className={cn(
                    'group relative overflow-hidden rounded-lg border p-2 text-left transition-colors',
                    normalizedSelectedId === DEFAULT_CHAT_BACKGROUND_ID
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border bg-background hover:border-primary/40'
                  )}
                >
                  <div className="mb-2 h-20 rounded-md border border-border/70 bg-gradient-to-br from-background via-muted/40 to-background" />
                  <div className="text-xs font-medium text-foreground">Default theme</div>
                  <div className="text-[11px] text-muted-foreground">Dark or light theme background</div>
                  {normalizedSelectedId === DEFAULT_CHAT_BACKGROUND_ID ? (
                    <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </button>

                {CHAT_BACKGROUNDS.map((background) => {
                  const selected = normalizedSelectedId === background.id;
                  return (
                    <button
                      key={background.id}
                      type="button"
                      onClick={() => onSelect(background.id)}
                      className={cn(
                        'group relative overflow-hidden rounded-lg border p-2 text-left transition-colors',
                        selected
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-border bg-background hover:border-primary/40'
                      )}
                      title={background.label}
                    >
                      <img
                        src={background.src}
                        alt={background.label}
                        className="mb-2 h-20 w-full rounded-md border border-border/70 object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                      <div className="truncate text-xs font-medium text-foreground">{background.label}</div>
                      {selected ? (
                        <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            {onAppearanceChange ? (
              <section className="space-y-3 rounded-xl border border-border/70 bg-card/60 p-3">
                <InfoHeading
                  className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  info="Controls the visual style of this agent's answers, including avatar frame, answer bubble style, working-state animation, accent color, and whether avatars appear on answer bubbles."
                >
                  Answer appearance
                </InfoHeading>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <InfoHeading
                    info="Changes the frame shape around this agent's avatar where it appears in Chat Mode, such as answer bubbles and avatar previews. It does not change the avatar image itself."
                  >
                    Avatar frame
                  </InfoHeading>
                  <div className="flex items-center gap-2">
                    <select
                      value={avatarFrameValue}
                      onChange={(event) => onAppearanceChange({ avatarFrame: event.target.value === 'none' ? undefined : event.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      {AGENT_AVATAR_FRAME_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'none' ? 'Default' : option}
                        </option>
                      ))}
                    </select>
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border border-border/70 bg-muted/70',
                        getAvatarFrameClass(avatarFrameValue)
                      )}
                      style={{
                        backgroundColor: agentAvatarColor ? `${agentAvatarColor}18` : `${previewAccentColor}18`,
                        boxShadow: avatarFrameValue === 'badge' ? `0 0 0 2px ${previewAccentColor}55` : undefined,
                      }}
                      title={`Avatar frame preview: ${avatarFrameValue === 'none' ? 'Default' : avatarFrameValue}`}
                    >
                      <AgentAvatarIcon
                        avatar={agentAvatar}
                        color={agentAvatarColor || previewAccentColor}
                        imageDataUrl={agentAvatarImageDataUrl}
                        className={(agentAvatarImageDataUrl || isAgentCharacterAvatar(agentAvatar)) ? 'h-full w-full' : 'h-5 w-5'}
                      />
                    </div>
                  </div>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <InfoHeading
                    info="Changes the visual density and tone of this agent's answer bubbles. It is appearance-only and does not change the answer content or model behavior."
                  >
                    Answer style
                  </InfoHeading>
                  <div className="flex items-center gap-2">
                    <select
                      value={answerStyleValue}
                      onChange={(event) => onAppearanceChange({ answerStyle: event.target.value === 'balanced' ? undefined : event.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      {AGENT_ANSWER_STYLE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'balanced' ? 'Default' : option}
                        </option>
                      ))}
                    </select>
                    <div
                      className={cn('w-28 shrink-0 rounded-xl border bg-card text-card-foreground', getAnswerStylePreviewClass(answerStyleValue))}
                      style={{
                        borderColor: `${previewAccentColor}55`,
                        boxShadow: answerStyleValue === 'playful' ? `0 10px 28px ${previewAccentColor}22` : undefined,
                      }}
                      title={`Answer style preview: ${answerStyleValue === 'balanced' ? 'Default' : answerStyleValue}`}
                    >
                      <div className="truncate font-semibold">Answer</div>
                      <div className="mt-0.5 h-1 w-16 rounded-full bg-muted-foreground/25" />
                    </div>
                  </div>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <InfoHeading
                    info="Controls how much animation appears for this agent's factual working states, such as thinking, searching, or writing. Reduced-motion settings still take priority."
                  >
                    Presence animation
                  </InfoHeading>
                  <div className="flex items-center gap-2">
                    <select
                      value={presenceAnimationValue}
                      onChange={(event) => onAppearanceChange({ presenceAnimation: event.target.value === 'none' ? undefined : event.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      {AGENT_PRESENCE_ANIMATION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'none' ? 'Default' : option}
                        </option>
                      ))}
                    </select>
                    <div
                      className="flex h-10 w-28 shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-card px-2 text-card-foreground"
                      title={`Presence animation preview: ${presenceAnimationValue === 'none' ? 'Default' : presenceAnimationValue}`}
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/60',
                          getPresenceAnimationPreviewClass(presenceAnimationValue)
                        )}
                        style={{
                          color: previewAccentColor,
                          boxShadow: presenceAnimationValue === 'glow' ? `0 0 16px ${previewAccentColor}66` : undefined,
                        }}
                      >
                        <Sparkles className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 truncate text-[11px] font-semibold">
                        {presenceAnimationValue === 'typing' ? 'Typing...' : 'Working'}
                      </span>
                    </div>
                  </div>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <InfoHeading
                    info="Chooses how many verified reaction badges can appear under this agent's answers. These badges only use confirmed app events, such as sources found, files linked, memory updated, or task done."
                  >
                    Agent reactions
                  </InfoHeading>
                  <div className="flex items-center gap-2">
                    <select
                      value={reactionModeValue}
                      onChange={(event) => onAppearanceChange({ reactionMode: event.target.value === 'minimal' ? undefined : event.target.value as AgentAppearance['reactionMode'] })}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    >
                      {AGENT_REACTION_MODE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'off'
                            ? 'Off'
                            : option === 'minimal'
                              ? 'Minimal'
                              : option === 'standard'
                                ? 'Standard'
                                : 'Playful'}
                        </option>
                      ))}
                    </select>
                    <div
                      className="flex h-10 w-28 shrink-0 items-center gap-1.5 rounded-xl border border-border/70 bg-card px-2 text-card-foreground"
                      title={`Agent reactions preview: ${reactionModeValue}`}
                    >
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-muted/60"
                        style={{ color: previewAccentColor }}
                      >
                        <Sparkles className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 truncate text-[11px] font-semibold">
                        {reactionModeValue === 'off' ? 'Hidden' : `${reactionModeValue[0].toUpperCase()}${reactionModeValue.slice(1)}`}
                      </span>
                    </div>
                  </div>
                </label>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <InfoHeading
                    info="Sets this agent's visual accent color for chat UI details such as avatar previews, answer styling, and status accents. It does not affect provider, model, or task behavior."
                  >
                    Accent color
                  </InfoHeading>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(accentValue) ? accentValue : '#14b8a6'}
                      onChange={(event) => onAppearanceChange({ accentColor: event.target.value })}
                      className="h-9 w-11 shrink-0 rounded-md border border-input bg-background p-1"
                      aria-label="Choose accent color"
                    />
                    <input
                      type="text"
                      key={accentValue || 'default-accent'}
                      defaultValue={accentValue}
                      onBlur={(event) => onAppearanceChange({ accentColor: event.target.value.trim() || undefined })}
                      placeholder="#14b8a6"
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {AGENT_ACCENT_SWATCHES.map((color) => {
                      const selected = accentValue.toLowerCase() === color.toLowerCase();
                      return (
                        <button
                          key={color}
                          type="button"
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-full border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring/50',
                            selected ? 'border-foreground' : 'border-border'
                          )}
                          style={{ backgroundColor: color }}
                          title={`Use ${color}`}
                          aria-label={`Use accent color ${color}`}
                          onClick={() => onAppearanceChange({ accentColor: color })}
                        >
                          {selected ? <Check className="h-3.5 w-3.5 text-white drop-shadow" /> : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => onAppearanceChange({ accentColor: undefined })}
                    >
                      Default
                    </button>
                  </div>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-sm text-foreground">
                  <span>
                    <InfoHeading
                      className="font-medium"
                      info="Shows this agent's avatar at the top of answer bubbles. If turned off, answers stay more compact and the avatar can be re-enabled from answer controls or this Appearance popup."
                    >
                      Show avatars on answers
                    </InfoHeading>
                    <span className="block text-xs text-muted-foreground">Display this agent's avatar on assistant answers.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={showAvatarOnAnswersValue}
                    onChange={(event) => onAppearanceChange({ showAvatarOnAnswers: event.target.checked ? undefined : false })}
                    className="h-4 w-4 shrink-0"
                  />
                </label>
              </section>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
