import type { SelectedModel } from '@accomplish/shared';

export const SELECTED_MODEL_CHANGED_EVENT = 'opendeskmate:selected-model-changed';

export function normalizeSelectedModel(value: unknown): SelectedModel | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SelectedModel>;
  const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : '';
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
  if (!provider || !model) return null;
  const baseUrl = typeof candidate.baseUrl === 'string' && candidate.baseUrl.trim()
    ? candidate.baseUrl.trim()
    : undefined;
  return { provider, model, ...(baseUrl ? { baseUrl } : {}) };
}

export function emitSelectedModelChanged(model: SelectedModel | null): void {
  window.dispatchEvent(
    new CustomEvent(SELECTED_MODEL_CHANGED_EVENT, {
      detail: normalizeSelectedModel(model),
    })
  );
}
