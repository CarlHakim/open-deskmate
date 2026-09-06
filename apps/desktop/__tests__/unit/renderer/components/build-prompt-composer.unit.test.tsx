// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/components/chat/ContextInspector', () => ({ default: () => null }));
vi.mock('@/components/chat/ContextWindowIndicator', () => ({ default: () => null }));
vi.mock('@/components/usage/UsageProjectSelector', () => ({ UsageProjectSelector: () => null }));
vi.mock('@/components/build/BuildFileTree', () => ({ BuildTooltip: ({ children }: { children: React.ReactNode }) => children }));
import { BuildPromptComposer, type BuildPromptComposerProps } from '@/components/build/BuildPromptComposer';
afterEach(cleanup);

function makeProps(): BuildPromptComposerProps {
  return {
    resetKey: 0, initialValue: '', attachedFiles: [], aiBusy: false, interruptingAiTask: false,
    autoRepairBusy: false, contextStats: null, askAiToRunTests: false, promptsCount: 0, slashCommands: [],
    onRun: vi.fn(), onDraftChange: vi.fn(), onStop: vi.fn(), onAttachFiles: vi.fn(), onAddAttachedFiles: vi.fn(),
    onRemoveFile: vi.fn(), onOpenSavedPrompts: vi.fn(), onSaveCurrentPrompt: vi.fn(), onOpenProjectWork: vi.fn(),
    onAskAiToRunTestsChange: vi.fn(),
  };
}

it('keeps a submitted draft until the parent confirms acceptance and resets it', () => {
  const props = makeProps();
  const { rerender } = render(<BuildPromptComposer {...props} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Next task instructions' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run AI task' }));
  expect(props.onRun).toHaveBeenCalledWith('Next task instructions');
  expect(input).toHaveValue('Next task instructions');
  // A resumed parent prevents acceptance, so its busy update must keep the draft.
  rerender(<BuildPromptComposer {...props} aiBusy />);
  expect(input).toHaveValue('Next task instructions');
  expect(screen.queryByRole('button', { name: 'Run AI task' })).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(props.onRun).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Stop current build task' }));
  expect(props.onStop).toHaveBeenCalledTimes(1);
  rerender(<BuildPromptComposer {...props} aiBusy interruptingAiTask />);
  expect(screen.getByRole('button', { name: 'Stopping current build task' })).toBeDisabled();
  // Only the successful submission's explicit reset clears it.
  rerender(<BuildPromptComposer {...props} aiBusy resetKey={1} />);
  expect(input).toHaveValue('');
});

it('preserves the draft while expanding and only submits with the explicit keyboard shortcut', () => {
  const props = makeProps();
  render(<BuildPromptComposer {...props} />);
  const input = screen.getByRole('textbox', { name: 'Build prompt', exact: true });
  fireEvent.change(input, { target: { value: 'A long draft\nwith a second line' } });
  fireEvent.click(screen.getByRole('button', { name: 'Expand Build prompt editor' }));
  expect(input).toHaveValue('A long draft\nwith a second line');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Build prompt editor' }));
  expect(input).toHaveValue('A long draft\nwith a second line');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(props.onRun).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(props.onRun).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(props.onRun).toHaveBeenCalledWith('A long draft\nwith a second line');
});

it('keeps the secondary controls available in options without changing the draft', () => {
  const props = { ...makeProps(), promptsCount: 2, showProposedDiffPopupButton: true, onOpenProposedDiffPopup: vi.fn() };
  render(<BuildPromptComposer {...props} />);
  const input = screen.getByRole('textbox', { name: 'Build prompt', exact: true });
  fireEvent.change(input, { target: { value: 'Keep my draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'More options' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Ask AI to run tests' }));
  expect(props.onAskAiToRunTestsChange).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use saved prompt' }));
  expect(props.onOpenSavedPrompts).toHaveBeenCalledWith('select');
  fireEvent.click(screen.getByRole('button', { name: 'Manage saved prompts' }));
  expect(props.onOpenSavedPrompts).toHaveBeenCalledWith('manage');
  fireEvent.click(screen.getByRole('button', { name: 'Save current Build prompt' }));
  expect(props.onSaveCurrentPrompt).toHaveBeenCalledWith('Keep my draft');
  fireEvent.click(screen.getByRole('button', { name: 'Open project work linked to this preset' }));
  expect(props.onOpenProjectWork).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Open Changes & Git popup' }));
  expect(props.onOpenProposedDiffPopup).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close prompt options' }));
  expect(input).toHaveValue('Keep my draft');
  expect(props.onRun).not.toHaveBeenCalled();
});

it('shows extra attachments in a removable overflow list', () => {
  const props = { ...makeProps(), attachedFiles: ['C:/one.txt', 'C:/two.txt', 'C:/three.txt'] };
  render(<BuildPromptComposer {...props} />);
  expect(screen.getByRole('button', { name: 'Remove attachment one.txt' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove attachment three.txt' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show remaining attachments' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove attachment three.txt' }));
  expect(props.onRemoveFile).toHaveBeenCalledWith('C:/three.txt');
  expect(props.onRun).not.toHaveBeenCalled();
});
