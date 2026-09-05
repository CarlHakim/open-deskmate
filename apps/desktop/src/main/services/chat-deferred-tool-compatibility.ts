import type {
  ChatDeferredCompatibilityAvailability,
  ChatDeferredCompatibilityCaseId,
  ChatDeferredCompatibilityCaseResult,
  ChatDeferredCompatibilityDeferredAvailability,
  ChatDeferredCompatibilityProofResult,
  ChatDeferredCompatibilityRequest,
  ChatDeferredCompatibilityTokenEstimate,
  ToolsetId,
  ToolsetResolution,
} from '@accomplish/shared';
import { estimateTokens } from './context/token-estimator';
import { resolveToolsets } from './toolsets';

export const CHAT_DEFERRED_COMPATIBILITY_PACK_VERSION = 'chat-deferred-tool-compatibility-v1';

export const DEFAULT_CHAT_DEFERRED_BASELINE_TOOLSET_IDS: ToolsetId[] = ['desktop_full', 'custom'];
export const DEFAULT_CHAT_DEFERRED_MINIMAL_TOOLSET_IDS: ToolsetId[] = ['chat_safe'];
export const DEFAULT_CHAT_DEFERRED_DEFERRED_TOOLSET_IDS: ToolsetId[] = ['desktop_full', 'custom'];

interface ChatDeferredRegressionCase {
  id: ChatDeferredCompatibilityCaseId;
  name: string;
  description: string;
  prompt: string;
  requiredCapabilities: string[];
  requiredToolNames: string[];
}

const CHAT_DEFERRED_REGRESSION_PACK: ChatDeferredRegressionCase[] = [
  {
    id: 'plain_chat',
    name: 'Plain chat',
    description: 'Answer a normal conversational question without external tool use.',
    prompt: 'Explain what OpenDeskmate can do in one concise paragraph.',
    requiredCapabilities: ['chat_response', 'ask_user'],
    requiredToolNames: [],
  },
  {
    id: 'web_lookup',
    name: 'Web lookup',
    description: 'Search and fetch current or source-backed web information.',
    prompt: 'Look up a current source-backed answer and cite the page you used.',
    requiredCapabilities: ['chat_response', 'web_research'],
    requiredToolNames: ['websearch', 'webfetch'],
  },
  {
    id: 'image_url_answer',
    name: 'Image URL answer',
    description: 'Answer from an image URL or fetched page context without relying on local files.',
    prompt: 'The image at https://example.com/diagram.png shows a workflow. Explain what it communicates.',
    requiredCapabilities: ['chat_response', 'image_url_context'],
    requiredToolNames: ['webfetch'],
  },
  {
    id: 'attachment_summary',
    name: 'Attachment summary',
    description: 'Summarize files attached through the Chat composer.',
    prompt: 'Summarize the attached PDF and extract the action items.',
    requiredCapabilities: ['chat_response', 'attachment_context'],
    requiredToolNames: ['read'],
  },
  {
    id: 'saved_prompt_skill',
    name: 'Saved prompt and skill',
    description: 'Use saved prompts and selected user skills as deterministic Chat context.',
    prompt: 'Use my saved release-note prompt or matching skill to review this change list.',
    requiredCapabilities: ['chat_response', 'saved_prompt_context', 'user_skill_context'],
    requiredToolNames: [],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Use previously saved user, long-term, daily, or session memory context.',
    prompt: 'Use my project preferences from memory and explain the next step.',
    requiredCapabilities: ['chat_response', 'memory_context'],
    requiredToolNames: ['memory-tools_*'],
  },
  {
    id: 'project_budget_metadata',
    name: 'Project and budget metadata',
    description: 'Use selected Chat project, usage project, and budget metadata.',
    prompt: 'Use the selected project budget and task metadata to say what work is in scope.',
    requiredCapabilities: ['chat_response', 'usage_project_metadata'],
    requiredToolNames: [],
  },
  {
    id: 'local_model_chat_only',
    name: 'Local model chat-only',
    description: 'Keep a local model on direct chat with no runtime tool requirement.',
    prompt: 'Answer with no tools using a local model profile.',
    requiredCapabilities: ['chat_response'],
    requiredToolNames: [],
  },
  {
    id: 'browser_dev_browser',
    name: 'Browser and dev-browser',
    description: 'Use the browser automation surface for page inspection and screenshots.',
    prompt: 'Open a page in the dev browser and report visible console errors.',
    requiredCapabilities: ['chat_response', 'browser_automation'],
    requiredToolNames: ['dev-browser_*'],
  },
];

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function uniqueToolsetIds(values: readonly ToolsetId[]): ToolsetId[] {
  return uniqueStrings(values) as ToolsetId[];
}

function selectToolsetIds(value: ToolsetId[] | undefined, fallback: readonly ToolsetId[]): ToolsetId[] {
  return value === undefined ? [...fallback] : [...value];
}

function capabilityNamesFor(resolution: ToolsetResolution): string[] {
  return resolution.tools.map((tool) => tool.name);
}

function toolNamesFor(resolution: ToolsetResolution): string[] {
  const names: string[] = [];
  for (const toolset of resolution.toolsets) {
    names.push(...(toolset.defaultToolNames ?? []));
  }
  for (const capability of resolution.tools) {
    names.push(...(capability.toolNames ?? []));
  }
  return uniqueStrings(names);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardMatches(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern.toLowerCase() === value.toLowerCase();
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
  return regex.test(value);
}

function isToolCovered(requiredToolName: string, availableToolNames: readonly string[]): boolean {
  return availableToolNames.some((availableToolName) => (
    wildcardMatches(requiredToolName, availableToolName)
    || wildcardMatches(availableToolName, requiredToolName)
  ));
}

function coverageFor(missingCount: number, requiredCount: number): ChatDeferredCompatibilityAvailability['coverage'] {
  if (missingCount === 0) return 'full';
  if (missingCount >= requiredCount) return 'none';
  return 'partial';
}

function availabilityFor(
  resolution: ToolsetResolution,
  requiredCapabilities: readonly string[],
  requiredToolNames: readonly string[]
): ChatDeferredCompatibilityAvailability {
  const capabilityNames = capabilityNamesFor(resolution);
  const capabilitySet = new Set(capabilityNames);
  const toolNames = toolNamesFor(resolution);
  const availableCapabilities = requiredCapabilities.filter((capability) => capabilitySet.has(capability));
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilitySet.has(capability));
  const availableTools = requiredToolNames.filter((toolName) => isToolCovered(toolName, toolNames));
  const missingTools = requiredToolNames.filter((toolName) => !isToolCovered(toolName, toolNames));
  const requiredCount = requiredCapabilities.length + requiredToolNames.length;
  const missingCount = missingCapabilities.length + missingTools.length;

  return {
    toolsetIds: [...resolution.resolvedIds],
    capabilityNames,
    toolNames,
    coverage: coverageFor(missingCount, requiredCount),
    availableCapabilities,
    missingCapabilities,
    availableTools,
    missingTools,
  };
}

function buildDeferredAvailability(
  initial: ChatDeferredCompatibilityAvailability,
  expanded: ChatDeferredCompatibilityAvailability
): ChatDeferredCompatibilityDeferredAvailability {
  const phase = initial.coverage === 'full'
    ? 'initial'
    : expanded.coverage === 'full'
      ? 'deferred'
      : 'unavailable';

  return {
    ...expanded,
    phase,
    initial,
    expanded,
  };
}

function estimatePromptTokens(resolution: ToolsetResolution, prompt: string): number {
  return estimateTokens({
    provider: 'openai',
    systemText: resolution.promptSummary,
    newMessageText: prompt,
  }).promptTokensEst;
}

function buildTokenEstimate(params: {
  baselineResolution: ToolsetResolution;
  minimalResolution: ToolsetResolution;
  expandedDeferredResolution: ToolsetResolution;
  prompt: string;
}): ChatDeferredCompatibilityTokenEstimate {
  const baselinePromptTokensEst = estimatePromptTokens(params.baselineResolution, params.prompt);
  const deferredInitialPromptTokensEst = estimatePromptTokens(params.minimalResolution, params.prompt);
  const deferredExpandedPromptTokensEst = estimatePromptTokens(params.expandedDeferredResolution, params.prompt);
  const estimatedInitialSavingsTokens = Math.max(0, baselinePromptTokensEst - deferredInitialPromptTokensEst);
  const estimatedInitialSavingsPct = baselinePromptTokensEst > 0
    ? Math.round((estimatedInitialSavingsTokens / baselinePromptTokensEst) * 1000) / 10
    : 0;

  return {
    baselinePromptTokensEst,
    deferredInitialPromptTokensEst,
    deferredExpandedPromptTokensEst,
    estimatedInitialSavingsTokens,
    estimatedInitialSavingsPct,
    method: 'heuristic_chars_per_token',
  };
}

function missingLabel(availability: ChatDeferredCompatibilityAvailability): string {
  return [
    ...availability.missingCapabilities.map((capability) => `capability:${capability}`),
    ...availability.missingTools.map((tool) => `tool:${tool}`),
  ].join(', ');
}

function recommendationsForCase(params: {
  regressionCase: ChatDeferredRegressionCase;
  baselineAvailability: ChatDeferredCompatibilityAvailability;
  deferredAvailability: ChatDeferredCompatibilityDeferredAvailability;
}): string[] {
  const recommendations: string[] = [];
  const { regressionCase, baselineAvailability, deferredAvailability } = params;

  if (baselineAvailability.coverage !== 'full') {
    recommendations.push(
      `Baseline full Chat is missing ${missingLabel(baselineAvailability)} for ${regressionCase.name}.`
    );
  }

  if (deferredAvailability.expanded.coverage !== 'full') {
    recommendations.push(
      `Add ${missingLabel(deferredAvailability.expanded)} to the minimal or on-demand Chat toolsets before enabling ${regressionCase.name}.`
    );
  } else if (deferredAvailability.phase === 'deferred') {
    recommendations.push(
      `Allow on-demand activation for ${regressionCase.name}; the initial minimal toolset does not need to expose these tools.`
    );
  } else {
    recommendations.push(`${regressionCase.name} is covered by the initial minimal Chat toolset.`);
  }

  return recommendations;
}

function buildCaseResult(params: {
  regressionCase: ChatDeferredRegressionCase;
  baselineResolution: ToolsetResolution;
  minimalResolution: ToolsetResolution;
  expandedDeferredResolution: ToolsetResolution;
}): ChatDeferredCompatibilityCaseResult {
  const { regressionCase, baselineResolution, minimalResolution, expandedDeferredResolution } = params;
  const baselineAvailability = availabilityFor(
    baselineResolution,
    regressionCase.requiredCapabilities,
    regressionCase.requiredToolNames
  );
  const initialAvailability = availabilityFor(
    minimalResolution,
    regressionCase.requiredCapabilities,
    regressionCase.requiredToolNames
  );
  const expandedAvailability = availabilityFor(
    expandedDeferredResolution,
    regressionCase.requiredCapabilities,
    regressionCase.requiredToolNames
  );
  const deferredAvailability = buildDeferredAvailability(initialAvailability, expandedAvailability);
  const passed = baselineAvailability.coverage === 'full' && deferredAvailability.coverage === 'full';

  return {
    id: regressionCase.id,
    name: regressionCase.name,
    description: regressionCase.description,
    prompt: regressionCase.prompt,
    requiredCapabilities: [...regressionCase.requiredCapabilities],
    requiredToolNames: [...regressionCase.requiredToolNames],
    baselineAvailability,
    deferredAvailability,
    passed,
    tokenEstimate: buildTokenEstimate({
      baselineResolution,
      minimalResolution,
      expandedDeferredResolution,
      prompt: regressionCase.prompt,
    }),
    recommendations: recommendationsForCase({
      regressionCase,
      baselineAvailability,
      deferredAvailability,
    }),
  };
}

function collectRequired(cases: readonly ChatDeferredCompatibilityCaseResult[], field: 'requiredCapabilities' | 'requiredToolNames'): string[] {
  return uniqueStrings(cases.flatMap((regressionCase) => regressionCase[field]));
}

function collectRecommendations(cases: readonly ChatDeferredCompatibilityCaseResult[], passed: boolean): string[] {
  const recommendations = uniqueStrings(cases.flatMap((regressionCase) => regressionCase.recommendations));
  if (passed) {
    return [
      'The proposed on-demand Chat toolsets cover every v1 regression case.',
      'Keep the minimal Chat toolset small and load on-demand toolsets only after intent requires them.',
      ...recommendations,
    ];
  }
  return [
    'Do not enable on-demand Chat tools for this profile until the failing cases are covered.',
    ...recommendations,
  ];
}

export function listChatDeferredCompatibilityRegressionPack(): ChatDeferredRegressionCase[] {
  return CHAT_DEFERRED_REGRESSION_PACK.map((regressionCase) => ({
    ...regressionCase,
    requiredCapabilities: [...regressionCase.requiredCapabilities],
    requiredToolNames: [...regressionCase.requiredToolNames],
  }));
}

export function proveChatDeferredToolCompatibility(
  request: ChatDeferredCompatibilityRequest = {}
): ChatDeferredCompatibilityProofResult {
  const baselineToolsetIds = selectToolsetIds(
    request.baselineToolsetIds,
    DEFAULT_CHAT_DEFERRED_BASELINE_TOOLSET_IDS
  );
  const minimalToolsetIds = selectToolsetIds(
    request.minimalToolsetIds,
    DEFAULT_CHAT_DEFERRED_MINIMAL_TOOLSET_IDS
  );
  const deferredToolsetIds = selectToolsetIds(
    request.deferredToolsetIds,
    DEFAULT_CHAT_DEFERRED_DEFERRED_TOOLSET_IDS
  );

  const baselineResolution = resolveToolsets(baselineToolsetIds);
  const minimalResolution = resolveToolsets(minimalToolsetIds);
  const deferredResolution = resolveToolsets(deferredToolsetIds);
  const expandedDeferredResolution = resolveToolsets(uniqueToolsetIds([
    ...minimalResolution.resolvedIds,
    ...deferredResolution.resolvedIds,
  ]));

  const cases = CHAT_DEFERRED_REGRESSION_PACK.map((regressionCase) => buildCaseResult({
    regressionCase,
    baselineResolution,
    minimalResolution,
    expandedDeferredResolution,
  }));
  const passedCases = cases.filter((regressionCase) => regressionCase.passed).length;
  const passed = passedCases === cases.length;
  const packPrompt = CHAT_DEFERRED_REGRESSION_PACK.map((regressionCase) => regressionCase.prompt).join('\n');
  const requiredCapabilities = collectRequired(cases, 'requiredCapabilities');
  const requiredToolNames = collectRequired(cases, 'requiredToolNames');

  return {
    packVersion: CHAT_DEFERRED_COMPATIBILITY_PACK_VERSION,
    summary: {
      packVersion: CHAT_DEFERRED_COMPATIBILITY_PACK_VERSION,
      totalCases: cases.length,
      passedCases,
      failedCases: cases.length - passedCases,
      baselineToolsetIds: [...baselineResolution.resolvedIds],
      minimalToolsetIds: [...minimalResolution.resolvedIds],
      deferredToolsetIds: [...deferredResolution.resolvedIds],
      requiredCapabilities,
      requiredToolNames,
      baselineCapabilityNames: capabilityNamesFor(baselineResolution),
      deferredCapabilityNames: capabilityNamesFor(expandedDeferredResolution),
      baselineToolNames: toolNamesFor(baselineResolution),
      deferredToolNames: toolNamesFor(expandedDeferredResolution),
      tokenEstimate: buildTokenEstimate({
        baselineResolution,
        minimalResolution,
        expandedDeferredResolution,
        prompt: packPrompt,
      }),
    },
    cases,
    passed,
    unknownToolsetIds: {
      baseline: [...baselineResolution.unknownIds],
      minimal: [...minimalResolution.unknownIds],
      deferred: [...deferredResolution.unknownIds],
    },
    recommendations: collectRecommendations(cases, passed),
  };
}
