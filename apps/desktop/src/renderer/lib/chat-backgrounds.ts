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

function background(id: string, src: string): ChatBackground {
  return {
    id,
    label: toLabel(id),
    src,
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
