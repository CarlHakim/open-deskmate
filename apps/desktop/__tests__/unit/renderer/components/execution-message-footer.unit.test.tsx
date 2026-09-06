// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Virtuoso, VirtuosoMockContext } from 'react-virtuoso';
import { getAgentToolPresence } from '../../../../src/renderer/components/chat/AgentToolStateIndicator';
import { executionMessageComponents, type ExecutionMessageContext } from '../../../../src/renderer/components/chat/ExecutionMessageFooter';

// Avatar image imports need Vite's asset pipeline; keep the real list and indicator.
vi.mock('@/components/layout/AgentAvatarPicker', () => ({ AgentAvatarIcon: () => <span /> }));
vi.mock('@/lib/agent-character-gallery', () => ({ isAgentCharacterAvatar: () => false }));

afterEach(cleanup);

function Conversation({ tool = null, running = true, messages = ['Prompt'] }: {
  tool?: string | null;
  running?: boolean;
  messages?: string[];
}) {
  const context: ExecutionMessageContext = {
    showThinking: running,
    indicator: {
      presence: getAgentToolPresence(tool, null),
      testId: 'thinking',
    },
  };
  return (
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 40 }}>
      <Virtuoso
        data={messages}
        itemContent={(_index, message) => <div>{message}</div>}
        components={executionMessageComponents}
        context={context}
      />
    </VirtuosoMockContext.Provider>
  );
}

it('updates action states and streamed messages without remounting the thinking box', async () => {
  const { rerender } = render(<Conversation />);
  const indicator = await screen.findByTestId('thinking');
  const animatedContainer = indicator.parentElement;
  for (const tool of ['Read', 'Bash', null, 'Write', 'WebSearch']) {
    rerender(<Conversation tool={tool} messages={['Prompt', `Stream update: ${tool}`]} />);
    await waitFor(() => expect(screen.getByTestId('thinking')).toHaveTextContent(getAgentToolPresence(tool, null).label));
    expect(screen.getByTestId('thinking')).toBe(indicator);
    expect(indicator.parentElement).toBe(animatedContainer);
  }
  rerender(<Conversation running={false} />);
  await waitFor(() => expect(screen.queryByTestId('thinking')).toBeNull());
});
