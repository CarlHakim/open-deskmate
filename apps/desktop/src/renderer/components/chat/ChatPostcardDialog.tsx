import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Loader2,
  Mail,
  Paperclip,
  Pin,
  Search,
  Stamp,
  type LucideIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { normalizeMarkdownTables } from '@/lib/markdown-tables';
import { cn } from '@/lib/utils';

export type ChatPostcardTemplateId =
  | 'clean-summary'
  | 'client-update'
  | 'research-card'
  | 'decision-record'
  | 'executive-brief'
  | 'editorial-cover'
  | 'classic-postcard'
  | 'metric-snapshot'
  | 'timeline-card'
  | 'quote-card'
  | 'notebook-note'
  | 'announcement-card';

export interface ChatPostcardTemplate {
  id: ChatPostcardTemplateId;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  swatchClassName: string;
}

export interface ChatPostcardDraft {
  templateId: ChatPostcardTemplateId;
  eyebrow: string;
  title: string;
  subtitle: string;
  summary: string;
  highlights: string[];
  statusLabel: string;
  sourceLabel: string;
  dateLabel: string;
  footer: string;
}

export interface ChatPostcardActionPayload {
  element: HTMLElement;
  draft: ChatPostcardDraft;
  template: ChatPostcardTemplate;
  templateId: ChatPostcardTemplateId;
}

export interface ChatPostcardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTemplateId?: ChatPostcardTemplateId;
  initialDraft?: Partial<ChatPostcardDraft>;
  draft?: Partial<ChatPostcardDraft>;
  onDraftChange?: (draft: ChatPostcardDraft) => void;
  onExportPng: (payload: ChatPostcardActionPayload) => void | Promise<void>;
  onCopyPng: (payload: ChatPostcardActionPayload) => void | Promise<void>;
  onAttachToWorkboard?: (payload: ChatPostcardActionPayload) => void | Promise<void>;
  exportLabel?: string;
  copyLabel?: string;
  attachLabel?: string;
  isExporting?: boolean;
  isCopying?: boolean;
  isAttaching?: boolean;
  errorMessage?: string | null;
  className?: string;
}

export const CHAT_POSTCARD_TEMPLATES: Record<ChatPostcardTemplateId, ChatPostcardTemplate> = {
  'clean-summary': {
    id: 'clean-summary',
    label: 'Clean summary',
    shortLabel: 'Summary',
    description: 'Minimal brief with crisp takeaways.',
    icon: FileText,
    swatchClassName: 'bg-teal-500',
  },
  'client-update': {
    id: 'client-update',
    label: 'Client update',
    shortLabel: 'Update',
    description: 'Status-forward note for external sharing.',
    icon: Mail,
    swatchClassName: 'bg-sky-500',
  },
  'research-card': {
    id: 'research-card',
    label: 'Research card',
    shortLabel: 'Research',
    description: 'Evidence-led card with source context.',
    icon: Search,
    swatchClassName: 'bg-violet-500',
  },
  'decision-record': {
    id: 'decision-record',
    label: 'Decision record',
    shortLabel: 'Decision',
    description: 'Dossier style record of choice and rationale.',
    icon: Stamp,
    swatchClassName: 'bg-amber-500',
  },
  'executive-brief': {
    id: 'executive-brief',
    label: 'Executive brief',
    shortLabel: 'Brief',
    description: 'Boardroom-style summary with crisp outcome blocks.',
    icon: FileText,
    swatchClassName: 'bg-slate-700',
  },
  'editorial-cover': {
    id: 'editorial-cover',
    label: 'Editorial cover',
    shortLabel: 'Cover',
    description: 'Magazine-inspired cover for polished reports.',
    icon: FileText,
    swatchClassName: 'bg-rose-500',
  },
  'classic-postcard': {
    id: 'classic-postcard',
    label: 'Classic postcard',
    shortLabel: 'Postcard',
    description: 'Travel-card layout with stamp, border, and message area.',
    icon: Mail,
    swatchClassName: 'bg-orange-500',
  },
  'metric-snapshot': {
    id: 'metric-snapshot',
    label: 'Metric snapshot',
    shortLabel: 'Snapshot',
    description: 'Dashboard-style card for KPIs and comparisons.',
    icon: Search,
    swatchClassName: 'bg-emerald-500',
  },
  'timeline-card': {
    id: 'timeline-card',
    label: 'Timeline card',
    shortLabel: 'Timeline',
    description: 'Milestone layout for progress, rollout, and next steps.',
    icon: CheckCircle2,
    swatchClassName: 'bg-blue-500',
  },
  'quote-card': {
    id: 'quote-card',
    label: 'Quote card',
    shortLabel: 'Quote',
    description: 'Large quote-style takeaway with supporting points.',
    icon: Stamp,
    swatchClassName: 'bg-fuchsia-500',
  },
  'notebook-note': {
    id: 'notebook-note',
    label: 'Notebook note',
    shortLabel: 'Note',
    description: 'Lined note-card style for observations and actions.',
    icon: FileText,
    swatchClassName: 'bg-yellow-500',
  },
  'announcement-card': {
    id: 'announcement-card',
    label: 'Announcement card',
    shortLabel: 'Announce',
    description: 'Bold launch/update card with a strong headline.',
    icon: Mail,
    swatchClassName: 'bg-indigo-500',
  },
};

const TEMPLATE_LIST = Object.values(CHAT_POSTCARD_TEMPLATES);

type PendingAction = 'export' | 'copy' | 'attach';

function formatTodayLabel(): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date());
}

function splitHighlights(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

function deriveHighlights(summary: string | undefined): string[] {
  const text = String(summary || '').trim();
  if (!text) {
    return ['Outcome is ready to share', 'Key context is preserved', 'Next step is clear'];
  }
  const lineHighlights = splitHighlights(text);
  if (lineHighlights.length > 1) return lineHighlights.slice(0, 4);
  const sentenceHighlights = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return (sentenceHighlights.length ? sentenceHighlights : [text]).slice(0, 4);
}

function normalizeDraft(
  draft: Partial<ChatPostcardDraft> | undefined,
  defaultTemplateId: ChatPostcardTemplateId = 'clean-summary'
): ChatPostcardDraft {
  const templateId = draft?.templateId || defaultTemplateId;
  const template = CHAT_POSTCARD_TEMPLATES[templateId] || CHAT_POSTCARD_TEMPLATES['clean-summary'];
  const summary = draft?.summary?.trim() || 'Add the main result, context, and next action here.';

  return {
    templateId: template.id,
    eyebrow: draft?.eyebrow?.trim() || template.label,
    title: draft?.title?.trim() || 'Conversation postcard',
    subtitle: draft?.subtitle?.trim() || 'Prepared from chat',
    summary,
    highlights: Array.isArray(draft?.highlights)
      ? draft.highlights.filter(Boolean).slice(0, 5)
      : deriveHighlights(summary),
    statusLabel: draft?.statusLabel?.trim() || template.shortLabel,
    sourceLabel: draft?.sourceLabel?.trim() || 'Open Deskmate',
    dateLabel: draft?.dateLabel?.trim() || formatTodayLabel(),
    footer: draft?.footer?.trim() || 'Generated from chat context',
  };
}

function fallbackText(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function buildMetaLine(draft: ChatPostcardDraft): string {
  return [draft.sourceLabel, draft.dateLabel].filter(Boolean).join(' / ');
}

const POSTCARD_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="my-1 break-words text-[1.22em] font-black leading-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="my-1 break-words text-[1.1em] font-bold leading-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="my-1 break-words text-[1em] font-bold leading-tight">{children}</h3>,
  h4: ({ children }) => <h4 className="my-1 break-words text-[0.95em] font-bold leading-tight">{children}</h4>,
  p: ({ children }) => <p className="my-1 break-words">{children}</p>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="break-words pl-0.5">{children}</li>,
  a: ({ children }) => <span className="font-semibold underline decoration-current/40 underline-offset-2">{children}</span>,
  code: ({ children }) => <code className="rounded border border-current/15 px-1 py-0.5 text-[0.9em] font-semibold">{children}</code>,
  pre: ({ children }) => <pre className="my-2 max-h-24 overflow-hidden rounded-lg border border-current/15 p-2 text-[0.74em] leading-snug">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-4 border-current/25 pl-3 italic">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-hidden rounded-lg border border-current/20">
      <table className="w-full border-collapse text-[0.72em] leading-tight">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-current/15 bg-current/[0.08] px-2 py-1 text-left font-bold">{children}</th>,
  td: ({ children }) => <td className="border border-current/15 px-2 py-1 align-top">{children}</td>,
  img: ({ alt }) => <span className="font-semibold">[Image: {alt || 'image'}]</span>,
};

function PostcardMarkdown({ value, className }: { value: string; className?: string }) {
  const markdown = normalizeMarkdownTables(fallbackText(value, ''));
  return (
    <div className={cn('min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={POSTCARD_MARKDOWN_COMPONENTS}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold text-muted-foreground">{children}</div>;
}

function HighlightList({
  highlights,
  iconClassName,
  textClassName,
}: {
  highlights: string[];
  iconClassName: string;
  textClassName?: string;
}) {
  return (
    <div className="grid gap-2.5">
      {highlights.slice(0, 4).map((highlight, index) => (
        <div key={`${highlight}-${index}`} className="flex min-w-0 items-start gap-2.5">
          <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', iconClassName)} />
          <PostcardMarkdown value={highlight} className={cn('min-w-0 break-words text-sm leading-5', textClassName)} />
        </div>
      ))}
    </div>
  );
}

function CleanSummaryPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative flex h-full min-h-[390px] flex-col overflow-hidden bg-white text-slate-950">
      <div className="absolute inset-y-0 left-0 w-2 bg-teal-500" aria-hidden="true" />
      <div className="flex h-full flex-col p-8 pl-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase text-teal-700">{fallbackText(draft.eyebrow, 'Clean summary')}</div>
            <h3 className="mt-3 break-words text-3xl font-bold leading-tight text-slate-950">
              {fallbackText(draft.title, 'Conversation postcard')}
            </h3>
            <p className="mt-2 break-words text-sm font-medium text-slate-500">
              {fallbackText(draft.subtitle, 'Prepared from chat')}
            </p>
          </div>
          <div className="shrink-0 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
            {fallbackText(draft.statusLabel, 'Summary')}
          </div>
        </div>

        <PostcardMarkdown
          value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')}
          className="mt-7 break-words text-[15px] leading-6 text-slate-700"
        />

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <HighlightList highlights={highlights} iconClassName="text-teal-600" textClassName="text-slate-700" />
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-6 text-xs font-medium text-slate-500">
          <span className="min-w-0 break-words">{buildMetaLine(draft)}</span>
          <span className="max-w-[45%] break-words text-right">{fallbackText(draft.footer, 'Generated from chat context')}</span>
        </div>
      </div>
    </div>
  );
}

function ClientUpdatePreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative flex h-full min-h-[390px] flex-col overflow-hidden bg-slate-950 text-white">
      <div className="absolute right-0 top-0 h-28 w-44 rounded-bl-[72px] bg-cyan-400/25" aria-hidden="true" />
      <div className="absolute bottom-0 left-0 h-24 w-40 rounded-tr-[64px] bg-amber-300/20" aria-hidden="true" />
      <div className="relative flex h-full flex-col p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase text-cyan-200">{fallbackText(draft.eyebrow, 'Client update')}</div>
            <h3 className="mt-3 break-words text-3xl font-bold leading-tight text-white">
              {fallbackText(draft.title, 'Conversation postcard')}
            </h3>
          </div>
          <div className="shrink-0 rounded-full bg-cyan-300 px-3 py-1 text-xs font-bold text-slate-950">
            {fallbackText(draft.statusLabel, 'Update')}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/10 p-4 shadow-2xl shadow-black/20">
          <PostcardMarkdown
            value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')}
            className="break-words text-sm font-medium leading-6 text-slate-100"
          />
        </div>

        <div className="mt-6 grid gap-3">
          {highlights.slice(0, 4).map((highlight, index) => (
            <div key={`${highlight}-${index}`} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
              <div className="relative flex justify-center">
                <span className="mt-1 h-3 w-3 rounded-full bg-cyan-300" />
                {index < Math.min(highlights.length, 4) - 1 ? (
                  <span className="absolute top-5 h-full w-px bg-white/20" aria-hidden="true" />
                ) : null}
              </div>
              <PostcardMarkdown
                value={highlight}
                className="min-w-0 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm leading-5 text-slate-100"
              />
            </div>
          ))}
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-6 text-xs font-medium text-slate-300">
          <span className="min-w-0 break-words">{fallbackText(draft.subtitle, 'Prepared from chat')}</span>
          <span className="max-w-[45%] break-words text-right">{buildMetaLine(draft)}</span>
        </div>
      </div>
    </div>
  );
}

function ResearchCardPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);
  const chartBars = [72, 48, 86, 62];

  return (
    <div className="flex h-full min-h-[390px] overflow-hidden bg-slate-100 text-slate-950">
      <div className="flex w-28 shrink-0 flex-col justify-between bg-violet-700 p-5 text-white">
        <Search className="h-7 w-7" />
        <div className="grid gap-2">
          {chartBars.map((height, index) => (
            <div key={height} className="flex h-16 items-end rounded-full bg-white/10 px-1.5">
              <span
                className={cn('w-full rounded-full', index % 2 === 0 ? 'bg-lime-300' : 'bg-cyan-300')}
                style={{ height: `${height}%` }}
              />
            </div>
          ))}
        </div>
        <div className="text-xs font-bold uppercase text-violet-100">{fallbackText(draft.statusLabel, 'Research')}</div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-7">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase text-violet-700">{fallbackText(draft.eyebrow, 'Research card')}</div>
            <h3 className="mt-3 break-words text-2xl font-bold leading-tight text-slate-950">
              {fallbackText(draft.title, 'Conversation postcard')}
            </h3>
          </div>
          <Badge variant="outline" className="shrink-0 border-violet-200 bg-white text-violet-700">
            {fallbackText(draft.dateLabel, formatTodayLabel())}
          </Badge>
        </div>

        <PostcardMarkdown
          value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')}
          className="mt-4 break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700"
        />

        <div className="mt-5 grid gap-2">
          {highlights.slice(0, 3).map((highlight, index) => (
            <div key={`${highlight}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-bold uppercase text-violet-600">Finding {index + 1}</div>
              <PostcardMarkdown value={highlight} className="mt-1 break-words text-sm leading-5 text-slate-700" />
            </div>
          ))}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-5 text-xs font-medium text-slate-500">
          <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-700">{fallbackText(draft.sourceLabel, 'Open Deskmate')}</span>
          <span className="rounded-full bg-lime-100 px-3 py-1 text-lime-800">{fallbackText(draft.footer, 'Generated from chat context')}</span>
        </div>
      </div>
    </div>
  );
}

function DecisionRecordPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative flex h-full min-h-[390px] flex-col overflow-hidden bg-amber-50 text-slate-950">
      <div className="absolute right-7 top-7 rotate-[-8deg] rounded-md border-2 border-rose-500 px-3 py-1 text-xs font-black uppercase text-rose-600 opacity-80">
        {fallbackText(draft.statusLabel, 'Decision')}
      </div>
      <div className="flex h-full flex-col p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-amber-100">
            <Pin className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase text-amber-700">{fallbackText(draft.eyebrow, 'Decision record')}</div>
            <div className="break-words text-sm font-semibold text-slate-500">{fallbackText(draft.subtitle, 'Prepared from chat')}</div>
          </div>
        </div>

        <h3 className="mt-7 max-w-[80%] break-words text-3xl font-black leading-tight text-slate-950">
          {fallbackText(draft.title, 'Conversation postcard')}
        </h3>

        <div className="mt-5 border-l-4 border-rose-500 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-black uppercase text-rose-600">Decision</div>
          <PostcardMarkdown
            value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')}
            className="mt-2 break-words text-[15px] font-semibold leading-6 text-slate-800"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {highlights.slice(0, 4).map((highlight, index) => (
            <div key={`${highlight}-${index}`} className="min-w-0 border border-amber-200 bg-white/75 p-3">
              <div className="text-[11px] font-black uppercase text-amber-700">Rationale {index + 1}</div>
              <PostcardMarkdown value={highlight} className="mt-1 break-words text-sm leading-5 text-slate-700" />
            </div>
          ))}
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-6 text-xs font-bold uppercase text-slate-500">
          <span className="min-w-0 break-words">{fallbackText(draft.sourceLabel, 'Open Deskmate')}</span>
          <span className="max-w-[45%] break-words text-right">{fallbackText(draft.dateLabel, formatTodayLabel())}</span>
        </div>
      </div>
    </div>
  );
}

function ExecutiveBriefPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="flex h-full min-h-[390px] flex-col overflow-hidden bg-slate-950 text-slate-50">
      <div className="flex items-center justify-between border-b border-white/10 px-8 py-5">
        <div className="text-xs font-bold uppercase tracking-[0.28em] text-slate-400">{fallbackText(draft.eyebrow, 'Executive brief')}</div>
        <div className="rounded-full border border-white/15 px-3 py-1 text-xs font-bold text-slate-200">{fallbackText(draft.statusLabel, 'Brief')}</div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_0.85fr] gap-5 p-8">
        <div className="min-w-0">
          <h3 className="break-words text-3xl font-black leading-tight text-white">{fallbackText(draft.title, 'Conversation postcard')}</h3>
          <PostcardMarkdown
            value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')}
            className="mt-5 text-[15px] leading-6 text-slate-300"
          />
        </div>
        <div className="space-y-3">
          {highlights.slice(0, 4).map((highlight, index) => (
            <div key={`${highlight}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Point {index + 1}</div>
              <PostcardMarkdown value={highlight} className="mt-1 text-xs leading-5 text-slate-100" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between border-t border-white/10 px-8 py-4 text-xs text-slate-400">
        <span>{fallbackText(draft.subtitle, 'Prepared from chat')}</span>
        <span>{buildMetaLine(draft)}</span>
      </div>
    </div>
  );
}

function EditorialCoverPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative flex h-full min-h-[390px] flex-col overflow-hidden bg-[#f8efe7] text-[#17110d]">
      <div className="absolute inset-x-0 top-0 h-2 bg-rose-500" aria-hidden="true" />
      <div className="flex items-center justify-between px-8 pt-7 text-[11px] font-black uppercase tracking-[0.25em] text-rose-700">
        <span>{fallbackText(draft.eyebrow, 'Editorial cover')}</span>
        <span>{fallbackText(draft.dateLabel, formatTodayLabel())}</span>
      </div>
      <div className="px-8 pt-8">
        <h3 className="max-w-[90%] break-words font-serif text-4xl font-black leading-none text-[#17110d]">
          {fallbackText(draft.title, 'Conversation postcard')}
        </h3>
        <div className="mt-5 h-px bg-[#17110d]/20" />
        <PostcardMarkdown
          value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')}
          className="mt-5 max-w-[88%] font-serif text-lg leading-7 text-[#3e312b]"
        />
      </div>
      <div className="mt-auto grid grid-cols-3 gap-3 px-8 pb-7">
        {highlights.slice(0, 3).map((highlight, index) => (
          <div key={`${highlight}-${index}`} className="border-t border-[#17110d]/25 pt-2">
            <div className="text-[10px] font-black uppercase text-rose-700">Feature {index + 1}</div>
            <PostcardMarkdown value={highlight} className="mt-1 text-xs font-semibold leading-4 text-[#3e312b]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ClassicPostcardPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative flex h-full min-h-[390px] overflow-hidden bg-orange-50 p-5 text-slate-950">
      <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-orange-300" aria-hidden="true" />
      <div className="relative grid min-h-0 flex-1 grid-cols-[1fr_0.78fr] gap-5 rounded-xl bg-white/70 p-5">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{fallbackText(draft.eyebrow, 'Classic postcard')}</div>
          <h3 className="mt-4 break-words text-3xl font-black leading-tight">{fallbackText(draft.title, 'Conversation postcard')}</h3>
          <PostcardMarkdown value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')} className="mt-4 text-sm leading-6 text-slate-700" />
        </div>
        <div className="flex flex-col border-l border-orange-200 pl-4">
          <div className="ml-auto flex h-16 w-16 items-center justify-center rounded-lg border-2 border-orange-300 text-center text-[10px] font-black uppercase text-orange-700">
            {fallbackText(draft.statusLabel, 'Postcard')}
          </div>
          <div className="mt-5 space-y-2">
            {highlights.slice(0, 4).map((highlight, index) => (
              <PostcardMarkdown key={`${highlight}-${index}`} value={`${index + 1}. ${highlight}`} className="text-xs font-semibold leading-5 text-slate-700" />
            ))}
          </div>
          <div className="mt-auto text-xs font-bold text-slate-500">{buildMetaLine(draft)}</div>
        </div>
      </div>
    </div>
  );
}

function MetricSnapshotPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);
  const bars = [82, 56, 68, 44];

  return (
    <div className="flex h-full min-h-[390px] flex-col overflow-hidden bg-emerald-950 text-white">
      <div className="flex items-center justify-between px-8 py-5">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">{fallbackText(draft.eyebrow, 'Metric snapshot')}</div>
          <h3 className="mt-2 break-words text-2xl font-black leading-tight">{fallbackText(draft.title, 'Conversation postcard')}</h3>
        </div>
        <div className="rounded-2xl bg-emerald-300 px-4 py-3 text-center text-emerald-950">
          <div className="text-[10px] font-black uppercase">Status</div>
          <div className="text-sm font-black">{fallbackText(draft.statusLabel, 'Snapshot')}</div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[0.9fr_1.1fr] gap-5 px-8 pb-8">
        <div className="space-y-3">
          {bars.map((height, index) => (
            <div key={height} className="rounded-xl bg-white/10 p-3">
              <div className="mb-2 text-[10px] font-bold uppercase text-emerald-200">Signal {index + 1}</div>
              <div className="h-2 rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-300" style={{ width: `${height}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <PostcardMarkdown value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')} className="text-sm leading-6 text-emerald-50" />
          <div className="mt-4 space-y-2">
            {highlights.slice(0, 3).map((highlight, index) => (
              <PostcardMarkdown key={`${highlight}-${index}`} value={highlight} className="rounded-lg bg-black/15 px-3 py-2 text-xs leading-5 text-emerald-50" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineCardPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="flex h-full min-h-[390px] flex-col overflow-hidden bg-blue-50 text-slate-950">
      <div className="bg-blue-700 px-8 py-6 text-white">
        <div className="text-xs font-black uppercase tracking-[0.24em] text-blue-100">{fallbackText(draft.eyebrow, 'Timeline card')}</div>
        <h3 className="mt-3 break-words text-3xl font-black leading-tight">{fallbackText(draft.title, 'Conversation postcard')}</h3>
      </div>
      <div className="grid flex-1 grid-cols-[1fr_1.05fr] gap-6 p-8">
        <PostcardMarkdown value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')} className="text-sm leading-6 text-slate-700" />
        <div className="relative space-y-3">
          <div className="absolute bottom-2 left-[11px] top-2 w-px bg-blue-200" aria-hidden="true" />
          {highlights.slice(0, 4).map((highlight, index) => (
            <div key={`${highlight}-${index}`} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3">
              <span className="relative z-10 mt-1 h-6 w-6 rounded-full border-4 border-blue-50 bg-blue-600" />
              <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 shadow-sm">
                <div className="text-[10px] font-black uppercase text-blue-600">Step {index + 1}</div>
                <PostcardMarkdown value={highlight} className="mt-1 text-xs leading-5 text-slate-700" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuoteCardPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative flex h-full min-h-[390px] flex-col overflow-hidden bg-fuchsia-950 p-8 text-white">
      <div className="absolute -right-10 -top-16 text-[220px] font-black leading-none text-white/10" aria-hidden="true">"</div>
      <div className="text-xs font-black uppercase tracking-[0.24em] text-fuchsia-200">{fallbackText(draft.eyebrow, 'Quote card')}</div>
      <h3 className="mt-5 max-w-[88%] break-words text-3xl font-black leading-tight">{fallbackText(draft.title, 'Conversation postcard')}</h3>
      <PostcardMarkdown
        value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')}
        className="mt-6 border-l-4 border-fuchsia-300 pl-5 text-lg font-semibold leading-7 text-fuchsia-50"
      />
      <div className="mt-auto grid grid-cols-3 gap-3 pt-6">
        {highlights.slice(0, 3).map((highlight, index) => (
          <PostcardMarkdown key={`${highlight}-${index}`} value={highlight} className="rounded-xl bg-white/10 p-3 text-xs leading-5 text-fuchsia-50" />
        ))}
      </div>
      <div className="mt-4 flex justify-between text-xs font-semibold text-fuchsia-200">
        <span>{fallbackText(draft.sourceLabel, 'Open Deskmate')}</span>
        <span>{fallbackText(draft.dateLabel, formatTodayLabel())}</span>
      </div>
    </div>
  );
}

function NotebookNotePreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative h-full min-h-[390px] overflow-hidden bg-yellow-100 p-7 text-slate-950">
      <div className="absolute inset-y-0 left-12 w-px bg-red-300" aria-hidden="true" />
      <div
        className="h-full rounded-xl border border-yellow-300 bg-yellow-50 p-7 pl-10 shadow-inner"
        style={{ backgroundImage: 'repeating-linear-gradient(to bottom, #fffbea 0, #fffbea 31px, #fde68a 32px)' }}
      >
        <div className="text-xs font-black uppercase tracking-[0.18em] text-yellow-700">{fallbackText(draft.eyebrow, 'Notebook note')}</div>
        <h3 className="mt-3 break-words text-3xl font-black leading-tight">{fallbackText(draft.title, 'Conversation postcard')}</h3>
        <PostcardMarkdown value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')} className="mt-4 text-sm leading-8 text-slate-700" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {highlights.slice(0, 4).map((highlight, index) => (
            <PostcardMarkdown key={`${highlight}-${index}`} value={`- ${highlight}`} className="text-xs font-semibold leading-6 text-slate-700" />
          ))}
        </div>
        <div className="mt-auto pt-4 text-xs font-bold text-yellow-700">{buildMetaLine(draft)}</div>
      </div>
    </div>
  );
}

function AnnouncementCardPreview({ draft }: { draft: ChatPostcardDraft }) {
  const highlights = draft.highlights.length ? draft.highlights : deriveHighlights(draft.summary);

  return (
    <div className="relative flex h-full min-h-[390px] flex-col overflow-hidden bg-indigo-600 text-white">
      <div className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full bg-cyan-300/30" aria-hidden="true" />
      <div className="absolute -left-16 -top-20 h-64 w-64 rounded-full bg-white/10" aria-hidden="true" />
      <div className="relative flex h-full flex-col p-8">
        <div className="inline-flex w-fit rounded-full bg-white px-4 py-1 text-xs font-black uppercase tracking-wide text-indigo-700">
          {fallbackText(draft.statusLabel, 'Announce')}
        </div>
        <h3 className="mt-6 max-w-[86%] break-words text-4xl font-black leading-none">{fallbackText(draft.title, 'Conversation postcard')}</h3>
        <PostcardMarkdown value={fallbackText(draft.summary, 'Add the main result, context, and next action here.')} className="mt-5 max-w-[88%] text-base font-medium leading-7 text-indigo-50" />
        <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
          {highlights.slice(0, 4).map((highlight, index) => (
            <PostcardMarkdown key={`${highlight}-${index}`} value={highlight} className="rounded-xl bg-white/15 p-3 text-xs leading-5 text-white" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PostcardPreview({ draft }: { draft: ChatPostcardDraft }) {
  if (draft.templateId === 'client-update') return <ClientUpdatePreview draft={draft} />;
  if (draft.templateId === 'research-card') return <ResearchCardPreview draft={draft} />;
  if (draft.templateId === 'decision-record') return <DecisionRecordPreview draft={draft} />;
  if (draft.templateId === 'executive-brief') return <ExecutiveBriefPreview draft={draft} />;
  if (draft.templateId === 'editorial-cover') return <EditorialCoverPreview draft={draft} />;
  if (draft.templateId === 'classic-postcard') return <ClassicPostcardPreview draft={draft} />;
  if (draft.templateId === 'metric-snapshot') return <MetricSnapshotPreview draft={draft} />;
  if (draft.templateId === 'timeline-card') return <TimelineCardPreview draft={draft} />;
  if (draft.templateId === 'quote-card') return <QuoteCardPreview draft={draft} />;
  if (draft.templateId === 'notebook-note') return <NotebookNotePreview draft={draft} />;
  if (draft.templateId === 'announcement-card') return <AnnouncementCardPreview draft={draft} />;
  return <CleanSummaryPreview draft={draft} />;
}

export function ChatPostcardDialog({
  open,
  onOpenChange,
  defaultTemplateId = 'clean-summary',
  initialDraft,
  draft,
  onDraftChange,
  onExportPng,
  onCopyPng,
  onAttachToWorkboard,
  exportLabel = 'Export PNG',
  copyLabel = 'Copy PNG',
  attachLabel = 'Attach to Workboard',
  isExporting = false,
  isCopying = false,
  isAttaching = false,
  errorMessage,
  className,
}: ChatPostcardDialogProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [internalDraft, setInternalDraft] = useState<ChatPostcardDraft>(() => (
    normalizeDraft(initialDraft, defaultTemplateId)
  ));
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current && !draft) {
      setInternalDraft(normalizeDraft(initialDraft, defaultTemplateId));
    }
    wasOpenRef.current = true;
  }, [defaultTemplateId, draft, initialDraft, open]);

  const activeDraft = useMemo(
    () => normalizeDraft(draft || internalDraft, defaultTemplateId),
    [defaultTemplateId, draft, internalDraft]
  );
  const activeTemplate = CHAT_POSTCARD_TEMPLATES[activeDraft.templateId];
  const highlightsValue = activeDraft.highlights.join('\n');
  const anyBusy = isExporting || isCopying || isAttaching || pendingAction !== null;

  const commitDraft = (nextDraft: ChatPostcardDraft) => {
    if (!draft) setInternalDraft(nextDraft);
    onDraftChange?.(nextDraft);
  };

  const updateDraft = (patch: Partial<ChatPostcardDraft>) => {
    commitDraft({ ...activeDraft, ...patch });
  };

  const runAction = async (
    action: PendingAction,
    handler: (payload: ChatPostcardActionPayload) => void | Promise<void>
  ) => {
    const element = previewRef.current;
    if (!element) return;
    setPendingAction(action);
    try {
      await handler({
        element,
        draft: activeDraft,
        template: activeTemplate,
        templateId: activeDraft.templateId,
      });
    } finally {
      setPendingAction((current) => (current === action ? null : current));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('w-[96vw] max-w-5xl gap-0 overflow-hidden p-0 sm:rounded-2xl', className)}>
        <div className="flex max-h-[92vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4 text-left">
            <DialogTitle className="tracking-normal">Create postcard</DialogTitle>
            <DialogDescription>Turn the current chat into a shareable visual card.</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="chat-motion-fade-slide space-y-5 border-b border-border/70 p-5 lg:border-b-0 lg:border-r">
              <div className="space-y-2">
                <FieldLabel>Template</FieldLabel>
                <div className="grid max-h-[390px] gap-2 overflow-y-auto pr-1">
                  {TEMPLATE_LIST.map((template) => {
                    const selected = activeDraft.templateId === template.id;
                    const TemplateIcon = template.icon;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        aria-pressed={selected}
                        className={cn(
                          'chat-motion-soft flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                          selected
                            ? 'border-primary/60 bg-primary/10 text-foreground shadow-soft'
                            : 'border-border/70 bg-background text-muted-foreground hover:border-primary/40 hover:bg-accent/50 hover:text-foreground'
                        )}
                        onClick={() => updateDraft({
                          templateId: template.id,
                          eyebrow: activeDraft.eyebrow === activeTemplate.label ? template.label : activeDraft.eyebrow,
                          statusLabel: activeDraft.statusLabel === activeTemplate.shortLabel ? template.shortLabel : activeDraft.statusLabel,
                        })}
                      >
                        <span className={cn('h-8 w-2 shrink-0 rounded-full', template.swatchClassName)} />
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                          <TemplateIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{template.label}</span>
                          <span className="block text-xs leading-4 text-muted-foreground">{template.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5">
                    <FieldLabel>Eyebrow</FieldLabel>
                    <Input value={activeDraft.eyebrow} onChange={(event) => updateDraft({ eyebrow: event.target.value })} />
                  </label>
                  <label className="grid gap-1.5">
                    <FieldLabel>Status</FieldLabel>
                    <Input value={activeDraft.statusLabel} onChange={(event) => updateDraft({ statusLabel: event.target.value })} />
                  </label>
                </div>

                <label className="grid gap-1.5">
                  <FieldLabel>Title</FieldLabel>
                  <Input value={activeDraft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
                </label>

                <label className="grid gap-1.5">
                  <FieldLabel>Subtitle</FieldLabel>
                  <Input value={activeDraft.subtitle} onChange={(event) => updateDraft({ subtitle: event.target.value })} />
                </label>

                <label className="grid gap-1.5">
                  <FieldLabel>Summary</FieldLabel>
                  <Textarea
                    value={activeDraft.summary}
                    className="min-h-24 resize-none"
                    onChange={(event) => updateDraft({ summary: event.target.value })}
                  />
                </label>

                <label className="grid gap-1.5">
                  <FieldLabel>Highlights</FieldLabel>
                  <Textarea
                    value={highlightsValue}
                    className="min-h-28 resize-none"
                    onChange={(event) => updateDraft({ highlights: splitHighlights(event.target.value) })}
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5">
                    <FieldLabel>Source</FieldLabel>
                    <Input value={activeDraft.sourceLabel} onChange={(event) => updateDraft({ sourceLabel: event.target.value })} />
                  </label>
                  <label className="grid gap-1.5">
                    <FieldLabel>Date</FieldLabel>
                    <Input value={activeDraft.dateLabel} onChange={(event) => updateDraft({ dateLabel: event.target.value })} />
                  </label>
                </div>

                <label className="grid gap-1.5">
                  <FieldLabel>Footer</FieldLabel>
                  <Input value={activeDraft.footer} onChange={(event) => updateDraft({ footer: event.target.value })} />
                </label>
              </div>
            </div>

            <div className="chat-motion-fade-slide flex min-h-[520px] items-center justify-center bg-muted/30 p-5">
              <div className="w-full max-w-[560px]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Preview</div>
                    <div className="truncate text-sm font-medium text-foreground">{activeTemplate.label}</div>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    PNG ready
                  </Badge>
                </div>
                <div
                  key={activeDraft.templateId}
                  ref={previewRef}
                  data-chat-postcard-capture="true"
                  data-chat-postcard-template={activeDraft.templateId}
                  className="chat-postcard-preview chat-motion-pop aspect-[4/3] w-full overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl"
                  aria-label={`${activeTemplate.label} postcard preview`}
                >
                  <PostcardPreview draft={activeDraft} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-border/70 px-5 py-4 sm:space-x-0">
            {errorMessage ? (
              <div className="mr-auto min-w-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}
            {onAttachToWorkboard ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction('attach', onAttachToWorkboard)}
                disabled={anyBusy}
              >
                {isAttaching || pendingAction === 'attach' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                {attachLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => void runAction('copy', onCopyPng)}
              disabled={anyBusy}
            >
              {isCopying || pendingAction === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {copyLabel}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={() => void runAction('export', onExportPng)}
              disabled={anyBusy}
            >
              {isExporting || pendingAction === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exportLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ChatPostcardDialog;
