import { create } from 'zustand';
import type {
  UsageAssignee,
  UsageAssigneeInput,
  UsageAssigneeUpdate,
  UsageProject,
  UsageProjectBudgetStatus,
  UsageProjectBudgetWindow,
  UsageProjectBudgetWindowInput,
  UsageProjectBudgetWindowUpdate,
  UsageProjectInput,
  UsageProjectUpdate,
} from '@accomplish/shared';
import { getAccomplish } from '@/lib/accomplish';

const CHAT_SELECTION_KEY = 'open-deskmate-usage-project-chat';
const BUILD_SELECTION_KEY = 'open-deskmate-usage-project-build';

type UsageProjectMode = 'chat' | 'build';

interface UsageProjectState {
  projects: UsageProject[];
  archivedProjects: UsageProject[];
  assignees: UsageAssignee[];
  archivedAssignees: UsageAssignee[];
  windows: UsageProjectBudgetWindow[];
  statuses: UsageProjectBudgetStatus[];
  loading: boolean;
  error: string | null;
  selectedChatProjectId: string | null;
  selectedBuildProjectId: string | null;
  loadProjects: (includeArchived?: boolean) => Promise<void>;
  refreshStatuses: (projectId?: string) => Promise<void>;
  setSelectedProject: (mode: UsageProjectMode, projectId: string | null) => void;
  createProject: (input: UsageProjectInput) => Promise<UsageProject | null>;
  updateProject: (projectId: string, update: UsageProjectUpdate) => Promise<UsageProject | null>;
  archiveProject: (projectId: string, archived?: boolean) => Promise<void>;
  createAssignee: (input: UsageAssigneeInput) => Promise<UsageAssignee | null>;
  updateAssignee: (assigneeId: string, update: UsageAssigneeUpdate) => Promise<UsageAssignee | null>;
  archiveAssignee: (assigneeId: string, archived?: boolean) => Promise<void>;
  createWindow: (input: UsageProjectBudgetWindowInput) => Promise<UsageProjectBudgetWindow | null>;
  updateWindow: (windowId: string, update: UsageProjectBudgetWindowUpdate) => Promise<UsageProjectBudgetWindow | null>;
  deleteWindow: (windowId: string) => Promise<void>;
}

function readSelection(key: string): string | null {
  try {
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeSelection(key: string, value: string | null): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage failures
  }
}

export const useUsageProjectStore = create<UsageProjectState>((set, get) => ({
  projects: [],
  archivedProjects: [],
  assignees: [],
  archivedAssignees: [],
  windows: [],
  statuses: [],
  loading: false,
  error: null,
  selectedChatProjectId: readSelection(CHAT_SELECTION_KEY),
  selectedBuildProjectId: readSelection(BUILD_SELECTION_KEY),

  loadProjects: async (includeArchived = true) => {
    set({ loading: true, error: null });
    try {
      const api = getAccomplish();
      const [projects, windows, statuses, assignees] = await Promise.all([
        api.listUsageProjects({ includeArchived }),
        api.listUsageProjectBudgetWindows(),
        api.getUsageProjectBudgetStatus(),
        api.listUsageAssignees({ includeArchived }),
      ]);
      const active = projects.filter((project) => project.status === 'active');
      set({
        projects: active,
        archivedProjects: projects.filter((project) => project.status === 'archived'),
        assignees: assignees.filter((assignee) => assignee.status === 'active'),
        archivedAssignees: assignees.filter((assignee) => assignee.status === 'archived'),
        windows,
        statuses,
        loading: false,
      });
      const selectedChatProjectId = get().selectedChatProjectId;
      const selectedBuildProjectId = get().selectedBuildProjectId;
      if (selectedChatProjectId && !active.some((project) => project.id === selectedChatProjectId)) {
        get().setSelectedProject('chat', null);
      }
      if (selectedBuildProjectId && !active.some((project) => project.id === selectedBuildProjectId)) {
        get().setSelectedProject('build', null);
      }
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  refreshStatuses: async (projectId?: string) => {
    try {
      const statuses = await getAccomplish().getUsageProjectBudgetStatus(projectId ? { projectId } : undefined);
      set({ statuses });
    } catch {
      // Status refresh should not block task entry.
    }
  },

  setSelectedProject: (mode, projectId) => {
    const key = mode === 'chat' ? CHAT_SELECTION_KEY : BUILD_SELECTION_KEY;
    writeSelection(key, projectId);
    set(mode === 'chat'
      ? { selectedChatProjectId: projectId }
      : { selectedBuildProjectId: projectId });
  },

  createProject: async (input) => {
    try {
      const project = await getAccomplish().createUsageProject(input);
      await get().loadProjects(true);
      return project;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  updateProject: async (projectId, update) => {
    try {
      const project = await getAccomplish().updateUsageProject(projectId, update);
      await get().loadProjects(true);
      return project;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  archiveProject: async (projectId, archived = true) => {
    try {
      await getAccomplish().archiveUsageProject(projectId, archived);
      await get().loadProjects(true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  createAssignee: async (input) => {
    try {
      const assignee = await getAccomplish().createUsageAssignee(input);
      await get().loadProjects(true);
      return assignee;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  updateAssignee: async (assigneeId, update) => {
    try {
      const assignee = await getAccomplish().updateUsageAssignee(assigneeId, update);
      await get().loadProjects(true);
      return assignee;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  archiveAssignee: async (assigneeId, archived = true) => {
    try {
      await getAccomplish().archiveUsageAssignee(assigneeId, archived);
      await get().loadProjects(true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  createWindow: async (input) => {
    try {
      const window = await getAccomplish().createUsageProjectBudgetWindow(input);
      await get().loadProjects(true);
      return window;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  updateWindow: async (windowId, update) => {
    try {
      const window = await getAccomplish().updateUsageProjectBudgetWindow(windowId, update);
      await get().loadProjects(true);
      return window;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  deleteWindow: async (windowId) => {
    try {
      await getAccomplish().deleteUsageProjectBudgetWindow(windowId);
      await get().loadProjects(true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
