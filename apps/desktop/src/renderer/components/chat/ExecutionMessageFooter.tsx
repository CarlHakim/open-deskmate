import { AnimatePresence, motion } from 'framer-motion';
import type { ComponentProps } from 'react';
import type { ContextProp } from 'react-virtuoso';
import { springs } from '@/lib/animations';
import AgentToolStateIndicator from './AgentToolStateIndicator';

export type ExecutionMessageContext = {
  showThinking: boolean;
  indicator: ComponentProps<typeof AgentToolStateIndicator>;
};

function ExecutionMessageFooter({ context }: ContextProp<ExecutionMessageContext>) {
  return (
    <div className="px-6 pb-6 pt-2">
      <AnimatePresence>
        {context?.showThinking ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springs.gentle}
          >
            <AgentToolStateIndicator {...context.indicator} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// Virtuoso treats Footer as a component type. Keep it stable while its context updates,
// otherwise every streamed update remounts the indicator and replays its entrance.
export const executionMessageComponents = { Footer: ExecutionMessageFooter };
