import cloudAutomationSky from '/assets/chat-backgrounds/cloud-automation-sky.jpg';
import cozyDeskPlusAiAssistant from '/assets/chat-backgrounds/cozy-desk-plus-ai-assistant.jpg';
import floatingPromptBubbles from '/assets/chat-backgrounds/floating-prompt-bubbles.jpg';
import graphiteWorkspace from '/assets/chat-backgrounds/graphite-workspace.jpg';
import knowledgeLibrary from '/assets/chat-backgrounds/knowledge-library.jpg';
import robotWorkshop from '/assets/chat-backgrounds/robot-workshop.jpg';

export const DEFAULT_CHAT_BACKGROUND_ID = 'default';
export const CHAT_BACKGROUND_STORAGE_KEY = 'opendeskmate:chat-background';
export const CHAT_BACKGROUND_CHANGED_EVENT = 'opendeskmate:chat-background-changed';

export type ChatBackground = {
  id: string;
  label: string;
  src: string;
  thinkingIndicator: {
    color: string;
    textShadow: string;
  };
};

const ACRONYM_WORDS = new Set(['ai']);

function toLabel(slug: string): string {
  return slug
    .split(/[-\s]+/g)
    .filter(Boolean)
    .map((word) => (
      ACRONYM_WORDS.has(word.toLowerCase())
        ? word.toUpperCase()
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
    ))
    .join(' ');
}

const THINKING_INDICATOR_BY_BACKGROUND: Record<string, ChatBackground['thinkingIndicator']> = {
  'cloud-automation-sky': {
    color: '#062f3f',
    textShadow: '0 1px 8px rgba(255,255,255,0.82)',
  },
  'cozy-desk-plus-ai-assistant': {
    color: '#132335',
    textShadow: '0 1px 9px rgba(255,255,255,0.78)',
  },
  'floating-prompt-bubbles': {
    color: '#f4fbff',
    textShadow: '0 1px 10px rgba(3,7,18,0.86)',
  },
  'graphite-workspace': {
    color: '#dffbff',
    textShadow: '0 1px 10px rgba(0,0,0,0.88)',
  },
  'knowledge-library': {
    color: '#eefcff',
    textShadow: '0 1px 10px rgba(1,6,18,0.86)',
  },
  'robot-workshop': {
    color: '#eefcff',
    textShadow: '0 1px 10px rgba(8,13,30,0.88)',
  },
};

function background(id: string, src: string): ChatBackground {
  return {
    id,
    label: toLabel(id),
    src,
    thinkingIndicator: THINKING_INDICATOR_BY_BACKGROUND[id] ?? {
      color: '#f4fbff',
      textShadow: '0 1px 10px rgba(3,7,18,0.82)',
    },
  };
}

export const CHAT_BACKGROUNDS: ChatBackground[] = [
  background('cloud-automation-sky', cloudAutomationSky),
  background('cozy-desk-plus-ai-assistant', cozyDeskPlusAiAssistant),
  background('floating-prompt-bubbles', floatingPromptBubbles),
  background('graphite-workspace', graphiteWorkspace),
  background('knowledge-library', knowledgeLibrary),
  background('robot-workshop', robotWorkshop),
];

export function getChatBackground(id: string | null | undefined): ChatBackground | null {
  if (!id || id === DEFAULT_CHAT_BACKGROUND_ID) return null;
  return CHAT_BACKGROUNDS.find((entry) => entry.id === id) ?? null;
}

export function normalizeChatBackgroundId(id: string | null | undefined): string {
  if (!id || id === DEFAULT_CHAT_BACKGROUND_ID) return DEFAULT_CHAT_BACKGROUND_ID;
  return getChatBackground(id)?.id ?? DEFAULT_CHAT_BACKGROUND_ID;
}

export function readChatBackgroundId(): string {
  if (typeof window === 'undefined') return DEFAULT_CHAT_BACKGROUND_ID;
  try {
    return normalizeChatBackgroundId(window.localStorage.getItem(CHAT_BACKGROUND_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_BACKGROUND_ID;
  }
}

export function writeChatBackgroundId(id: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeChatBackgroundId(id);
  try {
    window.localStorage.setItem(CHAT_BACKGROUND_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent(CHAT_BACKGROUND_CHANGED_EVENT, { detail: { id: normalized } }));
  } catch {
    // Ignore preference persistence failures.
  }
}
