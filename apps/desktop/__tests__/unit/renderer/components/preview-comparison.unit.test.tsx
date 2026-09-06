// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PreviewComparison from '@/components/build/PreviewComparison';
afterEach(cleanup);
it('captures actual before and after images, retains them across closing, and switches comparison views', async () => {
  const capture = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600 });
  render(<PreviewComparison available capture={capture} />);
  fireEvent.click(screen.getByRole('button', { name: 'Before / after' }));
  fireEvent.click(screen.getByRole('button', { name: 'Capture before' }));
  await screen.findByAltText('before capture');
  fireEvent.click(screen.getByRole('button', { name: 'Capture after' }));
  await screen.findByLabelText('Before / after reveal');
  fireEvent.change(screen.getByRole('slider'), { target: { value: '75' } });
  expect(screen.getByAltText('Before capture')).toHaveStyle({ clipPath: 'inset(0 25% 0 0)' });
  fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
  expect(screen.getByAltText('after capture')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Before / after' }));
  expect(screen.getByAltText('after capture')).toBeInTheDocument();
  expect(capture).toHaveBeenCalledTimes(2);
});

it('reports failed captures without inventing a before image', async () => {
  render(<PreviewComparison available capture={vi.fn().mockRejectedValue(new Error('Preview unavailable'))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Before / after' }));
  fireEvent.click(screen.getByRole('button', { name: 'Capture before' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable');
  expect(screen.queryByAltText('before capture')).toBeNull();
});
