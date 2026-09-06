// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { FocusSceneButton, FocusSceneLifecycle, focusSceneBackground } from '@/components/chat/FocusScene';
import { useFocusSceneStore } from '@/stores/focusSceneStore';

function View() {
  const navigate = useNavigate();
  return <><FocusSceneLifecycle /><FocusSceneButton />
    <button onClick={() => navigate('/build?sessionId=next')}>Change task</button>
    <textarea aria-label="Draft" defaultValue="Keep my draft" />
  </>;
}
beforeEach(() => useFocusSceneStore.getState().exit());
afterEach(cleanup);

it('toggles the temporary scene and exits with Escape without remounting the draft', () => {
  render(<MemoryRouter initialEntries={['/execution/test']}><View /></MemoryRouter>);
  const draft = screen.getByLabelText('Draft');
  fireEvent.change(draft, { target: { value: 'Typed work' } });
  fireEvent.click(screen.getByRole('button', { name: 'Focus', exact: true }));
  expect(screen.getByRole('button', { name: 'Exit Focus' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Exit Focus' }), { key: 'Escape' });
  expect(useFocusSceneStore.getState().active).toBe(false);
  expect(screen.getByLabelText('Draft')).toBe(draft);
  expect(draft).toHaveValue('Typed work');
});

it('leaves dialog and menu dismissal to the overlay', () => {
  render(<MemoryRouter initialEntries={['/build']}><View /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Focus', exact: true }));
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(useFocusSceneStore.getState().active).toBe(true);
  dialog.remove();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useFocusSceneStore.getState().active).toBe(false);
});

it('restores the normal view when changing task or mode', () => {
  render(<MemoryRouter initialEntries={['/build?sessionId=first']}><View /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Focus', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Change task' }));
  expect(useFocusSceneStore.getState().active).toBe(false);
});

it('limits the control to Chat conversations and Build and uses the chosen background', () => {
  render(<MemoryRouter initialEntries={['/help']}><View /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'Focus', exact: true })).toBeNull();
  expect(focusSceneBackground('chosen.jpg').backgroundImage).toContain('chosen.jpg');
  expect(focusSceneBackground('chosen.jpg').backgroundImage).toContain('0.78');
});
