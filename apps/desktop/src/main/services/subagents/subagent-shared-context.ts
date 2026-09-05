import type { SubagentProgressEvent, SubagentSharedBlockedSource, SubagentSharedContext, SubagentRunRecord, ToolsetId } from '@accomplish/shared';
import { listSubagentRuns } from '../../store/subagentRegistry';

const URL_PATTERN = /https?:\/\/[^\s"'<>),\]]+/gi;
const HTTP_STATUS_PATTERN = /\b(?:http\s*)?(401|403|404|408|409|429|500|502|503|504)\b/i;
const KNOWN_SOURCE_DOMAINS: Array<[RegExp, string]> = [
  [/\bg2\b|\bg2\.com\b/i, 'g2.com'],
  [/\bcapterra\b|\bcapterra\.com\b/i, 'capterra.com'],
  [/\btrust\s?radius\b|\btrustradius\.com\b/i, 'trustradius.com'],
  [/\bcloudflare\b/i, 'cloudflare-protected-site'],
];

function normalizeWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max = 320): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;
}

function domainFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function inferKnownDomain(text: string): string | undefined {
  for (const [pattern, domain] of KNOWN_SOURCE_DOMAINS) {
    if (pattern.test(text)) return domain;
  }
  return undefined;
}

function inferFailureKind(text: string, httpStatus?: number): SubagentProgressEvent['failureKind'] | undefined {
  const lower = text.toLowerCase();
  if (/\bcloudflare\b|\battention required\b|\bddos protection\b/.test(lower)) return 'cloudflare';
  if (/\bcaptcha\b|\bverify you are human\b|\bchecking your browser\b/.test(lower)) return 'captcha';
  if (/\blogin\b|\bsign in\b|\bsubscription\b|\bpaywall\b|\baccess denied\b|\bforbidden\b/.test(lower)) return 'login_wall';
  if (/\btool\b.{0,80}\b(unavailable|not available|not wired|not found|missing)\b/.test(lower)) return 'tool_unavailable';
  if (/\bpermission\b|\bnot allowed\b|\bdenied\b/.test(lower)) return 'permission';
  if (/\brepeated\b|\bretry loop\b|\bstuck\b|\bloop\b/.test(lower)) return 'loop';
  if (httpStatus && httpStatus >= 400) return 'http_error';
  return undefined;
}

function inferFallback(text: string, failureKind?: SubagentProgressEvent['failureKind']): string | undefined {
  const lower = text.toLowerCase();
  if (/\bdev-browser\b|\bplaywright\b|\bbrowser\b/.test(lower)) return 'Use dev-browser/browser inspection instead of raw fetch for blocked web pages.';
  if (/\breddit\b|\bforum\b|\bofficial\b|\bvendor\b|\bdocs?\b/.test(lower)) return 'Use official pages, vendor docs, forums, Reddit, or public snippets as alternate sources.';
  if (failureKind === 'cloudflare' || failureKind === 'captcha' || failureKind === 'login_wall' || failureKind === 'http_error') {
    return 'Avoid retrying this source; switch to official pages, public forums, search snippets, or dev-browser.';
  }
  if (failureKind === 'tool_unavailable') return 'Enable the smallest matching toolset or choose an available fallback tool.';
  return undefined;
}

export function extractSubagentFailureSignals(input: {
  text?: string;
  toolName?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}): Partial<Pick<SubagentProgressEvent, 'sourceUrl' | 'domain' | 'httpStatus' | 'failureKind' | 'fallbackSuggested'>> {
  const text = normalizeWhitespace([
    input.text,
    input.toolName,
    input.metadata?.sourceUrl,
    input.metadata?.url,
    input.metadata?.domain,
    input.metadata?.httpStatus,
    input.metadata?.statusCode,
    input.metadata?.error,
  ].filter(Boolean).join(' '));
  const explicitUrl = typeof input.sourceUrl === 'string' ? input.sourceUrl : undefined;
  const url = explicitUrl || text.match(URL_PATTERN)?.[0];
  const rawStatus = typeof input.metadata?.httpStatus === 'number'
    ? input.metadata.httpStatus
    : typeof input.metadata?.statusCode === 'number'
      ? input.metadata.statusCode
      : Number(text.match(HTTP_STATUS_PATTERN)?.[1]);
  const httpStatus = Number.isFinite(rawStatus) ? rawStatus : undefined;
  const domain = domainFromUrl(url) || (typeof input.metadata?.domain === 'string' ? input.metadata.domain : undefined) || inferKnownDomain(text);
  const failureKind = inferFailureKind(text, httpStatus);
  if (!domain && !httpStatus && !failureKind) return {};
  return {
    sourceUrl: url,
    domain,
    httpStatus,
    failureKind,
    fallbackSuggested: inferFallback(text, failureKind),
  };
}

function addBlockedSource(
  map: Map<string, SubagentSharedBlockedSource>,
  event: SubagentProgressEvent,
): void {
  const signals = extractSubagentFailureSignals({
    text: [event.title, event.detail].filter(Boolean).join(' '),
    toolName: event.toolName,
    sourceUrl: event.sourceUrl,
    metadata: event.metadata,
  });
  const domain = event.domain || signals.domain;
  const sourceUrl = event.sourceUrl || signals.sourceUrl;
  const httpStatus = event.httpStatus ?? signals.httpStatus;
  const failureKind = event.failureKind || signals.failureKind;
  if (!domain && !sourceUrl && !httpStatus && !failureKind) return;
  const key = [domain || sourceUrl || 'unknown-source', httpStatus || '', failureKind || ''].join('|');
  const existing = map.get(key);
  const timestamp = event.timestamp;
  const example = truncate(normalizeWhitespace(event.detail || event.title || sourceUrl || domain || 'Blocked source'));
  if (!existing) {
    map.set(key, {
      domain,
      sourceUrl,
      httpStatus,
      failureKind,
      count: 1,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      example,
    });
    return;
  }
  existing.count += 1;
  existing.lastSeenAt = timestamp > existing.lastSeenAt ? timestamp : existing.lastSeenAt;
  if (!existing.example && example) existing.example = example;
}

function addUnique(values: string[], value: unknown, max: number): void {
  const text = truncate(normalizeWhitespace(value), 360);
  if (!text || values.includes(text) || values.length >= max) return;
  values.push(text);
}

export function buildSubagentSharedContext(parentTaskId: string, options?: { excludeRunId?: string }): SubagentSharedContext {
  const blockedMap = new Map<string, SubagentSharedBlockedSource>();
  const blockedTools: string[] = [];
  const successfulFallbacks: string[] = [];
  const confirmedFindings: string[] = [];
  const openGaps: string[] = [];

  for (const run of listSubagentRuns(parentTaskId, { includeArchived: true })) {
    if (options?.excludeRunId && run.runId === options.excludeRunId) continue;
    for (const event of run.progressEvents || []) {
      addBlockedSource(blockedMap, event);
      if (event.failureKind === 'tool_unavailable' && event.toolName) addUnique(blockedTools, event.toolName, 8);
      const text = normalizeWhitespace([event.title, event.detail].filter(Boolean).join(' '));
      if (/\bfallback\b|\bswitched to\b|\bused dev-browser\b|\bused browser\b/i.test(text)) {
        addUnique(successfulFallbacks, text, 8);
      }
      if (/\bverified\b|\bconfirmed\b|\bfound\b|\bsource\b/i.test(text) && !event.failureKind) {
        addUnique(confirmedFindings, text, 10);
      }
      if (/\bgap\b|\bmissing\b|\bcould not verify\b|\bunverified\b/i.test(text)) {
        addUnique(openGaps, text, 8);
      }
    }
    if (run.resultBundle?.summary) addUnique(confirmedFindings, run.resultBundle.summary, 10);
    if (run.error) addUnique(openGaps, run.error, 8);
  }

  return {
    parentTaskId,
    generatedAt: new Date().toISOString(),
    blockedSources: [...blockedMap.values()]
      .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 12),
    blockedTools,
    successfulFallbacks,
    confirmedFindings,
    openGaps,
  };
}

export function formatSubagentSharedContextForPrompt(context?: SubagentSharedContext): string {
  if (!context) return '';
  const lines: string[] = [];
  if (context.blockedSources.length) {
    lines.push('Shared blocked sources for this parent task:');
    for (const source of context.blockedSources.slice(0, 8)) {
      const label = source.domain || source.sourceUrl || 'unknown source';
      const status = source.httpStatus ? ` HTTP ${source.httpStatus}` : '';
      const kind = source.failureKind ? ` ${source.failureKind}` : '';
      lines.push(`- ${label}${status}${kind} (${source.count}x). Avoid retry loops; switch source type. ${source.example || ''}`.trim());
    }
  }
  if (context.blockedTools.length) {
    lines.push('Unavailable or blocked tools already seen:', ...context.blockedTools.slice(0, 6).map((tool) => `- ${tool}`));
  }
  if (context.successfulFallbacks.length) {
    lines.push('Fallbacks that helped in this parent task:', ...context.successfulFallbacks.slice(0, 5).map((item) => `- ${item}`));
  }
  if (context.confirmedFindings.length) {
    lines.push('Useful findings already collected:', ...context.confirmedFindings.slice(0, 5).map((item) => `- ${item}`));
  }
  if (context.openGaps.length) {
    lines.push('Open gaps from earlier helper work:', ...context.openGaps.slice(0, 5).map((item) => `- ${item}`));
  }
  return lines.length ? ['<subagent_shared_context>', ...lines, '</subagent_shared_context>'].join('\n') : '';
}

export function formatInheritedToolContextForPrompt(params: {
  toolsetIds?: readonly ToolsetId[];
  enabledToolsetIds?: readonly ToolsetId[];
  availableToolsetIds?: readonly ToolsetId[];
  deferredToolDiscoveryEnabled?: boolean;
}): string {
  const enabled = params.enabledToolsetIds?.length ? params.enabledToolsetIds : params.toolsetIds;
  if (!enabled?.length && !params.availableToolsetIds?.length) return '';
  return [
    '<subagent_inherited_tools>',
    `Deferred tool discovery: ${params.deferredToolDiscoveryEnabled ? 'on' : 'off'}.`,
    `Tools inherited/enabled for this child: ${enabled?.join(', ') || 'none'}.`,
    params.availableToolsetIds?.length ? `Available toolsets for this child: ${params.availableToolsetIds.join(', ')}.` : '',
    'Use these capabilities when needed. If a web source is blocked, switch strategy instead of retrying the same source.',
    '</subagent_inherited_tools>',
  ].filter(Boolean).join('\n');
}
