import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const root = path.resolve('resources/help-defaults');
const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8')) as {
  docs: Array<{ id: string; title: string; file: string }>;
};

it('indexes each bundled guide once and resolves its relative links and images', () => {
  expect(new Set(index.docs.map(doc => doc.id)).size).toBe(index.docs.length);
  expect(new Set(index.docs.map(doc => doc.file)).size).toBe(index.docs.length);
  const indexed = new Set(index.docs.map(doc => path.resolve(root, doc.file)));
  for (const doc of index.docs) {
    const absolute = path.resolve(root, doc.file);
    expect(fs.existsSync(absolute), doc.file).toBe(true);
    const markdown = fs.readFileSync(absolute, 'utf8').replace(/```[\s\S]*?```/g, '');
    expect(markdown.trimStart().startsWith('# '), doc.file).toBe(true);
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].split('#')[0];
      if (!href || /^(https?:|mailto:)/i.test(href)) continue;
      const target = path.resolve(path.dirname(absolute), href);
      expect(target.startsWith(root + path.sep), `${doc.file}: ${href}`).toBe(true);
      expect(fs.existsSync(target), `${doc.file}: ${href}`).toBe(true);
      if (target.endsWith('.md')) expect(indexed.has(target), `${doc.file}: unindexed ${href}`).toBe(true);
    }
  }
});
