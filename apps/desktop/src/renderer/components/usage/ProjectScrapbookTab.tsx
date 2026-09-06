import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookImage, ExternalLink, FileText, ImageIcon, Link2, Plus, RefreshCw, Star } from 'lucide-react';
import type { UsageProjectWorkItem } from '@accomplish/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { getAccomplish } from '../../lib/accomplish';
import { scrapbookCards, scrapbookImageSrc, scrapbookTaskRoute, type ScrapbookCard, type ScrapbookKind } from '../../lib/project-scrapbook';
import { useScrapbookStore } from '../../stores/scrapbookStore';
import { ScrapbookSaveDialog } from './ScrapbookSaveDialog';
import { AnswerScope, InteractiveAnswerPre } from '../chat/InteractiveAnswer';
import { GuidanceContext } from '../chat/GuidanceChoices';

const labels: Record<ScrapbookKind, string> = { note: 'Note', image: 'Image', file: 'File', link: 'Link' };
const icons = { note: FileText, image: ImageIcon, file: FileText, link: Link2 };
const savedGuidance = { disabled: true, onChoose: () => {} };

function CardPreview({ card, expanded = false }: { card: ScrapbookCard; expanded?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = card.kind === 'image' ? scrapbookImageSrc(card.path) : undefined;
  const Icon = icons[card.kind];
  if (src && !broken) return <img src={src} alt={card.title} loading="lazy" onError={() => setBroken(true)} className={expanded ? 'max-h-[50vh] w-full rounded-lg object-contain' : 'h-36 w-full rounded-lg object-cover'} />;
  return <div className="flex min-h-32 flex-col justify-center gap-3 rounded-lg bg-muted/50 p-4 text-foreground">
    <Icon className="h-6 w-6 text-primary" />
    <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{broken ? 'Preview unavailable. You can open the original file below.' : card.kind === 'note' ? card.text.replace(/(^|\n)#{1,6}\s+/g, '$1').replace(/(\*\*|__|```)/g, '').slice(0, 260) : card.path || card.url || card.title}</p>
  </div>;
}

export default function ProjectScrapbookTab({ projectId, onNavigate, onEditItem }: {
  projectId: string; onNavigate: (route: string) => void; onEditItem: (itemId: string) => void;
}) {
  const [items, setItems] = useState<UsageProjectWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | ScrapbookKind>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [limit, setLimit] = useState(48);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const requests = useRef(0);
  const favorites = useScrapbookStore(state => state.favorites);
  const toggleFavorite = useScrapbookStore(state => state.toggleFavorite);
  const refresh = useCallback(async () => {
    const request = ++requests.current;
    setLoading(true); setError('');
    try {
      const records = await getAccomplish().listUsageProjectWorkItems({ projectId, includeArchived: false });
      if (request === requests.current) setItems(records.filter(item => item.usageProjectId === projectId));
    } catch (err) { if (request === requests.current) setError(err instanceof Error ? err.message : 'Could not load scrapbook.'); }
    finally { if (request === requests.current) setLoading(false); }
  }, [projectId]);
  useEffect(() => { void refresh(); return () => { ++requests.current; }; }, [refresh]);
  useEffect(() => { setLimit(48); }, [query, kind, favoritesOnly]);
  const cards = useMemo(() => scrapbookCards(items), [items]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => cards.filter(card => (kind === 'all' || card.kind === kind)
    && (!favoritesOnly || favorites[card.id])
    && (!normalizedQuery || `${card.title} ${card.text} ${card.item.title} ${card.item.description || ''}`.toLowerCase().includes(normalizedQuery))), [cards, kind, favoritesOnly, favorites, normalizedQuery]);
  const detail = cards.find(card => card.id === detailId);
  const openTarget = async (card: Pick<ScrapbookCard, 'path' | 'url'>) => {
    setError('');
    try {
      if (card.path) {
        const result = await getAccomplish().openPath(card.path);
        if (!result.ok) throw new Error(result.error || 'Could not open this file.');
      } else if (card.url) {
        if (!/^https?:\/\//i.test(card.url)) throw new Error('Only http and https links can be opened.');
        await getAccomplish().openExternal(card.url);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open this item.'); }
  };
  return <section aria-label="Project scrapbook" className="project-scrapbook-surface space-y-4 text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="flex items-center gap-2 font-semibold"><BookImage className="h-5 w-5 text-primary" />Scrapbook</h3><p className="mt-1 text-xs text-muted-foreground">Saved notes, images, files, and discoveries from this project's Workboard.</p></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()} aria-label="Refresh scrapbook"><RefreshCw className="h-4 w-4" /></Button><Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />Add item</Button></div>
    </div>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Search scrapbook" placeholder="Search saved work…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-40 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
      <select aria-label="Scrapbook item type" value={kind} onChange={event => setKind(event.target.value as typeof kind)} className="rounded-md border border-input bg-background px-2 text-sm"><option value="all">All types</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}s</option>)}</select>
      <Button size="sm" variant={favoritesOnly ? 'secondary' : 'outline'} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}><Star className="mr-1 h-3.5 w-3.5" />Favorites</Button>
    </div>
    {error && !detail && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-xs text-primary">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading scrapbook…</p>}
    {!loading && filtered.length === 0 && <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">{cards.length ? 'No matching items. Try another search or filter.' : 'Start your collection with Add item, or choose Save to scrapbook beneath an answer in Chat or Build.'}</div>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {filtered.slice(0, limit).map(card => <article key={card.id} className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
        <button type="button" aria-label={`View ${card.title}`} onClick={() => { setDetailId(card.id); setError(''); }} className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CardPreview card={card} />
          <h4 className="mt-3 line-clamp-2 break-words text-sm font-semibold">{card.title}</h4>
          {card.item.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{card.item.description}</p>}
        </button>
        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{labels[card.kind]} · {new Date(card.createdAt).toLocaleDateString()}</span><button type="button" aria-label={`Favorite ${card.title}`} aria-pressed={Boolean(favorites[card.id])} title="Keep this in your favorites on this device" onClick={() => toggleFavorite(card.id)} className="rounded-md p-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><Star className={`h-4 w-4 ${favorites[card.id] ? 'fill-amber-400 text-amber-500' : ''}`} /></button></div>
      </article>)}
    </div>
    {filtered.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 48)}>Show more ({filtered.length - limit} remaining)</Button>}
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) setDetailId(null); }}>
      <DialogContent className="project-scrapbook-surface max-h-[85vh] overflow-y-auto text-foreground sm:max-w-2xl" onPointerDown={event => { if (event.target === event.currentTarget) setDetailId(null); }}>
        {detail && <><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{labels[detail.kind]} · {detail.item.title}</DialogDescription></DialogHeader>
          {detail.kind === 'note' ? <AnswerScope.Provider value={`scrapbook:${detail.id}`}><GuidanceContext.Provider value={savedGuidance}><div className="prose prose-sm max-w-none break-words dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            pre: InteractiveAnswerPre,
            a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); void openTarget({ url: href }); }}>{children}</a>,
            img: ({ alt }) => <span className="text-xs text-muted-foreground">[Image reference: {alt || 'image'}]</span>,
          }}>{detail.text}</ReactMarkdown></div></GuidanceContext.Provider></AnswerScope.Provider> : <CardPreview key={detail.id} card={detail} expanded />}
          {detail.item.description && <div className="rounded-lg bg-muted/50 p-3 text-sm"><span className="font-medium">Note</span><p className="mt-1 whitespace-pre-wrap">{detail.item.description}</p></div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {(detail.path || detail.url) && <Button variant="outline" onClick={() => void openTarget(detail)}><ExternalLink className="mr-1.5 h-4 w-4" />Open original</Button>}
            {scrapbookTaskRoute(detail.item) && <Button variant="outline" onClick={() => onNavigate(scrapbookTaskRoute(detail.item)!)}>Open linked task</Button>}
            <Button variant="outline" onClick={() => onEditItem(detail.item.id)}>Edit in Workboard</Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
    {adding && <ScrapbookSaveDialog seed={{ title: '' }} projectId={projectId} onClose={() => setAdding(false)} onSaved={item => { setAdding(false); setNotice('Item saved to the project scrapbook.'); if (item.usageProjectId === projectId) setItems(current => [item, ...current]); }} />}
  </section>;
}
