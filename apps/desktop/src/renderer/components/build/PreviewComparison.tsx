import { useState } from 'react';
import { Columns2, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

type Capture = { dataUrl: string; width: number; height: number; clipped?: boolean; capturedAt: string };
export default function PreviewComparison({ available, capture }: {
  available: boolean;
  capture: () => Promise<Omit<Capture, 'capturedAt'>>;
}) {
  const [open, setOpen] = useState(false);
  const [before, setBefore] = useState<Capture | null>(null);
  const [after, setAfter] = useState<Capture | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState(50);
  const [view, setView] = useState<'slider' | 'side'>('slider');
  const take = async (side: 'before' | 'after') => {
    setBusy(true); setError('');
    try {
      const result = await capture();
      const image = { ...result, capturedAt: new Date().toLocaleTimeString() };
      if (side === 'before') setBefore(image); else setAfter(image);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <>
    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setOpen(true)}><Columns2 className="mr-1 h-3.5 w-3.5" />Before / after</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Before and after</DialogTitle><DialogDescription>Capture the preview before making changes, then capture it again afterward. Snapshots stay here while this workspace view is open.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!available || busy} variant="outline" onClick={() => void take('before')}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Capture before</Button>
          <Button disabled={!available || busy} variant="outline" onClick={() => void take('after')}>Capture after</Button>
          <Button variant="ghost" disabled={busy || (!before && !after)} onClick={() => { setBefore(null); setAfter(null); setError(''); }}>Clear snapshots</Button>
          {before && after && <Button variant="outline" onClick={() => setView(view === 'slider' ? 'side' : 'slider')}>{view === 'slider' ? 'Side by side' : 'Reveal slider'}</Button>}
        </div>
        {!available && <p className="text-sm text-muted-foreground">Start the runtime preview to capture a snapshot.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {(before?.clipped || after?.clipped) && <p className="text-xs text-amber-700">A snapshot was clipped by the capture limit. This comparison does not show the entire page.</p>}
        {before && after && (before.width !== after.width || before.height !== after.height) && <p className="text-xs text-muted-foreground">Page dimensions changed. Use side by side to inspect the full captures.</p>}
        <div className="min-h-0 overflow-auto">
          {before && after && view === 'slider' ? <>
            <label className="mb-2 flex items-center gap-3 text-sm">Before / after reveal<input className="flex-1" type="range" min={0} max={100} value={position} onChange={event => setPosition(Number(event.target.value))} /></label>
            <div className="relative overflow-hidden rounded-lg border border-border bg-muted" style={{ aspectRatio: `${after.width} / ${after.height}` }}>
              <img src={after.dataUrl} alt="After capture" className="block h-full w-full object-contain object-top" />
              <img src={before.dataUrl} alt="Before capture" className="absolute inset-0 h-full w-full object-contain object-top" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} />
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${position}%` }} />
              <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-xs">Before · {before.capturedAt}</span><span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-xs">After · {after.capturedAt}</span>
            </div>
          </> : <div className="grid gap-4 sm:grid-cols-2">{(['before', 'after'] as const).map(side => {
            const image = side === 'before' ? before : after;
            return <div key={side} className="rounded-lg border border-dashed border-border p-3"><h3 className="mb-2 text-sm font-semibold">{side === 'before' ? 'Before' : 'After'} {image && `· ${image.capturedAt}`}</h3>{image ? <img src={image.dataUrl} alt={`${side} capture`} className="w-full" /> : <p className="py-12 text-center text-sm text-muted-foreground">No snapshot captured yet</p>}</div>;
          })}</div>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
