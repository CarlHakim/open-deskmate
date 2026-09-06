// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskMessage } from '@accomplish/shared';
import { buildTaskJourney } from '@/lib/task-journey';
import { AnswerHighlight, TaskJourney } from '@/components/chat/TaskJourney';
import { ExperienceSettings } from '@/components/chat/ExperienceSettings';
import { useExperienceStore } from '@/stores/experienceStore';

vi.mock('@/components/layout/AgentAvatarPicker', () => ({ AgentAvatarIcon: () => <span>Avatar</span> }));
const user: TaskMessage = { id: 'user', type: 'user', content: 'Make a plan', timestamp: '2026-09-05T12:00:00Z' };
const answer: TaskMessage = { id: 'answer', type: 'assistant', content: 'Here is the result.', timestamp: '2026-09-05T12:00:02Z' };
const tool: TaskMessage = { id: 'test', type: 'tool', toolName: 'Bash', toolInput: { command: 'pnpm test' }, content: '1 failed', timestamp: '2026-09-05T12:00:01Z' };
beforeEach(() => {
  useExperienceStore.setState({ mode: 'balanced', celebrations: true, sound: false });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('shows only recorded stages for the latest prompt, retaining failed check evidence', () => {
  const old = { ...tool, id: 'old', toolName: 'Read', timestamp: '2026-09-04T12:00:00Z' };
  const journey = buildTaskJourney([old, user, tool, answer], [], 'completed');
  expect(journey.entries.map(entry => entry.stage)).toEqual(['Checking', 'Creating', 'Ready']);
  expect(journey.entries[0].detail).toBe('1 failed');
  expect(buildTaskJourney([user, tool], [], 'failed').label).toBe('Needs attention');
  expect(buildTaskJourney([user], [], 'interrupted').label).toBe('Stopped');
  expect(buildTaskJourney([user], [], 'waiting_permission').label).toBe('Waiting for permission');
});

it('opens recorded evidence and navigates to its history message', () => {
  const open = vi.fn();
  render(<TaskJourney taskId="inspect" status="completed" messages={[user, tool, answer]} onOpenMessage={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'Checking: 1 recorded item' }));
  expect(screen.getByText('1 failed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show in history' }));
  expect(open).toHaveBeenCalledWith('test');
});

it('retains equal-time evidence when restored Build messages sort before their prompt', () => {
  const messages = [{ ...answer, timestamp: user.timestamp }, { ...tool, timestamp: user.timestamp }, user];
  const journey = buildTaskJourney(messages, [], 'completed');
  expect(journey.entries.some(entry => entry.id === 'answer')).toBe(true);
  expect(journey.entries.some(entry => entry.id === 'test')).toBe(true);
});

it('keeps stage details open as new live answers arrive', () => {
  const view = render(<TaskJourney taskId="inspect-live" status="running" messages={[user, tool]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Checking: 1 recorded item' }));
  view.rerender(<TaskJourney taskId="inspect-live" status="running" messages={[user, tool, answer]} />);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('1 failed')).toBeInTheDocument();
});

it('celebrates a live success once, without replaying when history is reopened', () => {
  vi.useFakeTimers();
  const view = render(<><TaskJourney taskId="live" status="running" messages={[user]} /><AnswerHighlight messageId="answer">Result</AnswerHighlight></>);
  view.rerender(<><TaskJourney taskId="live" status="completed" messages={[user, answer]} /><AnswerHighlight messageId="answer">Result</AnswerHighlight></>);
  expect(screen.getByText('Result')).toHaveClass('task-result-highlight');
  act(() => vi.advanceTimersByTime(1900));
  expect(screen.getByText('Result')).not.toHaveClass('task-result-highlight');
  view.unmount();
  render(<><TaskJourney taskId="live" status="completed" messages={[user, answer]} /><AnswerHighlight messageId="answer">Result</AnswerHighlight></>);
  expect(screen.getByText('Result')).not.toHaveClass('task-result-highlight');
});

it.each(['failed', 'interrupted', 'cancelled'] as const)('does not celebrate %s tasks', status => {
  const view = render(<TaskJourney taskId={status} status="running" messages={[user]} />);
  view.rerender(<TaskJourney taskId={status} status={status} messages={[user, answer]} />);
  expect(view.container.querySelector('.task-completion-avatar')).toBeNull();
});

it('treats guidance as waiting, and honors Calm and reduced motion', () => {
  const choices = { ...answer, content: '```deskmate\n' + JSON.stringify({ type: 'choices', title: 'Choose', options: [{ label: 'Short', description: 'Summary', prompt: 'Summarize' }, { label: 'Long', description: 'Details', prompt: 'Expand' }] }) + '\n```' };
  expect(buildTaskJourney([user, choices], [], 'completed').label).toBe('Waiting for your choice');
  expect(buildTaskJourney([user, choices], [], 'completed').entries.some(entry => entry.stage === 'Ready')).toBe(false);
  useExperienceStore.setState({ mode: 'calm' });
  const view = render(<TaskJourney taskId="calm" status="running" messages={[user]} />);
  view.rerender(<TaskJourney taskId="calm" status="completed" messages={[user, answer]} />);
  expect(view.container.querySelector('.task-completion-avatar')).toBeNull();
  useExperienceStore.setState({ mode: 'playful' });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  view.rerender(<TaskJourney taskId="reduced" status="running" messages={[user]} />);
  view.rerender(<TaskJourney taskId="reduced" status="completed" messages={[user, answer]} />);
  expect(view.container.querySelector('.task-completion-avatar')).toBeNull();
});

it('saves the shared style and sound preference without coupling the two', () => {
  render(<ExperienceSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'playful' }));
  fireEvent.click(screen.getByLabelText('Soft completion chime (off in Calm)'));
  expect(useExperienceStore.getState()).toMatchObject({ mode: 'playful', sound: true });
  const saved = JSON.parse(localStorage.getItem('deskmate-experience-v1')!);
  expect(saved.state).toMatchObject({ mode: 'playful', sound: true });
});
