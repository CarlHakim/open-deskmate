

export function normalizeFsPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '').trim();
}

export function pathLeaf(value: string): string {
  const normalized = normalizeFsPath(value);
  if (!normalized || normalized === '.') return 'workspace root';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}
