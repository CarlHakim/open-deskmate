import { describe, expect, it } from 'vitest';
import { sanitizeGeneratedSkillMd } from '@main/services/skill-workflow-generator';

function getMetadataBlock(md: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === 'metadata: |');
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') break;
    if (!line.startsWith('    ') && line.trim() !== '') break;
    out.push(line.replace(/^ {4}/, ''));
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

    expect(sanitizeGeneratedSkillMd(input, 'linux')).toBe(input);
  });
});
