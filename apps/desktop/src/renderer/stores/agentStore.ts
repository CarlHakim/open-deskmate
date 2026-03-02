import { create } from 'zustand';
import type { AgentConfig, AgentProfile } from '@accomplish/shared';
import { getAccomplish } from '../lib/accomplish';

interface AgentState {
  agents: AgentProfile[];
  activeAgentId: string;
  defaultAgentId: string;
  isLoading: boolean;
  error: string | null;
  loadAgents: () => Promise<void>;
  setActiveAgent: (agentId: string) => Promise<string>;
  setDefaultAgent: (agentId: string) => Promise<string>;
  upsertAgent: (config: AgentConfig) => Promise<AgentProfile>;
  deleteAgent: (agentId: string) => Promise<void>;
  getActiveAgent: () => AgentProfile | undefined;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  activeAgentId: 'main',
  defaultAgentId: 'main',
  isLoading: false,
  error: null,

  loadAgents: async () => {
    const accomplish = getAccomplish();
    set({ isLoading: true, error: null });
    try {
      const result = await accomplish.listAgents();
      set({
        agents: result.agents ?? [],
        activeAgentId: result.activeAgentId ?? 'main',
        defaultAgentId: result.defaultAgentId ?? 'main',
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load agents',
        isLoading: false,
      });
    }
  },

  setActiveAgent: async (agentId: string) => {
    const accomplish = getAccomplish();
    const updatedId = await accomplish.setActiveAgent(agentId);
    set({ activeAgentId: updatedId });
    return updatedId;
  },

  setDefaultAgent: async (agentId: string) => {
    const accomplish = getAccomplish();
    const updatedId = await accomplish.setDefaultAgent(agentId);
    set({ defaultAgentId: updatedId });
    return updatedId;
  },

  upsertAgent: async (config: AgentConfig) => {
    const accomplish = getAccomplish();
    const agent = await accomplish.upsertAgent(config);
    await get().loadAgents();
    return agent;
  },

  deleteAgent: async (agentId: string) => {
    const accomplish = getAccomplish();
    await accomplish.deleteAgent(agentId);
    await get().loadAgents();
  },

  getActiveAgent: () => {
    const { agents, activeAgentId } = get();
    return agents.find((agent) => agent.id === activeAgentId);
  },
}));
