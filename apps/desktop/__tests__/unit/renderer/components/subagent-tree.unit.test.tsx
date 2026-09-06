// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SubagentRunTreeNode } from '@accomplish/shared';
const api = vi.hoisted(() => ({ updateSubagentPolicy: vi.fn().mockResolvedValue(undefined), consumeSubagentResults: vi.fn().mockResolvedValue(true) }));
vi.mock('@/components/layout/AgentAvatarPicker', () => ({ AgentAvatarIcon: () => <span>Avatar</span> }));
vi.mock('../../../../src/renderer/lib/accomplish', () => ({ getAccomplish: () => api }));
import SubagentTreeList from '../../../../src/renderer/components/subagents/SubagentTreeList';
afterEach(cleanup);
it('preserves transcript and session controls and exposes result delivery and spending limits', async () => {
  const open = vi.fn(); const close = vi.fn();
  const run = { runId: 'one', childAgentId: 'helper', parentTaskId: 'parent', task: 'Review files', mode: 'run', status: 'done', resultStatus: 'success', children: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resultDelivery: { state: 'ready' }, executionPolicy: { runTimeoutMs: 60000 }, ownedPaths: ['src'] } as unknown as SubagentRunTreeNode;
  render(<SubagentTreeList nodes={[run]} agentNames={new Map()} stoppingSubagentRunId={null} onOpen={open} onInspect={vi.fn()} onStop={vi.fn()} onCloseSession={close} onArchive={vi.fn()} onRecover={vi.fn()} onReplace={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open subagent transcript' }));
  expect(open).toHaveBeenCalledWith(run);
  fireEvent.click(screen.getByRole('button', { name: 'Open helper progress' }));
  expect(open).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Close child session' }));
  expect(close).toHaveBeenCalledWith('one');
  fireEvent.click(screen.getByRole('button', { name: 'Use results in parent' }));
  await waitFor(() => expect(api.consumeSubagentResults).toHaveBeenCalledWith({ parentTaskId: 'parent' }));
  fireEvent.click(screen.getByText('Limits and next action'));
  fireEvent.change(screen.getByLabelText('Child spending limit (USD)'), { target: { value: '2.5' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save limits' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
  await waitFor(() => expect(api.updateSubagentPolicy).toHaveBeenCalledWith({ runId: 'one', maxCostUsd: 2.5, runTimeoutMs: 60000, limitAction: 'notify' }));
});
