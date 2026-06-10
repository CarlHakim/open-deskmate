import Store from 'electron-store';
import type {
  ProviderPricingRow,
  ProviderType,
  UsagePricingAutofillRequest,
  UsagePricingAutofillResult,
} from '@accomplish/shared';
import type { TokenTurnLog } from '../store/tokenUsage';

type TokenUsageSchema = { turns: TokenTurnLog[] };
const tokenUsageStore = new Store<TokenUsageSchema>({ name: 'token-usage', defaults: { turns: [] } });

const DEFAULT_TIMEOUT_MS = 20_000;

function key(provider: ProviderType, model: string | null | undefined): string {
  return `${provider}:${model ?? 'default'}`;
}

function normalizeProviderModel(target: { provider: ProviderType; model: string | null }): { provider: ProviderType; model: string | null } {
  const provider = target.provider;
  let model = target.model;
  if (!model) return { provider, model: null };

  // Accept "provider/model" forms passed from UI/logs.
  const slashIdx = model.indexOf('/');
  if (slashIdx > 0) {
    const maybeProvider = model.slice(0, slashIdx).toLowerCase();
    const maybeModel = model.slice(slashIdx + 1);
    if (maybeProvider === provider) {
      model = maybeModel;
    }
  }

  // Canonicalize common variations.
  model = model.trim();
  if (!model) return { provider, model: null };

  // Anthropic: allow dots in "4.5" -> "4-5" to match our ids.
  if (provider === 'anthropic') {
    model = model.toLowerCase().replace(/4\.5/g, '4-5');
  }

  // OpenAI: normalize casing and common GPT prefixes.
  if (provider === 'openai') {
    model = model.toLowerCase();
    model = model.replace(/^gpt[\s_-]*/i, 'gpt-');
  }

  // xAI: normalize grok variants.
  if (provider === 'xai') {
    model = model.toLowerCase().replace(/\s+/g, '-');
  }

  // Google: normalize gemini variants.
  if (provider === 'google') {
    model = model.toLowerCase().replace(/\s+/g, '-');
  }

  return { provider, model };
}

function toNumberOrNull(input: string | undefined): number | null {
  if (!input) return null;
  const normalized = input.replace(/[^0-9.]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

type PricePair = {
  inputHitCostPer1m: number | null;
  inputMissCostPer1m: number | null;
  outputCostPer1m: number | null;
  sourceUrl: string;
  note?: string;
  confidence: 'high' | 'medium' | 'low';
};

async function resolveOpenAIPricing(model: string): Promise<PricePair | null> {
  const sourceUrl = 'https://platform.openai.com/pricing';
  const html = await fetchText(sourceUrl);
  const text = stripHtml(html);

  // Normalize model label for the pricing page (likely "GPT-5.2", etc).
  const pageLabel = (() => {
    if (/^gpt-5\.2/i.test(model)) return 'GPT-5.2';
    if (/^gpt-5\.1/i.test(model)) return 'GPT-5.1';
    if (/^gpt-5$/i.test(model)) return 'GPT-5';
    if (/^gpt-5-codex/i.test(model)) return 'GPT-5 Codex';
    return model.toUpperCase();
  })();

  const idx = text.toLowerCase().indexOf(pageLabel.toLowerCase());
  if (idx === -1) return null;
  const window = text.slice(idx, Math.min(text.length, idx + 1200));
  const dollars = Array.from(window.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)).map((m) => toNumberOrNull(m[1])).filter((n): n is number => n != null);
  if (dollars.length < 2) return null;
  // Most OpenAI tables are: input, cached input, output. If 3+ values, use 1st and 3rd; else 1st and 2nd.
  const inputMiss = dollars[0] ?? null;
  const inputHit = dollars.length >= 3 ? dollars[1] ?? null : null;
  const output = (dollars[2] ?? dollars[1]) ?? null;
  return { inputHitCostPer1m: inputHit, inputMissCostPer1m: inputMiss, outputCostPer1m: output, sourceUrl, confidence: dollars.length >= 3 ? 'medium' : 'low' };
}

async function resolveAnthropicPricing(model: string): Promise<PricePair | null> {
  // Anthropic pricing page (docs) contains a pricing table with MTok prices.
  const sourceUrl = 'https://docs.anthropic.com/en/docs/about-claude/pricing';
  const html = await fetchText(sourceUrl);
  const text = stripHtml(html);

  // Map our internal ids to the human labels typically used in tables.
  const labelByModel: Record<string, string> = {
    'claude-opus-4-5': 'Claude Opus 4.5',
    'claude-sonnet-4-5': 'Claude Sonnet 4.5',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
  };
  const label = labelByModel[model] ?? model;

  const idx = text.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;
  const window = text.slice(idx, Math.min(text.length, idx + 1200));
  const dollars = Array.from(window.matchAll(/\$\\s*([0-9]+(?:\.[0-9]+)?)/g))
    .map((m) => toNumberOrNull(m[1]))
    .filter((n): n is number => n != null);
  if (dollars.length < 2) return null;
  return { inputHitCostPer1m: null, inputMissCostPer1m: dollars[0], outputCostPer1m: dollars[1], sourceUrl, confidence: 'medium' };
}

async function resolveGooglePricing(model: string): Promise<PricePair | null> {
  const sourceUrl = 'https://ai.google.dev/pricing';
  const html = await fetchText(sourceUrl);
  const text = stripHtml(html);

  // The pricing page may refer to display names; we approximate by matching "Gemini 3 Pro" / "Gemini 3 Flash".
  const labelByModel: Record<string, string> = {
    'gemini-3-pro-preview': 'Gemini 3 Pro',
    'gemini-3-flash-preview': 'Gemini 3 Flash',
  };
  const label = labelByModel[model] ?? model;

  const blockIdx = text.toLowerCase().indexOf(label.toLowerCase());
  if (blockIdx === -1) return null;
  const window = text.slice(blockIdx, Math.min(text.length, blockIdx + 2600));

  // Prefer "per 1M tokens" prices within the model section.
  const per1mRe = /\$([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*1m|per\s*1m|\s*1m)\s*tokens?/gi;
  const per1m = Array.from(window.matchAll(per1mRe))
    .map((m) => toNumberOrNull(m[1]))
    .filter((n): n is number => n != null);

  // As a fallback, capture first "Input ... $" and "Output ... $" values.
  const inputRe = /\bInput\b[\s\S]{0,160}?\$([0-9]+(?:\.[0-9]+)?)/i;
  const outputRe = /\bOutput\b[\s\S]{0,160}?\$([0-9]+(?:\.[0-9]+)?)/i;
  const mi = window.match(inputRe);
  const mo = window.match(outputRe);

  const input = per1m[0] ?? toNumberOrNull(mi?.[1]);
  const output = per1m[1] ?? toNumberOrNull(mo?.[1]);
  if (input == null || output == null) return null;

  return {
    inputHitCostPer1m: null,
    inputMissCostPer1m: input,
    outputCostPer1m: output,
    sourceUrl,
    confidence: per1m.length >= 2 ? 'medium' : 'low',
    note: per1m.length >= 2 ? undefined : 'Parsed from the pricing page; tier selection may differ by prompt size.',
  };
}

async function resolveXaiPricing(model: string): Promise<PricePair | null> {
  // xAI docs have per-model pages, but slugs vary; probe a small set.
  const candidates = [
    `https://docs.x.ai/docs/models/${model}`,
    `https://docs.x.ai/docs/models/${model.replace(/_/g, '-')}`,
    `https://docs.x.ai/docs/models/${model.toLowerCase()}`,
  ];
  let sourceUrl = candidates[0];
  let text = '';
  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const html = await fetchText(url);
      sourceUrl = url;
      text = stripHtml(html);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!text) throw (lastErr instanceof Error ? lastErr : new Error('Failed to fetch xAI docs'));

  // Look for "Input Tokens" and "Output Tokens" and a $/1M amount nearby.
  const inputRe = /\bInput Tokens\b[\s\S]{0,120}?\$([0-9.]+)/i;
  const outputRe = /\bOutput Tokens\b[\s\S]{0,120}?\$([0-9.]+)/i;
  const mi = text.match(inputRe);
  const mo = text.match(outputRe);
  if (!mi || !mo) return null;
  return {
    inputHitCostPer1m: null,
    inputMissCostPer1m: toNumberOrNull(mi[1]),
    outputCostPer1m: toNumberOrNull(mo[1]),
    sourceUrl,
    confidence: 'medium',
  };
}

async function resolvePricing(provider: ProviderType, model: string | null): Promise<PricePair | null> {
  if (!model) return null;
  if (provider === 'openai') return resolveOpenAIPricing(model);
  if (provider === 'anthropic') return resolveAnthropicPricing(model);
  if (provider === 'google') return resolveGooglePricing(model);
  if (provider === 'xai') return resolveXaiPricing(model);
  return null;
}

export async function suggestPricingFromInternet(
  request: UsagePricingAutofillRequest,
): Promise<UsagePricingAutofillResult> {
  const now = new Date().toISOString();
  const meta: UsagePricingAutofillResult['meta'] = {};

  const targets = Array.isArray(request.targets) ? request.targets : [];
  const uniqueTargets: Array<{ provider: ProviderType; model: string | null }> = [];
  const seen = new Set<string>();
  for (const t of targets) {
    const normalized = normalizeProviderModel({ provider: t.provider, model: t.model ?? null });
    const k = key(normalized.provider, normalized.model);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueTargets.push(normalized);
  }

  const providers: ProviderPricingRow[] = [];
  let foundAny = false;

  for (const t of uniqueTargets) {
    const rowBase: ProviderPricingRow = {
      provider: t.provider,
      model: t.model,
      inputHitCostPer1m: null,
      inputMissCostPer1m: null,
      outputCostPer1m: null,
      effectiveFrom: null,
      pricingSource: 'ai',
      pricingUpdatedAt: now,
      createdAt: now,
    };

    try {
      const resolved = await resolvePricing(t.provider, t.model);
      if (!resolved) {
        providers.push(rowBase);
        meta[key(t.provider, t.model)] = {
          confidence: 'low',
          note: t.model
            ? 'No pricing found for this provider/model.'
            : 'Provider default does not map to a single public price. Select specific models to fetch pricing.',
        };
        continue;
      }
      foundAny = true;
      providers.push({
        ...rowBase,
        inputHitCostPer1m: resolved.inputHitCostPer1m,
        inputMissCostPer1m: resolved.inputMissCostPer1m,
        outputCostPer1m: resolved.outputCostPer1m,
      });
      meta[key(t.provider, t.model)] = {
        confidence: resolved.confidence,
        sourceUrl: resolved.sourceUrl,
        note: resolved.note,
      };
    } catch (err) {
      providers.push(rowBase);
      meta[key(t.provider, t.model)] = {
        confidence: 'low',
        note: err instanceof Error ? err.message : 'Failed to fetch pricing.',
      };
    }
  }

  // If user provided no targets, detect providers/models from usage logs.
  if (uniqueTargets.length === 0) {
    const turns = tokenUsageStore.get('turns') ?? [];
    const used = Array.from(new Set(turns.map((t) => key(t.provider, t.model))));
    for (const k of used.slice(0, 50)) {
      meta[k] = { confidence: 'low', note: 'No targets selected.' };
    }
  }

  return {
    currency: request.currency ?? 'USD',
    providers,
    meta,
    generatedAt: now,
    message: foundAny
      ? 'Auto-fill provides estimates based on publicly available pricing. Please review before saving.'
      : 'No pricing could be found for the selected provider/models. You can still enter pricing manually.',
  };
}
