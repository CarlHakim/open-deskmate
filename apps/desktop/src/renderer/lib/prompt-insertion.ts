export type PromptInsertionMode = 'chat' | 'build';

export type PromptInsertionTarget = {
  mode: PromptInsertionMode;
  label: string;
};

type PromptInsertionEntry = PromptInsertionTarget & {
  id: symbol;
  insert: (text: string) => void;
};

type PromptAttachmentEntry = PromptInsertionTarget & {
  id: symbol;
  attachFiles: (files: string[]) => void;
};

let activeTarget: PromptInsertionEntry | null = null;
let activeAttachmentTarget: PromptAttachmentEntry | null = null;
const listeners = new Set<(target: PromptInsertionTarget | null) => void>();
const attachmentListeners = new Set<(target: PromptInsertionTarget | null) => void>();

function emitPromptInsertionTargetChanged() {
  const target = activeTarget ? { mode: activeTarget.mode, label: activeTarget.label } : null;
  for (const listener of listeners) {
    listener(target);
  }
}

function emitPromptAttachmentTargetChanged() {
  const target = activeAttachmentTarget
    ? { mode: activeAttachmentTarget.mode, label: activeAttachmentTarget.label }
    : null;
  for (const listener of attachmentListeners) {
    listener(target);
  }
}

export function registerPromptInsertionTarget(
  target: PromptInsertionTarget,
  insert: (text: string) => void
): () => void {
  const id = Symbol(target.mode);
  activeTarget = { ...target, id, insert };
  emitPromptInsertionTargetChanged();

  return () => {
    if (activeTarget?.id === id) {
      activeTarget = null;
      emitPromptInsertionTargetChanged();
    }
  };
}

export function registerPromptAttachmentTarget(
  target: PromptInsertionTarget,
  attachFiles: (files: string[]) => void
): () => void {
  const id = Symbol(target.mode);
  activeAttachmentTarget = { ...target, id, attachFiles };
  emitPromptAttachmentTargetChanged();

  return () => {
    if (activeAttachmentTarget?.id === id) {
      activeAttachmentTarget = null;
      emitPromptAttachmentTargetChanged();
    }
  };
}

export function getActivePromptInsertionTarget(): PromptInsertionTarget | null {
  return activeTarget ? { mode: activeTarget.mode, label: activeTarget.label } : null;
}

export function getActivePromptAttachmentTarget(): PromptInsertionTarget | null {
  return activeAttachmentTarget
    ? { mode: activeAttachmentTarget.mode, label: activeAttachmentTarget.label }
    : null;
}

export function subscribePromptInsertionTarget(
  listener: (target: PromptInsertionTarget | null) => void
): () => void {
  listeners.add(listener);
  listener(getActivePromptInsertionTarget());
  return () => {
    listeners.delete(listener);
  };
}

export function subscribePromptAttachmentTarget(
  listener: (target: PromptInsertionTarget | null) => void
): () => void {
  attachmentListeners.add(listener);
  listener(getActivePromptAttachmentTarget());
  return () => {
    attachmentListeners.delete(listener);
  };
}

export function insertIntoActivePrompt(text: string): boolean {
  const value = text.trim();
  if (!value || !activeTarget) return false;
  activeTarget.insert(value);
  return true;
}

export function attachFilesToActivePrompt(files: string[]): boolean {
  const values = files.map((file) => file.trim()).filter(Boolean);
  if (values.length === 0 || !activeAttachmentTarget) return false;
  activeAttachmentTarget.attachFiles(values);
  return true;
}
