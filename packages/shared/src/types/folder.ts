/**
 * Folder/Project types for organizing tasks
 */

export interface Folder {
  id: string;
  name: string;
  /** Optional icon/emoji for the folder */
  icon?: string;
  /** Color for the folder (hex or named) */
  color?: string;
  /** Whether the folder is expanded in the UI */
  isExpanded: boolean;
  /** Order position for sorting */
  order: number;
  /** Creation timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

export interface FolderConfig {
  name: string;
  icon?: string;
  color?: string;
}

export interface FolderUpdateConfig {
  name?: string;
  icon?: string;
  color?: string;
  isExpanded?: boolean;
  order?: number;
}
