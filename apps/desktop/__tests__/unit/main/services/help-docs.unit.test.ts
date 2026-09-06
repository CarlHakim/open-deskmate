import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '', appPath: '', userData: '' }));
vi.mock('electron', () => ({ app: {
  isPackaged: false,
  getAppPath: () => fixture.appPath,
  getPath: () => fixture.userData,
}, shell: { openPath: vi.fn() } }));
vi.mock('@main/plugins/plugin-registry', () => ({ listEnabledPluginHelpDocContributions: () => [] }));
import { initializeHelpDocs, readHelpDoc, searchHelpDocs } from '@main/services/help-docs';

const hash = (text: string) => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const defaults = () => path.join(fixture.appPath, 'resources', 'help-defaults');
const help = () => path.join(fixture.userData, 'help');
function write(root: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}
function stock(content = '# Guide\nOriginal stock\n') {
  write(defaults(), 'guide.md', content);
  write(defaults(), 'index.json', JSON.stringify({ docs: [{ id: 'guide', title: 'Guide', file: 'guide.md' }] }));
}
beforeEach(() => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskmate-help-test-'));
  fixture.appPath = path.join(fixture.root, 'app');
  fixture.userData = path.join(fixture.root, 'user');
  stock();
});
afterEach(() => {
  const resolved = path.resolve(fixture.root);
  if (!resolved.startsWith(path.join(os.tmpdir(), 'deskmate-help-test-'))) throw Error('Unexpected fixture root');
  fs.rmSync(resolved, { recursive: true, force: true });
});

it('installs guides and refreshes unchanged stock across upgrades without rewriting on every startup', async () => {
  await initializeHelpDocs();
  expect((await readHelpDoc('guide')).content).toContain('Original stock');
  stock('# Guide\nNew release content\n');
  await initializeHelpDocs();
  expect((await readHelpDoc('guide')).content).toContain('New release content');
  const before = fs.statSync(path.join(help(), 'guide.md')).mtimeMs;
  const stateBefore = fs.statSync(path.join(help(), '.stock-state.json')).mtimeMs;
  await initializeHelpDocs();
  expect(fs.statSync(path.join(help(), 'guide.md')).mtimeMs).toBe(before);
  expect(fs.statSync(path.join(help(), '.stock-state.json')).mtimeMs).toBe(stateBefore);
});

it('migrates recognised old stock with either platform line ending', async () => {
  write(help(), 'guide.md', '# Legacy guide\r\nStock text\r\n');
  write(defaults(), '.stock-history.json', JSON.stringify({ version: 1, files: { 'guide.md': [hash('# Legacy guide\nStock text\n')] } }));
  await initializeHelpDocs();
  expect((await readHelpDoc('guide')).content).toContain('Original stock');
  expect(fs.existsSync(path.join(help(), '.stock-history.json'))).toBe(false);
});

it('preserves edits across repeated upgrades while adding and searching new guides', async () => {
  await initializeHelpDocs();
  write(help(), 'guide.md', '# My guide\nKeep my custom instructions.\n');
  stock('# Guide\nRelease two\n');
  write(defaults(), 'scrapbook.md', '# Scrapbook\nSave a project reference.\n');
  write(defaults(), 'index.json', JSON.stringify({ docs: [
    { id: 'guide', title: 'Guide', file: 'guide.md' },
    { id: 'scrapbook', title: 'Scrapbook', file: 'scrapbook.md' },
  ] }));
  await initializeHelpDocs();
  write(defaults(), 'guide.md', '# Guide\nRelease three\n');
  await initializeHelpDocs();
  expect((await readHelpDoc('guide')).content).toContain('Keep my custom instructions.');
  expect((await searchHelpDocs('scrapbook')).results[0].docId).toBe('scrapbook');
});

it('preserves unknown legacy pages and custom index order, labels, URL, and custom guides', async () => {
  write(help(), 'guide.md', '# Unknown legacy or custom guide\n');
  write(help(), 'mine.md', '# My own page\n');
  write(help(), 'index.json', JSON.stringify({ embeddedSiteUrl: 'https://example.org/docs', docs: [
    { id: 'mine', title: 'Mine first', file: 'mine.md' },
    { id: 'guide', title: 'Renamed guide', file: 'guide.md', description: 'My description' },
  ] }));
  write(defaults(), 'new.md', '# New guide');
  write(defaults(), 'index.json', JSON.stringify({ docs: [
    { id: 'guide', title: 'Guide', file: 'guide.md' },
    { id: 'new', title: 'New guide', file: 'new.md' },
  ] }));
  const result = await initializeHelpDocs();
  expect(result.docs.map(doc => doc.title)).toEqual(['Mine first', 'Renamed guide', 'New guide']);
  expect(result.embeddedSiteUrl).toBe('https://example.org/docs');
  expect((await readHelpDoc('guide')).content).toContain('Unknown legacy or custom');
  await initializeHelpDocs();
  expect(JSON.parse(fs.readFileSync(path.join(help(), 'index.json'), 'utf8')).docs).toHaveLength(3);
});

it('does not classify custom content as stock when tracking metadata is corrupt', async () => {
  write(help(), 'guide.md', '# Local edits');
  write(help(), '.stock-state.json', '{broken');
  write(defaults(), '.stock-history.json', JSON.stringify({ version: 1, files: [] }));
  await initializeHelpDocs();
  expect((await readHelpDoc('guide')).content).toBe('# Local edits');
});

it('does not overwrite files through a user-created directory link', async () => {
  const outside = path.join(fixture.root, 'linked-notes');
  write(outside, 'guide.md', '# Old stock');
  fs.mkdirSync(help(), { recursive: true });
  fs.symlinkSync(outside, path.join(help(), 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  write(defaults(), 'linked/guide.md', '# New stock');
  write(defaults(), '.stock-history.json', JSON.stringify({ version: 1, files: { 'linked/guide.md': [hash('# Old stock')] } }));
  await initializeHelpDocs();
  expect(fs.readFileSync(path.join(outside, 'guide.md'), 'utf8')).toBe('# Old stock');
});
