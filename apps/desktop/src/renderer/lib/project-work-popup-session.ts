type ChatProjectWorkPopupSession = {
  open: boolean;
  projectId: string | null;
};

const CHAT_PROJECT_WORK_POPUP_OPEN_KEY = 'open-deskmate-chat-project-work-popup-open';
const CHAT_PROJECT_WORK_POPUP_PROJECT_KEY = 'open-deskmate-chat-project-work-popup-project-id';
const CHAT_PROJECT_WORK_POPUP_EVENT = 'open-deskmate:chat-project-work-popup';

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function readChatProjectWorkPopupSession(): ChatProjectWorkPopupSession {
  if (!canUseSessionStorage()) return { open: false, projectId: null };
  try {
    return {
      open: window.sessionStorage.getItem(CHAT_PROJECT_WORK_POPUP_OPEN_KEY) === '1',
      projectId: window.sessionStorage.getItem(CHAT_PROJECT_WORK_POPUP_PROJECT_KEY) || null,
    };
  } catch {
    return { open: false, projectId: null };
  }
}

export function writeChatProjectWorkPopupSession(open: boolean, projectId: string | null = null): void {
  if (!canUseSessionStorage()) return;
  try {
    if (open) {
      window.sessionStorage.setItem(CHAT_PROJECT_WORK_POPUP_OPEN_KEY, '1');
      if (projectId) {
        window.sessionStorage.setItem(CHAT_PROJECT_WORK_POPUP_PROJECT_KEY, projectId);
      } else {
        window.sessionStorage.removeItem(CHAT_PROJECT_WORK_POPUP_PROJECT_KEY);
      }
    } else {
      window.sessionStorage.removeItem(CHAT_PROJECT_WORK_POPUP_OPEN_KEY);
      window.sessionStorage.removeItem(CHAT_PROJECT_WORK_POPUP_PROJECT_KEY);
    }
  } catch {
    // Ignore session persistence failures.
  }
  window.dispatchEvent(new CustomEvent(CHAT_PROJECT_WORK_POPUP_EVENT, { detail: { open, projectId } }));
}

