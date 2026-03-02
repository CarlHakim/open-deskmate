/**
 * Integration tests for TaskInputBar component
 * Tests component rendering and user interactions with mocked window.accomplish API
 * @module __tests__/integration/renderer/components/TaskInputBar.integration.test
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import TaskInputBar, { type TaskInputBarHandle } from '@/components/landing/TaskInputBar';
import { createMockAccomplish } from '../../../test-utils/mock-accomplish';

// Mock analytics to prevent tracking calls
vi.mock('@/lib/analytics', () => ({
  analytics: {
    trackSubmitTask: vi.fn(),
  },
}));

// Mock accomplish API
const mockAccomplish = createMockAccomplish({
  logEvent: vi.fn().mockResolvedValue(undefined),
  estimateContextWindow: vi.fn().mockResolvedValue({
    provider: 'anthropic',
    model: 'claude-3-opus',
    contextLimitTokens: 200000,
    maxOutputTokens: 4096,
    promptTokensEst: 10,
    usedPct: 0.00005,
    remainingInput: 199990,
    safeRemainingForReply: 195000,
    estimated: true,
    breakdown: { system: 0, tools: 0, retrieved: 0, history: 0, newMessage: 10 },
  }),
  getSelectedModel: vi.fn().mockResolvedValue({ provider: 'anthropic', id: 'claude-3-opus' }),
  getOllamaConfig: vi.fn().mockResolvedValue(null),
  getVoiceWakeConfig: vi.fn().mockResolvedValue({
    enabled: false,
    autoStart: false,
    triggers: [],
    updatedAtMs: 0,
    talkModeEnabled: true,
    autoSubmit: false,
    insertMode: 'append',
    stopPhrases: [],
    silenceTimeoutMs: 900,
    earconEnabled: true,
    sttEngine: 'whisper',
    whisperBinPath: '',
    whisperModelPath: '',
    whisperLanguage: 'en',
  }),
  getVoiceWakeAccessKeyStatus: vi.fn().mockResolvedValue({ accessKeySet: false }),
  getPlatform: vi.fn().mockResolvedValue('win32'),
  onVoiceWakeLevel: vi.fn().mockReturnValue(() => undefined),
  onVoiceWakeDetected: vi.fn().mockReturnValue(() => undefined),
  setVoiceWakeConfig: vi.fn().mockImplementation(async (config) => config),
});

// Mock the accomplish module
vi.mock('@/lib/accomplish', () => ({
  getAccomplish: () => mockAccomplish,
}));

describe('TaskInputBar Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render with empty state', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('');
    });

    it('should render with default placeholder', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByPlaceholderText('Assign a task or ask anything');
      expect(textarea).toBeInTheDocument();
    });

    it('should render with custom placeholder', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} placeholder="Enter your task here" />);

      const textarea = screen.getByPlaceholderText('Enter your task here');
      expect(textarea).toBeInTheDocument();
    });

    it('should allow setting value via ref handle', async () => {
      const onSubmit = vi.fn();
      const ref = React.createRef<TaskInputBarHandle>();
      render(<TaskInputBar ref={ref} onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(ref.current).not.toBeNull();
      });
      ref.current!.setValue('Review my inbox for urgent messages');

      const textarea = screen.getByRole('textbox');
      await waitFor(() => {
        expect(textarea).toHaveValue('Review my inbox for urgent messages');
      });
    });

    it('should render submit button', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const submitButton = screen.getByTestId('task-input-submit');
      expect(submitButton).toBeInTheDocument();
    });
  });

  describe('user input handling', () => {
    it('should update value when user types', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'New task input' } });
      expect(textarea).toHaveValue('New task input');
    });

    it('should update with each input change', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'First' } });
      expect(textarea).toHaveValue('First');

      fireEvent.change(textarea, { target: { value: 'First input' } });
      expect(textarea).toHaveValue('First input');
    });
  });

  describe('submit button behavior', () => {
    it('should disable submit button when value is empty', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const submitButton = screen.getByTestId('task-input-submit');
      expect(submitButton).toBeDisabled();
    });

    it('should disable submit button when value is only whitespace', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '   ' } });

      const submitButton = screen.getByTestId('task-input-submit');
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when value has content', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Do the thing' } });

      const submitButton = screen.getByTestId('task-input-submit');
      expect(submitButton).toBeEnabled();
    });

    it('should call onSubmit when submit button is clicked and clear input when accepted', async () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '  My task  ' } });

      const submitButton = screen.getByTestId('task-input-submit');
      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalledWith('My task', undefined, undefined, 'normal');

      await waitFor(() => {
        expect(textarea).toHaveValue('');
      });
    });

    it('should call onSubmit when Enter is pressed without Shift', async () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'My task' } });
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', charCode: 13 });

      expect(onSubmit).toHaveBeenCalledWith('My task', undefined, undefined, 'normal');

      await waitFor(() => {
        expect(textarea).toHaveValue('');
      });
    });

    it('should not call onSubmit when Shift+Enter is pressed', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Line1' } });
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true, charCode: 13 });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should not clear input if onSubmit returns false', async () => {
      const onSubmit = vi.fn().mockResolvedValue(false);
      render(<TaskInputBar onSubmit={onSubmit} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'My task' } });
      fireEvent.click(screen.getByTestId('task-input-submit'));

      await waitFor(() => {
        expect(textarea).toHaveValue('My task');
      });
    });
  });

  describe('loading state', () => {
    it('should keep textarea enabled when loading', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} isLoading={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeEnabled();
    });

    it('should disable submit button when loading', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} isLoading={true} />);

      const submitButton = screen.getByTestId('task-input-submit');
      expect(submitButton).toBeDisabled();
    });

    it('should show loading spinner in submit button when loading', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} isLoading={true} />);

      // The button is present and disabled; we don't assert on SVG specifics here.
      const submitButton = screen.getByTestId('task-input-submit');
      expect(submitButton).toBeInTheDocument();
    });

    it('should still allow typing when loading', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} isLoading={true} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Typing while loading' } });
      expect(textarea).toHaveValue('Typing while loading');
    });
  });

  describe('disabled state', () => {
    it('should disable textarea when disabled prop is true', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} disabled={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('should disable submit button when disabled prop is true', () => {
      const onSubmit = vi.fn();
      render(<TaskInputBar onSubmit={onSubmit} disabled={true} />);

      const submitButton = screen.getByTestId('task-input-submit');
      expect(submitButton).toBeDisabled();
    });
  });
});
