// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import ComposerOptions from '../../../../src/renderer/components/chat/ComposerOptions';

afterEach(cleanup);

it('retains action handlers, disabled controls, and draft values when collapsed', () => {
  const action = vi.fn();
  const disabledAction = vi.fn();
  function Composer() {
    const [draft, setDraft] = useState('initial');
    return <ComposerOptions>
      <button aria-label="Manage prompts" onClick={action}><span aria-hidden>+</span></button>
      <button title="Voice wake" disabled onClick={disabledAction}>Off</button>
      <input aria-label="Draft option" value={draft} onChange={event => setDraft(event.target.value)} />
    </ComposerOptions>;
  }
  render(<Composer />);
  fireEvent.click(screen.getByRole('button', { name: /More options/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage prompts' }));
  fireEvent.click(screen.getByRole('button', { name: /Voice wake/ }));
  fireEvent.change(screen.getByLabelText('Draft option'), { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close prompt options' }));
  fireEvent.click(screen.getByRole('button', { name: /More options/ }));
  expect(action).toHaveBeenCalledOnce();
  expect(disabledAction).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Draft option')).toHaveValue('edited');
  expect(screen.getByText('Manage prompts')).toBeTruthy();
});
