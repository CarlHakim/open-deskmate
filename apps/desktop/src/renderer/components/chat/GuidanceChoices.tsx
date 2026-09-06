import { createContext, useContext, useState } from 'react';
import type { InteractiveAnswer } from '@accomplish/shared';

export const GuidanceContext = createContext<{ messageId?: string; disabled: boolean; onChoose: (prompt: string) => void }>({ disabled: true, onChoose: () => {} });

export function GuidanceChoices({ data, scope }: { data: Extract<InteractiveAnswer, { type: 'choices' }>; scope: string }) {
  const guidance = useContext(GuidanceContext);
  const [custom, setCustom] = useState('');
  const [selected, setSelected] = useState('');
  const disabled = guidance.disabled || guidance.messageId !== scope;
  const choose = (label: string, prompt: string) => {
    if (disabled) return;
    guidance.onChoose(prompt);
    setSelected(label);
  };
  return <div className="space-y-3">
    <div className="grid gap-2">{data.options.map(option => <button key={option.label} type="button" disabled={disabled}
      aria-pressed={selected === option.label} onClick={() => choose(option.label, option.prompt)}
      className="rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-primary/5 aria-pressed:border-primary aria-pressed:bg-primary/10 disabled:cursor-default disabled:opacity-60">
      <strong className="block">{option.label}</strong><span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
    </button>)}</div>
    <label className="block text-xs">Your own direction<textarea value={custom} onChange={event => setCustom(event.target.value)} disabled={disabled} maxLength={2000} rows={2} className="mt-1 block w-full rounded-md border border-input bg-background p-2 text-sm" placeholder="Describe another approach…" /></label>
    <button type="button" disabled={disabled || !custom.trim()} onClick={() => choose('Your own direction', custom.trim())} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">Use my direction</button>
    <p role="status" className="text-xs text-muted-foreground">{selected ? `${selected} added to your draft. Review it and send when ready.` : disabled ? 'Choices are available on the latest answer once the agent finishes.' : 'Choose a card to add it to your draft. You can edit it before sending. Sending starts another agent turn and saves your direction in the conversation.'}</p>
  </div>;
}
