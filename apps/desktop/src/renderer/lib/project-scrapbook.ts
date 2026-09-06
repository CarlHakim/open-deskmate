import type { UsageProjectWorkItem } from '@accomplish/shared';

export type ScrapbookKind = 'note' | 'image' | 'file' | 'link';
export type ScrapbookCard = {
  id: string; item: UsageProjectWorkItem; kind: ScrapbookKind; title: string;
  text: string; createdAt: string; path?: string; url?: string;
};

function cardTitle(item: UsageProjectWorkItem, fallback: string) {
  const entryCount = (item.notes?.length || 0) + (item.documents?.length || 0) + (item.sources?.length || 0);
  return item.tags?.includes('scrapbook') && entryCount === 1 ? item.title : fallback;
}

export function scrapbookCards(items: UsageProjectWorkItem[]): ScrapbookCard[] {
  return items.filter(item => !item.archived).flatMap(item => [
    ...(item.notes || []).map(note => ({ id: `${item.id}:note:${note.id}`, item, kind: 'note' as const,
      title: cardTitle(item, note.title || item.title), text: note.text, createdAt: note.createdAt })),
    ...(item.documents || []).map(doc => ({ id: `${item.id}:document:${doc.id}`, item,
      kind: /\.(png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i.test(doc.path || doc.url || '') ? 'image' as const : 'file' as const,
      title: cardTitle(item, doc.label || item.title), text: item.description || '', path: doc.path, url: doc.url, createdAt: doc.createdAt })),
    ...(item.sources || []).map(source => ({ id: `${item.id}:source:${source.id}`, item, kind: 'link' as const,
      title: cardTitle(item, source.title), text: source.description || '', url: source.url, createdAt: source.createdAt })),
  ]).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function scrapbookTaskRoute(item: UsageProjectWorkItem): string | undefined {
  if (!item.sourceId) return undefined;
  if (item.sourceType === 'chat_task') return `/execution/${encodeURIComponent(item.sourceId)}`;
  if (item.sourceType === 'build_session') return `/build?sessionId=${encodeURIComponent(item.sourceId)}`;
  return undefined;
}

export function scrapbookImageSrc(path?: string): string | undefined {
  if (!path || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(path) || !/^(?:[a-z]:[\\/]|\/)/i.test(path)) return undefined;
  const normalized = encodeURI(path.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}
