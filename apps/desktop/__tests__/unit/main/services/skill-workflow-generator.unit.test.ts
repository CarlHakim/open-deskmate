import { describe, expect, it } from 'vitest';
import { __automationTest, sanitizeGeneratedSkillMd } from '@main/services/skill-workflow-generator';

function getMetadataBlock(md: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === 'metadata: |');
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') break;
    if (!/^\s+/.test(line) && line.trim() !== '') break;
    out.push(line.replace(/^\s{2,}/, ''));
  }
  return out.join('\n').trim();
}

describe('sanitizeGeneratedSkillMd', () => {
  it('removes bash from metadata.clawdbot.requires bins on win32 and preserves other frontmatter keys', () => {
    const input = [
      '---',
      'name: Test Skill',
      'description: Does a thing',
      'metadata: |',
      '    {',
      '      \"opendeskmate\": {',
        '        \"requires\": {',
          '          \"bins\": [\"bash\", \"node\"],',
          '          \"anyBins\": [\"bash\", \"pwsh\"],',
          '          \"env\": [\"FOO\"]',
        '        }',
      '      }',
      '    }',
      'tags: [\"automation\"]',
      '---',
      '',
      '# Body',
      'Do stuff.',
      '',
    ].join('\n');

    const out = sanitizeGeneratedSkillMd(input, 'win32');

    // tags line should remain (we only touch the block scalar).
    expect(out).toContain('tags: [\"automation\"]');

    const metaJson = JSON.parse(getMetadataBlock(out));
    expect(metaJson.opendeskmate.requires.bins).toEqual(['node']);
    expect(metaJson.opendeskmate.requires.anyBins).toEqual(['pwsh']);
    expect(metaJson.opendeskmate.requires.env).toEqual(['FOO']);
  });

  it('is a no-op on non-win32 platforms', () => {
    const input = [
      '---',
      'name: Test Skill',
      'description: Does a thing',
      'metadata: |',
      '    { \"opendeskmate\": { \"requires\": { \"bins\": [\"bash\"] } } }',
      '---',
      '',
      '# Body',
      '',
    ].join('\n');

    expect(sanitizeGeneratedSkillMd(input, 'linux')).toBe(input.trim());
  });
});

describe('skill automation helpers', () => {
  it('scores completed multi-tool workflows as reusable', () => {
    const evaluation = __automationTest.evaluateTaskForSkillReuse({
      prompt: 'Research and compare three providers, then summarize the recommended workflow with verification steps.',
      summary: 'Compared providers and produced a verified recommendation.',
      status: 'completed',
      messages: [
        { id: '1', type: 'user', content: 'Research providers', timestamp: '2026-01-01T00:00:00.000Z' },
        { id: '2', type: 'tool', toolName: 'websearch', content: 'results', timestamp: '2026-01-01T00:00:01.000Z' },
        { id: '3', type: 'tool', toolName: 'webfetch', content: 'source', timestamp: '2026-01-01T00:00:02.000Z' },
        { id: '4', type: 'assistant', content: 'Step 1...', timestamp: '2026-01-01T00:00:03.000Z' },
        { id: '5', type: 'assistant', content: 'Verification...', timestamp: '2026-01-01T00:00:04.000Z' },
      ],
    });

    expect(evaluation.reusable).toBe(true);
    expect(evaluation.confidenceLabel).toBe('high');
    expect(evaluation.reasons).toContain('Workflow used multiple tool calls.');
  });

  it('blocks short conversational tasks from automatic learning', () => {
    const evaluation = __automationTest.evaluateTaskForSkillReuse({
      prompt: 'thanks',
      status: 'completed',
      messages: [
        { id: '1', type: 'user', content: 'thanks', timestamp: '2026-01-01T00:00:00.000Z' },
      ],
    });

    expect(evaluation.reusable).toBe(false);
    expect(evaluation.blockers.length).toBeGreaterThan(0);
  });

  it('patches automation metadata without removing existing frontmatter keys', () => {
    const input = [
      '---',
      'name: provider-workflow',
      'description: "Compare providers"',
      'tags: ["research"]',
      '---',
      '',
      '# Provider Workflow',
      '',
      '## Workflow',
      '',
      '1. Research sources.',
      '',
    ].join('\n');

    const out = __automationTest.upsertAutomationMetadata({
      skillMd: input,
      skillId: 'provider-workflow',
      agentId: 'main',
      agentName: 'Main',
      taskId: 'task-1',
      mode: 'automatic',
      draftId: 'draft-1',
      evaluation: {
        reusable: true,
        confidence: 0.91,
        confidenceLabel: 'high',
        reasons: ['Workflow used multiple tool calls.'],
        blockers: [],
      },
      applied: true,
      nowIso: '2026-01-01T00:00:00.000Z',
    });

    expect(out).toContain('tags: ["research"]');
    const metaJson = JSON.parse(getMetadataBlock(out));
    expect(metaJson.opendeskmate.skillKey).toBe('provider-workflow');
    expect(metaJson.opendeskmate.requiresReview).toBe(false);
    expect(metaJson.opendeskmate.automation.sourceTaskId).toBe('task-1');
    expect(metaJson.opendeskmate.automation.confidence).toBe(0.91);
    expect(metaJson.opendeskmate.automation.reason).toContain('Applied from completed task');
    expect(metaJson.opendeskmate.automation.reasons).toEqual(['Workflow used multiple tool calls.']);
  });

  it('generalizes place-specific image skill names into reusable workflows', () => {
    const draft = __automationTest.normalizeDraft(
      {
        skillId: 'leiden-image-gallery',
        name: 'Leiden Image Gallery',
        description: 'Find images of Leiden.',
        skillMd: [
          '---',
          'name: leiden-image-gallery',
          'description: "Find images of Leiden."',
          '---',
          '',
          '# Leiden Image Gallery',
          '',
          '## Workflow',
          '',
          '1. Search for images of Leiden.',
          '',
        ].join('\n'),
      },
      {
        taskPrompt: 'Show me images of Leiden in the Netherlands with source links.',
        transcript: '[tool:web_image_search] results',
      }
    );

    expect(draft.skillId).toBe('find-images');
    expect(draft.name).toBe('Find Images');
    expect(draft.skillMd).toContain('name: find-images');
    expect(draft.skillMd).toContain('# Find Images');
    expect(draft.skillMd).not.toContain('name: leiden-image-gallery');
    expect(draft.skillMd).toContain('<place>');
    expect(draft.skillMd).not.toMatch(/\bLeiden\b/i);
  });

  it('generalizes file-specific software draft names', () => {
    const draft = __automationTest.normalizeDraft(
      {
        skillId: 'settings-dialog-tsx-fix',
        name: 'SettingsDialog.tsx Fix',
        description: 'Fix SettingsDialog.tsx layout issues.',
        skillMd: [
          '---',
          'name: settings-dialog-tsx-fix',
          'description: "Fix SettingsDialog.tsx layout issues."',
          '---',
          '',
          '# SettingsDialog.tsx Fix',
          '',
          '## Workflow',
          '',
          '1. Inspect SettingsDialog.tsx.',
          '',
        ].join('\n'),
      },
      {
        taskPrompt: 'Fix the layout issue in apps/desktop/src/renderer/components/layout/SettingsDialog.tsx.',
        transcript: '[tool:rg] matches\n[tool:edit] patch',
      }
    );

    expect(draft.skillId).toBe('software-change-workflow');
    expect(draft.name).toBe('Software Change Workflow');
    expect(draft.skillMd).toContain('# Software Change Workflow');
  });

  it('does not auto-apply drafts that still lack reusable structure', () => {
    const readiness = __automationTest.assessDraftAutomationReadiness({
      draft: {
        skillId: 'find-images',
        name: 'Find Images',
        description: 'Find images for a place.',
        skillMd: [
          '---',
          'name: find-images',
          'description: "Find images for a place."',
          '---',
          '',
          '# Find Images',
          '',
          'Search for images of <place> and return them.',
          '',
        ].join('\n'),
      },
      prompt: 'Show me images of Leiden with source links.',
      evaluation: {
        reusable: true,
        confidence: 0.93,
        confidenceLabel: 'high',
        reasons: ['Workflow used multiple tool calls.'],
        blockers: [],
      },
    });

    expect(readiness.automatic).toBe(false);
    expect(readiness.blockers).toContain('Draft body is too thin for automatic save.');
  });

  it('updates only automation-owned generated skills and leaves manual save-as-skill drafts alone', () => {
    const baseSkill = {
      id: 'find-images',
      name: 'Find Images',
      description: 'Find image galleries for a place.',
      source: 'managed',
      baseDir: 'C:/tmp/find-images',
      filePath: 'C:/tmp/find-images/SKILL.md',
      editable: true,
      manifest: {
        schemaVersion: 1,
        skillId: 'find-images',
        name: 'Find Images',
        version: '1.0.0',
        state: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        checksum: 'abc',
        versions: [],
      },
    } as any;
    const draft = {
      skillId: 'find-images',
      name: 'Find Images',
      description: 'Find image galleries for a place.',
      skillMd: '# Find Images\n\n## Workflow\n\n1. Search for <place>.',
    };

    const manualDraft = {
      ...baseSkill,
      metadata: {
        opendeskmate: {
          generatedBy: 'task-save-skill-draft',
          requiresReview: true,
        },
      },
    };
    expect(__automationTest.findGeneratedSkillUpdateTarget([manualDraft], draft)).toBeUndefined();

    const automationOwned = {
      ...baseSkill,
      metadata: {
        opendeskmate: {
          generatedBy: 'task-save-skill-draft',
          origin: 'post-task-automation',
          automation: {
            mode: 'automatic',
            sourceTaskId: 'task-1',
            appliedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    };
    expect(__automationTest.findGeneratedSkillUpdateTarget([automationOwned], draft)?.id).toBe('find-images');
  });

  it('finds generated duplicate skills by workflow key before minting suffixed ids', () => {
    const existing = {
      id: 'research-brief-workflow-2',
      name: 'research-brief-workflow-2',
      description: 'Gather, verify, and present a concise research answer with useful sources.',
      source: 'managed',
      baseDir: 'C:/tmp/research-brief-workflow-2',
      filePath: 'C:/tmp/research-brief-workflow-2/SKILL.md',
      editable: true,
      visibilityOwnerAgentId: 'full-stack-engineer',
      manifest: {
        schemaVersion: 1,
        skillId: 'research-brief-workflow-2',
        name: 'research-brief-workflow-2',
        version: '1.0.0',
        state: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        checksum: 'abc',
        versions: [],
      },
      metadata: {
        opendeskmate: {
          skillKey: 'research-brief-workflow',
          generatedBy: 'task-save-skill-fallback',
          origin: 'post-task-automation',
          visibility: {
            scope: 'private',
            ownerAgentId: 'full-stack-engineer',
            sharedWithAgentIds: [],
          },
        },
      },
    } as any;
    const draft = {
      skillId: 'research-brief-workflow',
      name: 'Research Brief Workflow',
      description: 'Gather, verify, and present a concise research answer with useful sources.',
      skillMd: [
        '---',
        'name: research-brief-workflow',
        'description: "Gather, verify, and present a concise research answer with useful sources."',
        'metadata: |',
        '  {',
        '    "opendeskmate": {',
        '      "skillKey": "research-brief-workflow",',
        '      "generatedBy": "task-save-skill-draft"',
        '    }',
        '  }',
        '---',
        '',
        '# Research Brief Workflow',
        '',
        '## Workflow',
        '',
        '1. Research <topic>.',
      ].join('\n'),
    };

    expect(__automationTest.findGeneratedSkillDuplicateTarget([existing], draft, 'synthesizer')?.id)
      .toBe('research-brief-workflow-2');
  });
});
