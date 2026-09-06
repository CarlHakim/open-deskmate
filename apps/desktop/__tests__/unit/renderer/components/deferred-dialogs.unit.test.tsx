// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeferredSettingsDialog } from '../../../../src/renderer/components/layout/DeferredDialogs';

vi.mock('../../../../src/renderer/components/layout/SettingsDialog', () => ({
  default: ({ open }: { open: boolean }) => <input aria-label="Draft setting" hidden={!open} defaultValue="initial" />,
}));

afterEach(cleanup);

it('mounts settings only on demand and retains edits across closing and reopening', async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(<DeferredSettingsDialog open={false} onOpenChange={onOpenChange} />);
  expect(screen.queryByLabelText('Draft setting')).toBeNull();
  rerender(<DeferredSettingsDialog open onOpenChange={onOpenChange} />);
  const input = await screen.findByLabelText('Draft setting');
  fireEvent.change(input, { target: { value: 'edited' } });
  rerender(<DeferredSettingsDialog open={false} onOpenChange={onOpenChange} />);
  rerender(<DeferredSettingsDialog open onOpenChange={onOpenChange} />);
  expect(screen.getByLabelText('Draft setting')).toHaveValue('edited');
});
