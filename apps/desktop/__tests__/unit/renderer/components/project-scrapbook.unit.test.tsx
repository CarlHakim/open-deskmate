// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UsageProjectWorkItem } from '@accomplish/shared';
import ProjectScrapbookTab from '@/components/usage/ProjectScrapbookTab';
import { ScrapbookSaveDialog } from '@/components/usage/ScrapbookSaveDialog';
import { scrapbookCards, scrapbookImageSrc, scrapbookTaskRoute } from '@/lib/project-scrapbook';
import { useScrapbookStore } from '@/stores/scrapbookStore';

const api = vi.hoisted(() => ({ listUsageProjects: vi.fn(), listUsageProjectWorkItems: vi.fn(), createUsageProjectWorkItem: vi.fn(), createUsageProject: vi.fn(), openPath: vi.fn(), openExternal: vi.fn(), selectFiles: vi.fn() }));
vi.mock('@/lib/accomplish', () => ({ getAccomplish: () => api }));
const item = { id: 'work', usageProjectId: 'project', title: 'Picnic planning', description: 'Our favorite plan', sourceType: 'chat_task', sourceId: 'task 1', tags: ['scrapbook'], archived: false,
  notes: [{ id: 'note', title: 'Lunch budget', text: 'Twenty people at EUR 7: EUR 140.', createdAt: '2026-09-06T12:00:00Z' }],
  documents: [{ id: 'image', label: 'Picnic photo', kind: 'local', path: 'C:\\picnic\\photo.jpg', createdAt: '2026-09-06T12:00:01Z' }],
  sources: [{ id: 'source', title: 'Park information', url: 'https://example.com/park', createdAt: '2026-09-06T12:00:02Z' }],
} as UsageProjectWorkItem;
const onNavigate = vi.fn(), onEditItem = vi.fn(), onClose = vi.fn(), onSaved = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); useScrapbookStore.setState({ favorites: {} });
  api.listUsageProjects.mockResolvedValue([{ id: 'project', name: 'Picnic', status: 'active' }]);
  api.listUsageProjectWorkItems.mockResolvedValue([item]);
  api.createUsageProjectWorkItem.mockImplementation(async input => ({ ...item, ...input }));
  api.openPath.mockResolvedValue({ ok: true }); api.openExternal.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('aggregates saved work once, excludes archives, and preserves task identities', () => {
  expect(scrapbookCards([item, { ...item, id: 'archive', archived: true }])).toHaveLength(3);
  expect(scrapbookTaskRoute(item)).toBe('/execution/task%201');
  expect(scrapbookTaskRoute({ ...item, sourceType: 'build_session', sourceId: 'build/1' })).toBe('/build?sessionId=build%2F1');
  expect(scrapbookTaskRoute({ ...item, sourceType: 'build_preset' })).toBeUndefined();
  expect(scrapbookImageSrc('C:\\files\\picnic #1.jpg')).toBe('file:///C:/files/picnic%20%231.jpg');
  expect(scrapbookImageSrc('https://example.com/tracker.jpg')).toBeUndefined();
  expect(scrapbookImageSrc('C:\\files\\script.svg')).toBeUndefined();
  expect(scrapbookCards([{ ...item, title: 'Edited collection title', documents: [], sources: [] }])[0].title).toBe('Edited collection title');
});

it('filters and favorites cards, opens the exact linked task, and uses the existing editor', async () => {
  render(<ProjectScrapbookTab projectId="project" onNavigate={onNavigate} onEditItem={onEditItem} />);
  await screen.findByRole('button', { name: 'View Lunch budget' });
  expect(api.openPath).not.toHaveBeenCalled(); expect(api.openExternal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Favorite Lunch budget' }));
  expect(localStorage.getItem('deskmate-scrapbook-v1')).toContain('work:note:note');
  fireEvent.click(screen.getByRole('button', { name: 'Favorites', exact: true }));
  expect(screen.queryByRole('button', { name: 'View Picnic photo' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View Lunch budget' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open linked task' }));
  expect(onNavigate).toHaveBeenCalledWith('/execution/task%201');
  fireEvent.click(screen.getByRole('button', { name: 'Edit in Workboard' }));
  expect(onEditItem).toHaveBeenCalledWith('work');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  fireEvent.change(screen.getByLabelText('Search scrapbook'), { target: { value: 'unmatched' } });
  expect(screen.getByText(/No matching items/)).toBeInTheDocument();
});

it('falls back when a local image is missing and reports open errors', async () => {
  api.openPath.mockResolvedValue({ ok: false, error: 'File moved' });
  render(<ProjectScrapbookTab projectId="project" onNavigate={onNavigate} onEditItem={onEditItem} />);
  fireEvent.error(await screen.findByAltText('Picnic photo'));
  expect(screen.getByText(/Preview unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Picnic photo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open original' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('File moved');
});

it('saves a reviewed answer and its optional note with the exact Build session, without updating another item', async () => {
  render(<ScrapbookSaveDialog seed={{ title: 'Build result', content: 'Verified changes', sourceType: 'build_session', sourceId: 'session1' }} projectId="project" onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Optional note'), { target: { value: 'Use this next time' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(api.createUsageProjectWorkItem).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ usageProjectId: 'project', title: 'Build result', description: 'Use this next time', sourceType: 'build_session', sourceId: 'session1', notes: [expect.objectContaining({ text: 'Verified changes' })] }));
});

it('keeps edits after save failure, blocks duplicate submits, and permits retry', async () => {
  let reject!: (error: Error) => void;
  api.createUsageProjectWorkItem.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<ScrapbookSaveDialog seed={{ title: 'Answer', content: 'Keep this' }} projectId="project" onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  reject(new Error('Disk unavailable'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable');
  expect(screen.getByLabelText('Saved content')).toHaveValue('Keep this');
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(api.createUsageProjectWorkItem).toHaveBeenCalledTimes(2);
});

it('keeps loading failures recoverable even when a project was preselected', async () => {
  api.listUsageProjects.mockRejectedValueOnce(new Error('Offline'));
  render(<ScrapbookSaveDialog seed={{ title: 'Answer', content: 'Keep this' }} projectId="project" onClose={onClose} onSaved={onSaved} />);
  await screen.findByText(/Offline/);
  expect(screen.getByRole('button', { name: 'Save item' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading projects' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled());
});

it('adds a selected local image and keeps its optional note', async () => {
  api.selectFiles.mockResolvedValue(['C:\\picnic\\photo.jpg']);
  render(<ScrapbookSaveDialog seed={{ title: 'Picnic photo' }} projectId="project" onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Item type'), { target: { value: 'file' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose files' }));
  await screen.findByText('C:\\picnic\\photo.jpg');
  fireEvent.change(screen.getByLabelText('Optional note'), { target: { value: 'Before the changes' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(api.createUsageProjectWorkItem).toHaveBeenCalledWith(expect.objectContaining({ description: 'Before the changes', documents: [expect.objectContaining({ kind: 'local', path: 'C:\\picnic\\photo.jpg' })], notes: [] }));
});

it('rejects unsafe links and preserves a long annotation on valid links', async () => {
  render(<ScrapbookSaveDialog seed={{ title: 'Venue' }} projectId="project" onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Item type'), { target: { value: 'link' } });
  fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'javascript:alert(1)' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  expect(screen.getByRole('alert')).toHaveTextContent('http or https');
  expect(api.createUsageProjectWorkItem).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.com/venue' } });
  fireEvent.change(screen.getByLabelText('Optional note'), { target: { value: 'x'.repeat(2000) } });
  fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(api.createUsageProjectWorkItem).toHaveBeenCalledWith(expect.objectContaining({ description: 'x'.repeat(2000), sources: [expect.objectContaining({ url: 'https://example.com/venue' })] }));
});

it('keeps a saved before/after comparison interactive without sending work to the parent', async () => {
  api.listUsageProjectWorkItems.mockResolvedValue([{ ...item, notes: [{ ...item.notes[0], text: '```deskmate\n'+JSON.stringify({ type: 'comparison', title: 'Writing revision', before: 'Bring food.', after: 'Please bring a packed lunch.' })+'\n```' }] }]);
  render(<ProjectScrapbookTab projectId="project" onNavigate={onNavigate} onEditItem={onEditItem} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Lunch budget' }));
  const comparison = screen.getByRole('region', { name: 'Writing revision' });
  fireEvent.click(within(comparison).getByRole('button', { name: 'After', exact: true }));
  expect(within(comparison).getByText('Please bring a packed lunch.', { exact: true })).toBeInTheDocument();
  expect(within(comparison).queryByText('Bring food.', { exact: true })).toBeNull();
  expect(api.createUsageProjectWorkItem).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
});
