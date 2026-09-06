import { useEffect } from 'react';
import { useExperienceStore, type ExperienceMode } from '../../stores/experienceStore';

export function ExperiencePreferencesSync() {
  const mode = useExperienceStore(state => state.mode);
  useEffect(() => {
    document.documentElement.dataset.experience = mode;
    return () => { delete document.documentElement.dataset.experience; };
  }, [mode]);
  return null;
}

export function ExperienceSettings() {
  const { mode, celebrations, sound, setMode, setCelebrations, setSound } = useExperienceStore();
  return <div className="space-y-3 text-sm">
    <p className="text-xs text-muted-foreground">Shared across Chat and Build. Saved on this device.</p>
    <div role="group" aria-label="Interaction style" className="grid grid-cols-3 gap-2">
      {(['calm', 'balanced', 'playful'] as ExperienceMode[]).map(value => <button key={value} type="button"
        aria-pressed={mode === value} onClick={() => setMode(value)}
        className="rounded-lg border border-border p-2 text-sm capitalize hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary/10">{value}</button>)}
    </div>
    <p className="text-xs text-muted-foreground">{mode === 'calm' ? 'Quiet presentation with no decorative movement or completion sounds.' : mode === 'playful' ? 'A cheerful avatar gesture and a brief sparkle when work finishes.' : 'A gentle avatar gesture and a subtle result highlight.'} Reduced-motion preferences are always respected.</p>
    <label className="flex items-center gap-2"><input type="checkbox" checked={celebrations} onChange={event => setCelebrations(event.target.checked)} />Completion animations</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} />Soft completion chime (off in Calm)</label>
    <p className="text-xs text-muted-foreground">Status and results remain visible with effects switched off.</p>
  </div>;
}
