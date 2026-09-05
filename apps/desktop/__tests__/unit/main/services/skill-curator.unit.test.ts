import { describe, expect, it } from 'vitest';
import { __curatorTest } from '@main/services/skill-curator';

function skillSnapshot(overrides: Record<string, unknown> = {}) {
  const body = String(overrides.body || '# Demo Skill\n\n## Workflow\n\n1. Do the reusable thing.');
  const entry = {
    id: 'demo-skill',
    name: 'Demo Skill',
    description: 'Reusable demo workflow',
    source: 'managed',
    baseDir: 'C:/tmp/demo-skill',
    filePath: 'C:/tmp/demo-skill/SKILL.md',
    editable: true,
    metadata: {
      opendeskmate: {
        generatedBy: 'hermes-task-automation',
        skillKey: 'demo-skill',
      },
    },
    manifest: {
      schemaVersion: 1,
      skillId: 'demo-skill',
      name: 'Demo Skill',
      description: 'Reusable demo workflow',
      version: '1.0.0',
      state: 'active',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      checksum: 'abc',
      versions: [],
      performance: {
        samples: 0,
        successCount: 0,
        failureCount: 0,
      },
    },
    ...overrides,
  };
  delete (entry as Record<string, unknown>).body;
  return {
    entry,
    raw: [
      '---',
      'name: demo-skill',
      'description: "Reusable demo workflow"',
      '---',
      '',
      body,
      '',
    ].join('\n'),
    body,
    checksum: (entry as any).manifest?.checksum || 'abc',
    titleSignature: __curatorTest.normalizeSignature(`${(entry as any).name} ${(entry as any).description}`),
  } as any;
}

describe('skill curator helpers', () => {
  it('flags clearly stale generated managed skills', () => {
    const findings = __curatorTest.analyzeSkillForCurator(
      skillSnapshot(),
      Date.parse('2026-01-01T00:00:00.000Z')
    );

    expect(findings.some((finding) => finding.type === 'stale')).toBe(true);
  });

  it('flags missing opendeskmate metadata as a metadata improvement', () => {
    const findings = __curatorTest.analyzeSkillForCurator(
      skillSnapshot({
        metadata: undefined,
      }),
      Date.parse('2026-01-01T00:00:00.000Z')
    );

    expect(findings.some((finding) => finding.type === 'metadata')).toBe(true);
  });

  it('reports unused generated skills before archiving them as stale', () => {
    const findings = __curatorTest.analyzeSkillForCurator(
      skillSnapshot({
        manifest: {
          ...(skillSnapshot().entry as any).manifest,
          createdAt: '2025-11-01T00:00:00.000Z',
          updatedAt: '2025-11-01T00:00:00.000Z',
          performance: { samples: 0, successCount: 0, failureCount: 0 },
        },
      }),
      Date.parse('2026-01-01T00:00:00.000Z')
    );

    expect(findings.some((finding) => finding.type === 'unused')).toBe(true);
    expect(findings.some((finding) => finding.type === 'stale')).toBe(false);
  });

  it('flags generated skills without explicit inputs or verification as weak', () => {
    const findings = __curatorTest.analyzeSkillForCurator(
      skillSnapshot({
        body: [
          '# Demo Skill',
          '',
          '## Workflow',
          '',
          '1. Search for the original target.',
          '2. Return the answer.',
          '',
        ].join('\n'),
      }),
      Date.parse('2025-01-10T00:00:00.000Z')
    );

    expect(findings.some((finding) => finding.type === 'weak')).toBe(true);
  });

  it('detects exact duplicate checksums and keeps the stronger skill', () => {
    const duplicate = skillSnapshot({
      id: 'demo-copy',
      name: 'Demo Skill Copy',
      manifest: {
        ...(skillSnapshot().entry as any).manifest,
        skillId: 'demo-copy',
        checksum: 'abc',
        performance: { samples: 0, successCount: 0, failureCount: 0 },
      },
    });
    const keeper = skillSnapshot({
      id: 'demo-original',
      name: 'Demo Skill',
      manifest: {
        ...(skillSnapshot().entry as any).manifest,
        skillId: 'demo-original',
        checksum: 'abc',
        performance: { samples: 5, successCount: 4, failureCount: 1 },
      },
    });

    const findings = __curatorTest.detectDuplicateSkillFindings([duplicate, keeper]);

    expect(findings).toHaveLength(1);
    expect(findings[0].skillId).toBe('demo-copy');
    expect(findings[0].duplicateOfSkillId).toBe('demo-original');
    expect(findings[0].severity).toBe('warning');
  });

  it('detects normalized body duplicates even when checksums differ', () => {
    const first = skillSnapshot({
      id: 'research-brief-a',
      name: 'Research Brief Workflow',
      description: 'Gather sources and summarize findings.',
      manifest: {
        ...(skillSnapshot().entry as any).manifest,
        skillId: 'research-brief-a',
        checksum: 'one',
        performance: { samples: 3, successCount: 3, failureCount: 0 },
      },
      body: '# Research Brief Workflow\n\n## Inputs\n\n- `<topic>`\n\n## Workflow\n\n1. Gather sources.\n2. Verify facts.\n\n## Verification\n\n- Check source dates.',
    });
    const second = skillSnapshot({
      id: 'research-brief-copy',
      name: 'Research Brief Workflow Copy',
      description: 'Gather sources and summarize findings.',
      manifest: {
        ...(skillSnapshot().entry as any).manifest,
        skillId: 'research-brief-copy',
        checksum: 'two',
        performance: { samples: 0, successCount: 0, failureCount: 0 },
      },
      body: '# Research Brief Workflow\n\n## Inputs\n\n- `<subject>`\n\n## Workflow\n\n1. Gather sources.\n2. Verify facts.\n\n## Verification\n\n- Check source dates.',
    });

    const findings = __curatorTest.detectDuplicateSkillFindings([first, second]);

    expect(findings.some((finding) =>
      finding.type === 'duplicate'
      && finding.skillId === 'research-brief-copy'
      && finding.duplicateOfSkillId === 'research-brief-a'
    )).toBe(true);
  });

  it('detects same workflow-key duplicates as actionable duplicate findings', () => {
    const first = skillSnapshot({
      id: 'research-brief-workflow',
      name: 'Research Brief Workflow',
      metadata: {
        opendeskmate: {
          generatedBy: 'task-save-skill-fallback',
          origin: 'post-task-automation',
          skillKey: 'research-brief-workflow',
        },
      },
      manifest: {
        ...(skillSnapshot().entry as any).manifest,
        skillId: 'research-brief-workflow',
        checksum: 'one',
        performance: { samples: 4, successCount: 3, failureCount: 1 },
      },
    });
    const second = skillSnapshot({
      id: 'research-brief-workflow-2',
      name: 'Research Brief Workflow',
      metadata: {
        opendeskmate: {
          generatedBy: 'task-save-skill-fallback',
          origin: 'post-task-automation',
          skillKey: 'research-brief-workflow',
        },
      },
      manifest: {
        ...(skillSnapshot().entry as any).manifest,
        skillId: 'research-brief-workflow-2',
        checksum: 'two',
        performance: { samples: 0, successCount: 0, failureCount: 0 },
      },
    });

    const findings = __curatorTest.detectDuplicateSkillFindings([second, first]);
    const sameKeyFinding = findings.find((finding) =>
      finding.type === 'duplicate'
      && finding.skillId === 'research-brief-workflow-2'
      && finding.duplicateOfSkillId === 'research-brief-workflow'
    );

    expect(sameKeyFinding?.severity).toBe('warning');
    expect(sameKeyFinding?.evidence).toContain('Same opendeskmate.skillKey.');
  });

  it('builds curator action links from source task, confidence, history, and rollback versions', () => {
    const snapshot = skillSnapshot({
      manifest: {
        ...(skillSnapshot().entry as any).manifest,
        version: '1.0.2',
        lastChange: {
          changedAt: '2026-01-02T00:00:00.000Z',
          reason: 'Applied from completed task with high confidence.',
          sourceTaskId: 'task-123',
          confidence: 0.91,
          changeSource: 'post-task-skill-automation',
        },
        versions: [
          {
            version: '1.0.1',
            archivedAt: '2026-01-02T00:00:00.000Z',
            checksum: 'prev',
            relPath: 'versions/1.0.1.md',
            changeReason: 'Applied from completed task with high confidence.',
            sourceTaskId: 'task-123',
            confidence: 0.91,
            changeSource: 'post-task-skill-automation',
          },
        ],
      },
    });

    const links = __curatorTest.curatorActionLinks(snapshot.entry as any, 'run-1');

    expect(links.historyRunId).toBe('run-1');
    expect(links.sourceTaskId).toBe('task-123');
    expect(links.confidence).toBe(0.91);
    expect(links.currentVersion).toBe('1.0.2');
    expect(links.rollbackVersion).toBe('1.0.1');
    expect(links.rollbackRelPath).toBe('versions/1.0.1.md');
  });
});
