import { useEffect, useRef, useState } from 'react';
import type { UsageProject, UsageProjectWorkItem, UsageProjectWorkItemSourceType } from '@accomplish/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { getAccomplish } from '../../lib/accomplish';
import { useUsageProjectStore } from '../../stores/usageProjectStore';

export type ScrapbookSeed = {
  title: string; content?: string; sourceType?: UsageProjectWorkItemSourceType; sourceId?: string;
};

export function ScrapbookSaveDialog({ seed, projectId, incognito, onClose, onSaved }: {
  seed: ScrapbookSeed; projectId?: string | null; incognito?: boolean;
  onClose: () => void; onSaved: (item: UsageProjectWorkItem) => void;
}) {
  const [projects, setProjects] = useState<UsageProject[]>([]);
  const [selected, setSelected] = useState(projectId || '');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [newName, setNewName] = useState('');
  const [title, setTitle] = useState(seed.title.slice(0, 160));
  const [content, setContent] = useState(seed.content || '');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'note' | 'file' | 'link'>('note');
  const [paths, setPaths] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadFailed(false); setError('');
    void getAccomplish().listUsageProjects({ includeArchived: false }).then(records => {
      if (cancelled) return;
      const active = records.filter(project => project.status === 'active');
      setProjects(active);
      setSelected(current => active.some(project => project.id === current) ? current : active[0]?.id || '__new__');
    }).catch(err => { if (!cancelled) { setLoadFailed(true); setError(err instanceof Error ? err.message : 'Could not load projects.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const save = async () => {
    if (lock.current || loading || loadFailed || !title.trim()) return;
    if (kind === 'note' && (!content.trim() || content.length > 100000)) { setError('Enter a note of up to 100,000 characters.'); return; }
    if (kind === 'file' && (paths.length === 0 || paths.length > 50)) { setError('Choose between 1 and 50 files.'); return; }
    if (kind === 'link') {
      try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
      catch { setError('Enter a complete http or https link.'); return; }
    }
    if (selected === '__new__' ? !newName.trim() : !projects.some(project => project.id === selected)) { setError('Choose a project or enter a new project name.'); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      const api = getAccomplish();
      let target = selected;
      if (target === '__new__') {
        const project = await api.createUsageProject({ name: newName.trim() });
        target = project.id;
        // Keep the created project selected if saving the entry needs a retry.
        if (alive.current) { setProjects(current => [...current, project]); setSelected(project.id); }
        void useUsageProjectStore.getState().loadProjects();
      }
      const now = new Date().toISOString();
      const item = await api.createUsageProjectWorkItem({ usageProjectId: target, title: title.trim(), description: note.trim(),
        sourceType: seed.sourceType || 'manual', sourceId: seed.sourceId, tags: ['scrapbook'],
        notes: kind === 'note' ? [{ id: crypto.randomUUID(), title: title.trim(), text: content.trim(), createdAt: now }] : [],
        documents: kind === 'file' ? paths.map(path => ({ id: crypto.randomUUID(), label: paths.length === 1 ? title.trim() : path.split(/[\\/]/).pop() || title.trim(), kind: 'local' as const, path, createdAt: now })) : [],
        sources: kind === 'link' ? [{ id: crypto.randomUUID(), title: title.trim(), url: url.trim(), createdAt: now }] : [],
      });
      if (alive.current) onSaved(item);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'Could not save this item.'); }
    finally { lock.current = false; if (alive.current) setSaving(false); }
  };
  const field = 'w-full rounded-md border border-input bg-background p-2 text-sm text-foreground placeholder:text-muted-foreground';
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="project-scrapbook-surface max-h-[85vh] overflow-y-auto text-foreground sm:max-w-xl" onPointerDown={event => { if (event.target === event.currentTarget && !lock.current) onClose(); }}>
      <DialogHeader><DialogTitle>Save to scrapbook</DialogTitle><DialogDescription>Collect this in a project. Find it under Project Management → Scrapbook and in its Workboard.</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        {incognito && <p className="text-xs text-muted-foreground">Saving keeps this item in the project after the incognito conversation ends.</p>}
        <label className="block space-y-1 text-sm">Project<select aria-label="Scrapbook project" className={field} disabled={loading || saving} value={selected} onChange={event => setSelected(event.target.value)}>
          {loading && <option value="">Loading projects…</option>}
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          <option value="__new__">Create a new project…</option>
        </select></label>
        {selected === '__new__' && <label className="block space-y-1 text-sm">New project name<input className={field} value={newName} maxLength={120} disabled={saving} onChange={event => setNewName(event.target.value)} /></label>}
        {!seed.content && <label className="block space-y-1 text-sm">Item type<select className={field} value={kind} disabled={saving} onChange={event => setKind(event.target.value as typeof kind)}><option value="note">Note or decision</option><option value="file">Files or images</option><option value="link">Web link</option></select></label>}
        <label className="block space-y-1 text-sm">Title<input className={field} value={title} maxLength={160} disabled={saving} onChange={event => setTitle(event.target.value)} /></label>
        {kind === 'note' && <label className="block space-y-1 text-sm">Saved content<textarea className={field} value={content} rows={8} disabled={saving} onChange={event => setContent(event.target.value)} /></label>}
        {kind === 'file' && <div className="space-y-2"><Button type="button" variant="outline" disabled={saving} onClick={() => { void getAccomplish().selectFiles().then(files => { if (alive.current && files.length) setPaths(files); }).catch(err => { if (alive.current) setError(String(err)); }); }}>Choose files</Button><p className="break-words text-xs text-muted-foreground">{paths.length ? paths.join('\n') : 'Local files are linked from their current location.'}</p></div>}
        {kind === 'link' && <label className="block space-y-1 text-sm">Web address<input className={field} value={url} maxLength={2048} disabled={saving} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label>}
        <label className="block space-y-1 text-sm">Optional note<textarea className={field} value={note} rows={2} maxLength={5000} disabled={saving} onChange={event => setNote(event.target.value)} placeholder="Why do you want to keep this?" /></label>
        {error && <div role="alert" className="text-sm text-destructive">{error} {loadFailed && <button type="button" className="underline" onClick={() => setLoadAttempt(current => current + 1)}>Retry loading projects</button>}</div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={loading || loadFailed || saving || !title.trim()}>{saving ? 'Saving…' : 'Save item'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
