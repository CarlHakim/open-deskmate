// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ReactMarkdown from 'react-markdown';
import { parseInteractiveAnswer } from '@accomplish/shared';
import { AnswerScope, interactiveMarkdownComponents } from '@/components/chat/InteractiveAnswer';
import { GuidanceContext } from '@/components/chat/GuidanceChoices';
afterEach(cleanup);
const choices = { type: 'choices', title: 'Choose a direction', options: [{ label: 'Overview', description: 'A brief summary', prompt: 'Give me an overview.' }, { label: 'Details', description: 'More explanation', prompt: 'Explain in detail.' }] };
it('stages a choice or free-text direction without automatically sending a prompt', () => {
  const choose = vi.fn();
  render(<GuidanceContext.Provider value={{ messageId: 'choose-test', disabled: false, onChoose: choose }}>{answer(choices, 'choose-test')}</GuidanceContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
  expect(choose).toHaveBeenCalledExactlyOnceWith('Give me an overview.');
  expect(screen.getByRole('status')).toHaveTextContent('Review it and send when ready.');
  fireEvent.change(screen.getByLabelText('Your own direction'), { target: { value: 'Make a checklist instead.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use my direction' }));
  expect(choose).toHaveBeenLastCalledWith('Make a checklist instead.');
});
it('disables stale or busy guidance and rejects malformed options', () => {
  const choose = vi.fn();
  const view = render(<GuidanceContext.Provider value={{ messageId: 'new-answer', disabled: false, onChoose: choose }}>{answer(choices, 'old-answer')}</GuidanceContext.Provider>);
  expect(screen.getByRole('button', { name: /Overview/ })).toBeDisabled();
  view.rerender(<GuidanceContext.Provider value={{ messageId: 'old-answer', disabled: true, onChoose: choose }}>{answer(choices, 'old-answer')}</GuidanceContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
  expect(choose).not.toHaveBeenCalled();
  for (const options of [[], [choices.options[0]], [choices.options[0], choices.options[0]], [{ label: 'Bad' }, choices.options[0]]]) {
    expect(parseInteractiveAnswer(JSON.stringify({ ...choices, options }))).toBeNull();
  }
});
const answer = (data: unknown, scope: string) => <AnswerScope.Provider value={scope}><ReactMarkdown components={interactiveMarkdownComponents}>{'```deskmate\n' + JSON.stringify(data) + '\n```'}</ReactMarkdown></AnswerScope.Provider>;
it('recalculates a budget locally and retains the selection across virtualized remounts', () => {
  const data = { type: 'budget', title: 'Picnic budget', currency: 'EUR', quantity: 20, items: [{ label: 'Sandwich', unitPrice: 4 }, { label: 'Drink', unitPrice: 2 }, { label: 'Fruit', unitPrice: 1 }] };
  const view = render(answer(data, 'budget-test'));
  expect(screen.getByText('Total: EUR 140.00')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Budget quantity'), { target: { value: '30' } });
  expect(screen.getByText('Total: EUR 210.00')).toBeInTheDocument();
  view.unmount(); render(answer(data, 'budget-test'));
  expect(screen.getByLabelText('Budget quantity')).toHaveValue(30);
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByLabelText('Budget quantity')).toHaveValue(20);
});
it('allows checklist interaction and text comparison without executing actions', () => {
  render(answer({ type: 'checklist', title: 'Checklist', items: ['Check the venue'] }, 'check-test'));
  fireEvent.click(screen.getByLabelText('Check the venue'));
  expect(screen.getByText('1 of 1 checked')).toBeInTheDocument();
  render(answer({ type: 'comparison', title: 'Revision', before: 'Old copy', after: 'New copy' }, 'compare-test'));
  fireEvent.click(screen.getByRole('button', { name: 'After', exact: true }));
  expect(screen.queryByText('Old copy', { selector: 'p' })).toBeNull();
  expect(screen.getByText('New copy', { selector: 'p' })).toBeInTheDocument();
});
it('keeps invalid, partial, and unsupported blocks as ordinary code', () => {
  for (const source of ['{"type":', '{"type":"script","title":"Run","code":"alert(1)"}', 'x'.repeat(16001), JSON.stringify({ type: 'budget', title: 'Bad', quantity: -1, currency: 'EUR', items: [] })]) expect(parseInteractiveAnswer(source)).toBeNull();
  render(<ReactMarkdown components={interactiveMarkdownComponents}>{'```deskmate\n{"type":\n```'}</ReactMarkdown>);
  expect(screen.getByText('{"type":', { selector: 'code' })).toBeInTheDocument();
});
