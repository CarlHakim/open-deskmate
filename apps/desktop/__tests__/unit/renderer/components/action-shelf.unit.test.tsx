// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ActionShelf from '@/components/chat/ActionShelf';
import { useSavedPromptsStore } from '@/stores/savedPromptsStore';
import { useActionShelfStore } from '@/stores/actionShelfStore';
import { actionFields, actionScope, fillAction } from '@/lib/action-shelf';

const api = vi.hoisted(() => ({ upsertSavedPrompt: vi.fn() }));
vi.mock('@/lib/accomplish', () => ({ getAccomplish: () => api }));
const onInsert = vi.fn(), onManage = vi.fn();
const base = { mode: 'chat' as const, getDraft: () => 'Preserve this draft', onInsert, onManage };
beforeEach(() => { vi.clearAllMocks(); useActionShelfStore.setState({ pins: {}, limits: {} }); useSavedPromptsStore.setState({ prompts: [] }); api.upsertSavedPrompt.mockImplementation(async value => value); });
afterEach(cleanup);

it('fills repeated fields literally without interpreting replacement strings or JSON', () => {
  const template = '{{Topic}} {"key": 1} {{Topic}} {{Budget}}';
  expect(actionFields(template)).toEqual(['Topic', 'Budget']);
  expect(fillAction(template, { Topic: '$& costs', Budget: 'EUR 100' })).toBe('$& costs {"key": 1} $& costs EUR 100');
});

it('requires fields, previews the prompt, and inserts only after the explicit action', async () => {
  render(<ActionShelf {...base} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compare costs', exact: true }));
  expect(onInsert).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Add to prompt' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Items or services'), { target: { value: 'Picnic supplies' } });
  fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
  fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '140' } });
  fireEvent.keyDown(screen.getByLabelText('Budget'), { key: 'Enter' });
  expect(onInsert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to prompt' }));
  await waitFor(() => expect(onInsert).toHaveBeenCalledOnce());
  expect(onInsert.mock.calls[0][0]).toContain('Picnic supplies in EUR. My budget is 140');
  expect(api.upsertSavedPrompt).not.toHaveBeenCalled();
});

it('keeps pins separate by mode and project and persists the selection', () => {
  const view = render(<ActionShelf {...base} projectId="one" />);
  fireEvent.click(screen.getByRole('button', { name: 'All actions', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Unpin Compare costs' }));
  expect(useActionShelfStore.getState().pins[actionScope('chat', 'one')]).toHaveLength(2);
  expect(localStorage.getItem('deskmate-action-shelf-v1')).toContain('starter:research');
  view.rerender(<ActionShelf {...base} projectId="two" />);
  expect(screen.getByRole('button', { name: 'Compare costs', exact: true })).toBeVisible();
  view.rerender(<ActionShelf {...base} projectId="one" mode="build" />);
  expect(screen.getByRole('button', { name: 'Run tests', exact: true })).toBeVisible();
  view.rerender(<ActionShelf {...base} projectId="one" />);
  expect(screen.queryByRole('button', { name: 'Compare costs', exact: true })).toBeNull();
});

it('saves through the prompt library, retains edits on error, and prevents duplicate saves', async () => {
  api.upsertSavedPrompt.mockRejectedValueOnce(new Error('Disk unavailable'));
  render(<ActionShelf {...base} />);
  fireEvent.click(screen.getByRole('button', { name: 'All actions', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Unpin Compare costs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save current prompt' }));
  expect(screen.getByLabelText('Reusable prompt')).toHaveValue('Preserve this draft');
  fireEvent.change(screen.getByLabelText('Action name'), { target: { value: 'My reusable action' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save action', exact: true }));
  expect(await screen.findByRole('status')).toHaveTextContent('Disk unavailable');
  expect(screen.getByLabelText('Action name')).toHaveValue('My reusable action');
  let resolve!: (value: unknown) => void;
  api.upsertSavedPrompt.mockImplementationOnce(value => new Promise(done => { resolve = () => done(value); }));
  fireEvent.click(screen.getByRole('button', { name: 'Save action', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
  expect(api.upsertSavedPrompt).toHaveBeenCalledTimes(2);
  resolve(null);
  await waitFor(() => expect(useSavedPromptsStore.getState().prompts).toHaveLength(1));
  expect(await screen.findByRole('button', { name: 'Unpin My reusable action' })).toBeVisible();
  expect(onInsert).not.toHaveBeenCalled();
});

it('removes deleted library actions from pins without resurrecting their content', () => {
  useSavedPromptsStore.setState({ prompts: [{ id: 'own', title: 'Custom', content: 'Review {{Topic}}', category: 'General', createdAt: '', updatedAt: '' }] });
  useActionShelfStore.getState().setPins(actionScope('chat'), ['saved:own']);
  const view = render(<ActionShelf {...base} />);
  expect(screen.getByRole('button', { name: 'Custom', exact: true })).toBeVisible();
  useSavedPromptsStore.setState({ prompts: [] });
  view.rerender(<ActionShelf {...base} />);
  expect(screen.queryByRole('button', { name: 'Custom', exact: true })).toBeNull();
});

it('defaults to ten pins, supports saved limits, and keeps pins when lowering the limit', async () => {
  useSavedPromptsStore.setState({ prompts: Array.from({ length: 9 }, (_, index) => ({ id: `own${index}`, title: `Action ${index}`, content: 'Help with this task.', category: 'General', createdAt: '', updatedAt: '' })) });
  const view = render(<ActionShelf {...base} projectId="one" />);
  fireEvent.click(screen.getByRole('button', { name: 'All actions', exact: true }));
  expect(screen.getByRole('spinbutton', { name: 'Pinning limit' })).toHaveValue(10);
  for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole('button', { name: `Pin Action ${i}`, exact: true }));
  expect(screen.getByText('10 / 10 actions pinned')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Pin Action 7', exact: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Pinning limit: 10');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Pinning limit' }), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin Action 7', exact: true }));
  expect(screen.getByText('11 / 12 actions pinned')).toBeVisible();
  await useActionShelfStore.persist.rehydrate();
  expect(useActionShelfStore.getState().limits[actionScope('chat', 'one')]).toBe(12);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Pinning limit' }), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
  expect(screen.getByText('11 / 2 actions pinned')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Unpin Action 7', exact: true }));
  expect(screen.getByText('10 / 2 actions pinned')).toBeVisible();
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Pinning limit' }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
  expect(screen.getByRole('status')).toHaveTextContent('Enter a whole number');
  view.rerender(<ActionShelf {...base} projectId="one" mode="build" />);
  fireEvent.click(screen.getByRole('button', { name: 'All actions', exact: true }));
  expect(screen.getByRole('spinbutton', { name: 'Pinning limit' })).toHaveValue(10);
  view.rerender(<ActionShelf {...base} projectId="two" />);
  fireEvent.click(screen.getByRole('button', { name: 'All actions', exact: true }));
  expect(screen.getByRole('spinbutton', { name: 'Pinning limit' })).toHaveValue(10);
});
