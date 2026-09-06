// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentProfile, SubagentRunRecord, TaskMessage } from '@accomplish/shared';
import { AgentCharacterButton, AgentCharacterProvider } from '@/components/agents/AgentCharacterCard';
import { useAgentStore } from '@/stores/agentStore';

const api = vi.hoisted(() => ({ listTools: vi.fn() }));
vi.mock('@/lib/accomplish', () => ({ getAccomplish: () => api }));
vi.mock('@/components/layout/AgentAvatarPicker', () => ({ AgentAvatarIcon: () => <span>Avatar</span> }));
const messages: TaskMessage[] = [
  { id: 'u', type: 'user', content: 'Compare picnic packages', timestamp: '2026-09-05T12:00:00Z' },
  { id: 't', type: 'tool', toolName: 'Read', content: 'Prices', timestamp: '2026-09-05T12:00:01Z' },
  { id: 'a', type: 'assistant', content: 'The Basic package costs EUR 140.', timestamp: '2026-09-05T12:00:02Z' },
];
const helper = (id: string, label: string, status = 'done') => ({ runId: id, childAgentId: 'shared', parentAgentId: 'shared', parentTaskId: 'task', task: label, label, status, resultStatus: 'success', finalReport: `${label} result`, createdAt: '2026-09-05T12:00:00Z', updatedAt: '2026-09-05T12:00:02Z', inheritedContext: { enabledToolsetIds: ['research'] } } as SubagentRunRecord);
const runs = [helper('first', 'Find prices'), helper('second', 'Plan games')];
const openMessage = vi.fn(), openRun = vi.fn(), guide = vi.fn();
const view = (taskId = 'task', taskMessages = messages) => <AgentCharacterProvider agentId="shared" taskId={taskId} status="completed" messages={taskMessages} runs={runs} onOpenMessage={openMessage} onOpenRun={openRun} onGuideParent={guide}>
  <AgentCharacterButton aria-label="Parent card">Parent</AgentCharacterButton>
  <AgentCharacterButton aria-label="First helper card" target={{ runId: 'first' }}>First</AgentCharacterButton>
  <AgentCharacterButton aria-label="Second helper card" target={{ runId: 'second' }}>Second</AgentCharacterButton>
  <AgentCharacterButton aria-label="Unmatched relay" target={{ childAgentId: 'shared', messageId: 'a' }}>Relay</AgentCharacterButton>
</AgentCharacterProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  api.listTools.mockResolvedValue({ tools: [{ name: 'web', displayName: 'Web research', description: 'Look up sources', category: 'research', risk: 'low' }] });
  useAgentStore.setState({ agents: [{ id: 'shared', name: 'Pip', roleName: 'Planner', description: 'Plans practical events.', toolsetIds: ['coding'], createdAt: '', updatedAt: '' } as AgentProfile] });
});
afterEach(cleanup);

it('loads descriptions only on opening and links recorded parent contributions', async () => {
  render(view());
  expect(api.listTools).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Parent card' }));
  const card = screen.getByRole('dialog', { name: 'Pip' });
  expect(within(card).getByText('Plans practical events.')).toBeInTheDocument();
  expect(within(card).getByText('Compare picnic packages')).toBeInTheDocument();
  await within(card).findByText('Web research');
  expect(api.listTools).toHaveBeenCalledExactlyOnceWith({ toolsetIds: ['coding'] });
  fireEvent.click(within(card).getByRole('button', { name: /The Basic package/ }));
  expect(openMessage).toHaveBeenCalledExactlyOnceWith('a');
});

it('keeps helpers sharing the coordinator profile separate and opens the exact run', async () => {
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Second helper card' }));
  expect(screen.getByText('Plan games result')).toBeInTheDocument();
  expect(screen.queryByText('Find prices result')).toBeNull();
  expect(screen.queryByText('The Basic package costs EUR 140.')).toBeNull();
  await waitFor(() => expect(api.listTools).toHaveBeenCalledWith({ toolsetIds: ['research'] }));
  fireEvent.click(screen.getByRole('button', { name: 'Progress & guidance' }));
  expect(openRun).toHaveBeenCalledExactlyOnceWith(runs[1]);
});

it('does not guess a helper run from an ambiguous profile and still links the relay', () => {
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Unmatched relay' }));
  expect(screen.getByText('No specific assignment is available for this avatar.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Progress & guidance' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /The Basic package/ }));
  expect(openMessage).toHaveBeenCalledWith('a');
});

it('handles lookup failure and closes on Escape or a different task', async () => {
  api.listTools.mockRejectedValue(new Error('offline'));
  const rendered = render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Parent card' }));
  await screen.findByText(/Capability descriptions could not be loaded/);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Parent card' }));
  rendered.rerender(view('other-task'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('updates an open card with new contributions without starting work', async () => {
  const rendered = render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Parent card' }));
  const updated = [...messages, { ...messages[2], id: 'new', content: 'Sheltered costs EUR 318.' }];
  rendered.rerender(view('task', updated));
  expect(screen.getByText('Sheltered costs EUR 318.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open prompt box' }));
  expect(guide).toHaveBeenCalledOnce();
  expect(openRun).not.toHaveBeenCalled();
  expect(openMessage).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
