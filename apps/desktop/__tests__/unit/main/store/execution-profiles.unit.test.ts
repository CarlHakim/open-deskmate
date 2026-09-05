import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private data: Record<string, unknown>;

    constructor(options?: { defaults?: T }) {
      this.data = { ...(options?.defaults || {}) };
    }

    get(key: string) {
      return this.data[key];
    }

    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  }

  return { default: MockStore };
});

import {
  archiveExecutionProfile,
  assertExecutionProfileRunnable,
  checkExecutionProfileHealth,
  clearExecutionProfiles,
  createExecutionProfile,
  listExecutionProfiles,
  updateExecutionProfile,
} from '../../../../src/main/store/executionProfiles';

describe('execution profiles store', () => {
  beforeEach(() => {
    clearExecutionProfiles();
  });

  it('hydrates a default local Windows profile', () => {
    const result = listExecutionProfiles();

    expect(result.defaultProfileId).toBe('local-windows');
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toMatchObject({
      id: 'local-windows',
      name: 'Local Windows',
      kind: 'local_windows',
      isDefault: true,
      archived: false,
      settings: {
        kind: 'local_windows',
        shell: 'powershell',
        workspaceRoot: null,
      },
      health: {
        status: 'ready',
      },
    });
  });

  it('creates and normalizes an SSH profile without storing secrets', () => {
    const profile = createExecutionProfile({
      name: '  Staging SSH  ',
      kind: 'ssh',
      settings: {
        kind: 'ssh',
        host: 'staging.example.com',
        port: 2222,
        username: 'deploy',
      },
    });

    expect(profile.id).toBe('staging-ssh');
    expect(profile.name).toBe('Staging SSH');
    expect(profile.settings).toMatchObject({
      kind: 'ssh',
      host: 'staging.example.com',
      port: 2222,
      username: 'deploy',
    });
    expect(profile.health.status).toBe('not_checked');
    expect(profile.health.blocking).toBe(true);
  });

  it('rejects secret-like fields in profile settings', () => {
    expect(() => createExecutionProfile({
      name: 'Secret SSH',
      kind: 'ssh',
      settings: {
        kind: 'ssh',
        host: 'example.com',
        password: 'do-not-store',
      } as any,
    })).toThrow(/cannot store secrets/i);

    expect(() => createExecutionProfile({
      name: 'Secret Ref',
      kind: 'ssh',
      settings: {
        kind: 'ssh',
        host: 'example.com',
        authReference: 'password=abc',
      } as any,
    })).toThrow(/auth references cannot contain secret/i);
  });

  it('validates required remote profile fields', () => {
    expect(() => createExecutionProfile({
      name: 'Missing Host',
      kind: 'ssh',
      settings: {
        kind: 'ssh',
        port: 22,
      } as any,
    })).toThrow(/SSH host is required/i);

    expect(() => createExecutionProfile({
      name: 'Bad Cloud',
      kind: 'cloud_worker',
      settings: {
        kind: 'cloud_worker',
        workerUrl: 'file:///tmp/worker',
      },
    })).toThrow(/http or https/i);
  });

  it('updates and archives non-default profiles', () => {
    const created = createExecutionProfile({
      name: 'Build Container',
      kind: 'docker',
      settings: {
        kind: 'docker',
        image: 'node:20',
      },
    });

    const updated = updateExecutionProfile(created.id, {
      name: 'Build Container 20',
      settings: {
        kind: 'docker',
        image: 'node:20-bookworm',
        workingDir: '/workspace',
      },
    });
    expect(updated.name).toBe('Build Container 20');
    expect(updated.settings).toMatchObject({
      kind: 'docker',
      image: 'node:20-bookworm',
      workingDir: '/workspace',
    });

    archiveExecutionProfile(created.id, true);
    expect(listExecutionProfiles().profiles.map((profile) => profile.id)).toEqual(['local-windows']);
    expect(listExecutionProfiles({ includeArchived: true }).profiles.find((profile) => profile.id === created.id)?.archived).toBe(true);
  });

  it('does not archive or retarget the default local Windows profile', () => {
    expect(() => archiveExecutionProfile('local-windows', true)).toThrow(/cannot be archived/i);
    expect(() => updateExecutionProfile('local-windows', {
      kind: 'ssh',
      settings: {
        kind: 'ssh',
        host: 'example.com',
      },
    })).toThrow(/kind cannot be changed/i);
  });

  it('allows only ready local Windows profiles to run by default', () => {
    const local = assertExecutionProfileRunnable('local-windows');
    expect(local.kind).toBe('local_windows');
    expect(local.health.status).toBe('ready');

    const remote = createExecutionProfile({
      name: 'Remote SSH',
      kind: 'ssh',
      settings: {
        kind: 'ssh',
        host: 'remote.example.com',
        authReference: 'windows-credential:ssh-remote',
      },
    });

    expect(() => assertExecutionProfileRunnable(remote.id)).toThrow(/not ready/i);
    const checked = checkExecutionProfileHealth(remote.id);
    expect(checked.health.status).toBe('error');
    expect(checked.health.blocking).toBe(true);
    expect(checked.health.details?.join(' ')).toContain('remote.example.com');
  });
});
