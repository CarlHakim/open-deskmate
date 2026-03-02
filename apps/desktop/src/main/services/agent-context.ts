import type { AgentProfile, SelectedModel } from '@accomplish/shared';
import { getWorkspaceRoot, getActiveAgentId, setActiveAgentId, getSelectedModel } from '../store/appSettings';
import { getAgent, getDefaultAgentId, listAgents, normalizeAgentIdForStore } from '../store/agents';

export interface AgentContext {
  agentId: string;
  agent: AgentProfile;
  workspaceRoot?: string;
  systemPromptAppend?: string;
  selectedModel?: SelectedModel;
}

function normalizePromptLine(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, 160);
  return normalized || fallback;
}

export function buildAgentIdentityPromptAppend(agent: Pick<AgentProfile, 'id' | 'name' | 'roleName'>): string {
  const agentId = normalizePromptLine(agent.id, 'main');
  const agentName = normalizePromptLine(agent.name, agentId);
  const roleName = normalizePromptLine(agent.roleName, '');
  const lines = [
    'Agent identity (runtime):',
    `- Agent ID: ${agentId}`,
    `- Agent name: ${agentName}`,
  ];
  if (roleName) {
    lines.push(`- Agent role: ${roleName}`);
  }
  lines.push('- This identity is authoritative for this run.');
  lines.push('- If asked your name, answer with the Agent name above.');
  lines.push('- Do not claim your name is "Accomplish" unless the Agent name above is exactly "Accomplish".');
  return lines.join('\n');
}

export function composeAgentSystemPromptAppend(params: {
  agent: Pick<AgentProfile, 'id' | 'name' | 'roleName'>;
  agentSystemPromptAppend?: string;
  requestSystemPromptAppend?: string;
}): string {
  const candidateParts = [
    buildAgentIdentityPromptAppend(params.agent),
    (params.agentSystemPromptAppend ?? '').trim(),
    (params.requestSystemPromptAppend ?? '').trim(),
  ].filter((part): part is string => Boolean(part));
  const unique: string[] = [];
  for (const part of candidateParts) {
    if (!unique.includes(part)) {
      unique.push(part);
    }
  }
  return unique.join('\n\n');
}

function resolveValidAgentId(requested?: string): string {
  const agents = listAgents();
  const normalizedRequested = requested ? normalizeAgentIdForStore(requested) : '';
  if (normalizedRequested && agents.some((agent) => agent.id === normalizedRequested)) {
    return normalizedRequested;
  }

  const active = normalizeAgentIdForStore(getActiveAgentId());
  if (agents.some((agent) => agent.id === active)) {
    return active;
  }

  const fallback = normalizeAgentIdForStore(getDefaultAgentId());
  if (agents.some((agent) => agent.id === fallback)) {
    setActiveAgentId(fallback);
    return fallback;
  }

  const first = agents[0]?.id || 'main';
  setActiveAgentId(first);
  return first;
}

export function getAgentContext(requestedAgentId?: string): AgentContext {
  const agentId = resolveValidAgentId(requestedAgentId);
  const agent = getAgent(agentId) || listAgents()[0];
  const workspaceRoot = agent?.workspaceRoot || getWorkspaceRoot() || undefined;
  const systemPromptAppend = agent?.systemPromptAppend;
  const selectedModel = agent?.selectedModel;

  return {
    agentId,
    agent: agent ?? {
      id: agentId,
      name: agentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    workspaceRoot,
    systemPromptAppend,
    selectedModel,
  };
}

export function resolveActiveAgentId(): string {
  return getAgentContext().agentId;
}

export function resolveSelectedModelForAgent(agentId?: string): SelectedModel | null {
  const agentModel = getAgentContext(agentId).selectedModel;
  return agentModel ?? getSelectedModel();
}
