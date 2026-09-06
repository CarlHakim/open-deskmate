import { Children, createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from 'react';
import { create } from 'zustand';
import { parseInteractiveAnswer } from '@accomplish/shared';
import { GuidanceChoices } from './GuidanceChoices';

export const AnswerScope = createContext('answer');
type Selection = { quantity?: number; checked?: number[]; view?: 'both' | 'before' | 'after' };
const empty: Selection = {};
const useSelections = create<{ entries: Record<string, Selection>; change: (key: string, patch: Selection) => void }>(set => ({
  entries: {}, change: (key, patch) => set(state => {
    const entries = { ...state.entries, [key]: { ...state.entries[key], ...patch } };
    const keys = Object.keys(entries);
    for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete entries[old];
    return { entries };
  }),
}));

function Widget({ source, scope }: { source: string; scope: string }) {
  const key = `${scope}:${source}`;
  const selection = useSelections(state => state.entries[key] || empty);
  const change = useSelections(state => state.change);
  const data = parseInteractiveAnswer(source);
  if (!data) return <pre><code>{source}</code></pre>;
  const buttonClass = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-accent aria-pressed:bg-primary/15';
  return <section aria-label={data.title} className="not-prose my-3 rounded-xl border border-primary/25 bg-background p-4 text-sm text-foreground">
    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">{data.title}</h3>{data.type !== 'choices' && <button type="button" className={buttonClass} onClick={() => change(key, { quantity: undefined, checked: [], view: 'both' })}>Reset</button>}</div>
    {data.type === 'choices' && <GuidanceChoices data={data} scope={scope} />}
    {data.type === 'budget' && (() => {
      const quantity = selection.quantity ?? data.quantity;
      const total = data.items.reduce((sum, item) => sum + item.unitPrice, 0) * quantity;
      const amount = (value: number) => `${data.currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return <><label className="flex items-center gap-3">Quantity<input aria-label="Budget quantity" className="w-24 rounded border border-input bg-background px-2 py-1" type="number" min={1} max={100000} step={1} value={quantity} onChange={event => { const value = event.target.valueAsNumber; if (Number.isInteger(value) && value >= 1 && value <= 100000) change(key, { quantity: value }); }} /></label>
        <table className="my-3 w-full text-left"><thead><tr><th>Item</th><th>Per unit</th><th>Total</th></tr></thead><tbody>{data.items.map((item, index) => <tr key={index}><td className="py-1">{item.label}</td><td>{amount(item.unitPrice)}</td><td>{amount(item.unitPrice * quantity)}</td></tr>)}</tbody></table>
        <output aria-live="polite" className="block font-semibold">Total: {amount(total)}</output></>;
    })()}
    {data.type === 'checklist' && <><p className="mb-2 text-xs text-muted-foreground">{(selection.checked || []).length} of {data.items.length} checked</p>{data.items.map((item, index) => <label key={index} className="flex items-start gap-2 py-1"><input type="checkbox" checked={selection.checked?.includes(index) || false} onChange={event => change(key, { checked: event.target.checked ? [...(selection.checked || []), index] : selection.checked?.filter(value => value !== index) })} /><span>{item}</span></label>)}</>}
    {data.type === 'comparison' && <><div className="mb-3 flex gap-2">{(['both', 'before', 'after'] as const).map(view => <button key={view} type="button" className={buttonClass} aria-pressed={(selection.view || 'both') === view} onClick={() => change(key, { view })}>{view === 'both' ? 'Side by side' : view === 'before' ? 'Before' : 'After'}</button>)}</div><div className={`grid gap-3 ${(selection.view || 'both') === 'both' ? 'sm:grid-cols-2' : ''}`}>{(['before', 'after'] as const).filter(side => !selection.view || selection.view === 'both' || selection.view === side).map(side => <div key={side} className="min-w-0 rounded-lg border border-border p-3"><h4 className="mb-2 font-semibold">{side === 'before' ? 'Before' : 'After'}</h4><p className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{data[side] || '(empty)'}</p></div>)}</div></>}
    {data.type !== 'choices' && <p className="mt-3 text-xs text-muted-foreground">Interactive view only. Changes stay in this app session and do not run the agent or modify files.</p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer">Original data</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{source}</pre></details>
  </section>;
}

export function InteractiveAnswerPre({ children, ...props }: ComponentProps<'pre'> & { node?: unknown }) {
  const scope = useContext(AnswerScope);
  const child = Children.toArray(children)[0];
  if (isValidElement<{ className?: string; children?: ReactNode }>(child) && child.props.className === 'language-deskmate') {
    const source = String(child.props.children || '').trim();
    if (parseInteractiveAnswer(source)) return <Widget source={source} scope={scope} />;
  }
  const { node: _node, ...domProps } = props;
  return <pre {...domProps}>{children}</pre>;
}
export const interactiveMarkdownComponents = { pre: InteractiveAnswerPre };
