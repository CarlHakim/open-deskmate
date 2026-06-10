import Store from 'electron-store';
import type { Folder, FolderConfig, FolderUpdateConfig } from '@accomplish/shared';

/**
 * Schema for folder storage
 */
interface FolderStoreSchema {
  folders: Folder[];
  taskFolderAssignments: Record<string, string>; // taskId -> folderId
}

const folderStore = new Store<FolderStoreSchema>({
  name: 'folders',
  defaults: {
    folders: [],
    taskFolderAssignments: {},
  },
});

/**
 * Generate a unique folder ID
 */
function generateFolderId(): string {
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAssigneeIds(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = String(item ?? '').trim().slice(0, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 80) break;
  }
  return ids;
}

/**
 * Migrate folders without agentId to the default 'main' agent
 */
function migrateFolderAgentIds(): void {
  const folders = folderStore.get('folders') ?? [];
  let changed = false;
  const updated = folders.map((f) => {
    if (!f.agentId) {
      changed = true;
      return { ...f, agentId: 'main' };
    }
    return f;
  });
  if (changed) {
    folderStore.set('folders', updated);
  }
}
migrateFolderAgentIds();

/**
 * Get all folders
 */
export function getFolders(): Folder[] {
  return folderStore.get('folders') ?? [];
}

/**
 * Get folders for a specific agent
 */
export function getFoldersForAgent(agentId: string): Folder[] {
  return getFolders().filter((f) => f.agentId === agentId);
}

/**
 * Get a specific folder by ID
 */
export function getFolder(folderId: string): Folder | undefined {
  const folders = getFolders();
  return folders.find((f) => f.id === folderId);
}

/**
 * Create a new folder
 */
export function createFolder(config: FolderConfig, agentId?: string): Folder {
  const folders = getFolders();
  const now = new Date().toISOString();

  const newFolder: Folder = {
    id: generateFolderId(),
    name: config.name,
    icon: config.icon,
    color: config.color,
    usageProjectId: config.usageProjectId ?? null,
    assigneeIds: normalizeAssigneeIds(config.assigneeIds) ?? null,
    agentId,
    isExpanded: true,
    order: folders.length,
    createdAt: now,
    updatedAt: now,
  };

  folderStore.set('folders', [...folders, newFolder]);
  return newFolder;
}

/**
 * Update an existing folder
 */
export function updateFolder(folderId: string, config: FolderUpdateConfig): Folder | undefined {
  const folders = getFolders();
  const now = new Date().toISOString();

  const index = folders.findIndex((f) => f.id === folderId);
  if (index === -1) return undefined;

  const nextAssigneeIds = Object.prototype.hasOwnProperty.call(config, 'assigneeIds')
    ? (normalizeAssigneeIds(config.assigneeIds) ?? null)
    : (folders[index].assigneeIds ?? null);

  const updatedFolder = {
    ...folders[index],
    ...config,
    assigneeIds: nextAssigneeIds,
    updatedAt: now,
  };

  folders[index] = updatedFolder;
  folderStore.set('folders', folders);
  return updatedFolder;
}

/**
 * Delete a folder
 */
export function deleteFolder(folderId: string): void {
  const folders = getFolders();
  const filteredFolders = folders.filter((f) => f.id !== folderId);

  // Re-order remaining folders
  const reorderedFolders = filteredFolders.map((folder, index) => ({
    ...folder,
    order: index,
  }));

  folderStore.set('folders', reorderedFolders);

  // Remove task assignments for this folder
  const assignments = getTaskFolderAssignments();
  const updatedAssignments: Record<string, string> = {};
  for (const [taskId, assignedFolderId] of Object.entries(assignments)) {
    if (assignedFolderId !== folderId) {
      updatedAssignments[taskId] = assignedFolderId;
    }
  }
  folderStore.set('taskFolderAssignments', updatedAssignments);
}

/**
 * Toggle folder expanded state
 */
export function toggleFolderExpanded(folderId: string): Folder | undefined {
  const folder = getFolder(folderId);
  if (!folder) return undefined;
  return updateFolder(folderId, { isExpanded: !folder.isExpanded });
}

/**
 * Reorder folders
 */
export function reorderFolders(folderIds: string[]): Folder[] {
  const folders = getFolders();
  const now = new Date().toISOString();

  const folderMap = new Map(folders.map((f) => [f.id, f]));

  const reorderedFolders = folderIds
    .map((id, index) => {
      const folder = folderMap.get(id);
      return folder ? { ...folder, order: index, updatedAt: now } : null;
    })
    .filter((f): f is Folder => f !== null);

  // Add any folders not in the list at the end
  const remainingFolders = folders
    .filter((f) => !folderIds.includes(f.id))
    .map((f, index) => ({
      ...f,
      order: reorderedFolders.length + index,
      updatedAt: now,
    }));

  const allFolders = [...reorderedFolders, ...remainingFolders];
  folderStore.set('folders', allFolders);
  return allFolders;
}

/**
 * Get all task-folder assignments
 */
export function getTaskFolderAssignments(): Record<string, string> {
  return folderStore.get('taskFolderAssignments') ?? {};
}

/**
 * Get the folder ID for a specific task
 */
export function getTaskFolder(taskId: string): string | null {
  const assignments = getTaskFolderAssignments();
  return assignments[taskId] || null;
}

/**
 * Set a task's folder assignment
 */
export function setTaskFolder(taskId: string, folderId: string | null): void {
  const assignments = getTaskFolderAssignments();

  if (folderId) {
    assignments[taskId] = folderId;
  } else {
    delete assignments[taskId];
  }

  folderStore.set('taskFolderAssignments', assignments);
}

/**
 * Clear all folder data (reset store to defaults)
 */
export function clearFolderStore(): void {
  folderStore.clear();
}
