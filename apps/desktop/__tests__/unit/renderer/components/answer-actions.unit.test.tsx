// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskMessage } from '@accomplish/shared';
import { AnswerActions, AnswerActionsProvider, makeAnswerFollowUp, makeReusableApproach } from '@/components/chat/AnswerActions';
import { useAnswerFeedbackStore } from '@/stores/answerFeedbackStore';
import { useSavedPromptsStore } from '@/stores/savedPromptsStore';

const api = vi.hoisted(() => ({ upsertSavedPrompt: vi.fn() }));
vi.mock('@/lib/accomplish', () => ({ getAccomplish: () => api }));
const messages: TaskMessage[] = [
  { id: 'u', type: 'user', content: 'Cost a picnic', timestamp: '2026-09-05T12:00:00Z' },
  { id: 'a', type: 'assistant', content: 'Lunch costs EUR 140.', timestamp: '2026-09-05T12:00:01Z' },
  { id: 'u2', type: 'user', content: 'Plan a holiday', timestamp: '2026-09-05T12:01:00Z' },
];
const draft = vi.fn();
const view = (options: { taskId?: string; incognito?: boolean; canDraft?: boolean; messages?: TaskMessage[] } = {}) =>
  <AnswerActionsProvider taskId="task" messages={messages} canDraft mode="chat" onDraft={draft} {...options}>
    <AnswerActions messageId="a" content={messages[1].content} />
    <AnswerActions messageId="unowned-child" content="Child answer" />
  </AnswerActionsProvider>;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  useAnswerFeedbackStore.setState({ useful: {}, sessionUseful: {} });
  useSavedPromptsStore.setState({ prompts: [] });
  api.upsertSavedPrompt.mockImplementation(async input => input);
});
afterEach(cleanup);

it('keeps personal marks per task, persists ordinary marks, and never persists incognito marks', () => {
  const rendered = render(view());
  expect(screen.getAllByRole('group', { name: 'Answer actions' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Useful' }));
  expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true');
  expect(localStorage.getItem('deskmate-answer-feedback-v1')).toContain('task:a');
  rendered.rerender(view({ taskId: 'private', incognito: true }));
  expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Useful' }));
  expect(useAnswerFeedbackStore.getState().sessionUseful['private:a']).toBe(true);
  expect(localStorage.getItem('deskmate-answer-feedback-v1')).not.toContain('private');
  rendered.rerender(view());
  expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Useful' }));
  expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'false');
});

it('drafts follow-ups for the selected older answer and respects busy state', () => {
  const rendered = render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Explain more' }));
  expect(draft.mock.calls[0][0]).toContain('Cost a picnic');
  expect(draft.mock.calls[0][0]).toContain('Lunch costs EUR 140.');
  expect(draft.mock.calls[0][0]).not.toContain('Plan a holiday');
  fireEvent.click(screen.getByRole('button', { name: 'Try another direction' }));
  expect(draft.mock.calls[1][0]).toContain('different approach');
  expect(api.upsertSavedPrompt).not.toHaveBeenCalled();
  rendered.rerender(view({ canDraft: false }));
  expect(screen.getByRole('button', { name: 'Explain more' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Try another direction' })).toBeDisabled();
});

it('finds a same-time request even when Build restores the answer first', () => {
  render(view({ messages: [messages[1], { ...messages[0], timestamp: messages[1].timestamp }, messages[2]] }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain more' }));
  expect(draft.mock.calls[0][0]).toContain('Cost a picnic');
});

it('saves edited templates only after confirmation and prevents duplicate submits while saving', async () => {
  let resolve!: (value: unknown) => void;
  api.upsertSavedPrompt.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Save this approach' }));
  expect(screen.getByLabelText('Reusable prompt')).toHaveValue(makeReusableApproach(messages[1].content, messages[0].content));
  expect(api.upsertSavedPrompt).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Prompt name'), { target: { value: 'My approach' } });
  fireEvent.change(screen.getByLabelText('Reusable prompt'), { target: { value: 'My editable task template' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save to prompt library' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(useSavedPromptsStore.getState().prompts).toHaveLength(0);
  expect(api.upsertSavedPrompt).toHaveBeenCalledOnce();
  resolve(api.upsertSavedPrompt.mock.calls[0][0]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(useSavedPromptsStore.getState().prompts[0]).toMatchObject({ title: 'My approach', content: 'My editable task template' });
  expect(draft).not.toHaveBeenCalled();
});

it('preserves edits after a save failure and allows cancellation without saving', async () => {
  api.upsertSavedPrompt.mockRejectedValue(new Error('Library offline'));
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Save this approach' }));
  fireEvent.change(screen.getByLabelText('Prompt name'), { target: { value: 'Keep this edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save to prompt library' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Library offline');
  expect(screen.getByLabelText('Prompt name')).toHaveValue('Keep this edit');
  expect(useSavedPromptsStore.getState().prompts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.upsertSavedPrompt).toHaveBeenCalledOnce();
});

it('bounds embedded history and labels excerpts', () => {
  expect(makeAnswerFollowUp('explain', 'x'.repeat(50000), 'y'.repeat(50000)).length).toBeLessThan(6000);
  const template = makeReusableApproach('x'.repeat(50000), 'y'.repeat(50000));
  expect(template.length).toBeLessThan(9000);
  expect(template).toContain('[Excerpt ends here]');
});
