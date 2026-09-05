export type ExecutionProfileKind = 'local_windows' | 'ssh' | 'docker' | 'cloud_worker';

export type LocalWindowsShell = 'powershell' | 'cmd';

export interface LocalWindowsExecutionProfileSettings {
  kind: 'local_windows';
  shell: LocalWindowsShell;
  workspaceRoot?: string | null;
}

export interface SshExecutionProfileSettings {
  kind: 'ssh';
  host: string;
  port: number;
  username?: string;
  workspaceRoot?: string | null;
  authReference?: string | null;
}

export interface DockerExecutionProfileSettings {
  kind: 'docker';
  image: string;
  dockerContext?: string;
  containerName?: string;
  workspaceRoot?: string | null;
  workingDir?: string;
}

export interface CloudWorkerExecutionProfileSettings {
  kind: 'cloud_worker';
  providerLabel?: string;
  workerUrl: string;
  region?: string;
  workspaceRoot?: string | null;
  authReference?: string | null;
}

export type ExecutionProfileSettings =
  | LocalWindowsExecutionProfileSettings
  | SshExecutionProfileSettings
  | DockerExecutionProfileSettings
  | CloudWorkerExecutionProfileSettings;

export type ExecutionProfileSettingsInput =
  | Partial<LocalWindowsExecutionProfileSettings>
  | Partial<SshExecutionProfileSettings>
  | Partial<DockerExecutionProfileSettings>
  | Partial<CloudWorkerExecutionProfileSettings>;

export type ExecutionProfileHealthStatus = 'ready' | 'not_checked' | 'warning' | 'error';

export interface ExecutionProfileHealth {
  status: ExecutionProfileHealthStatus;
  message: string;
  checkedAt?: string;
  blocking?: boolean;
  details?: string[];
}

export interface ExecutionProfile {
  id: string;
  name: string;
  kind: ExecutionProfileKind;
  settings: ExecutionProfileSettings;
  isDefault: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  health: ExecutionProfileHealth;
}

export type ExecutionProfileCreateInput = {
  id?: string;
  name: string;
  kind: ExecutionProfileKind;
  settings?: ExecutionProfileSettingsInput;
  isDefault?: boolean;
};

export type ExecutionProfileUpdateInput = {
  name?: string;
  kind?: ExecutionProfileKind;
  settings?: ExecutionProfileSettingsInput;
  isDefault?: boolean;
};

export interface ExecutionProfileListResult {
  profiles: ExecutionProfile[];
  defaultProfileId: string;
}
