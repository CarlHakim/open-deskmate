import { describe, expect, test, vi } from 'vitest';
import type { OpenCodeMessage, TaskResult } from '@accomplish/shared';
import {
  initAgenticRunSignal,
  recordAgenticRunSignal,
  runAgenticLoop,
} from '../../../../src/main/runtime/task-agentic-loop';

const successResult: TaskResult = { status: 'success', sessionId: 'session-1' };

function toolResultMessage(isError = false): OpenCodeMessage {
  return {
    type: 'tool_result',
    timestamp: 1,
    part: {
      id: 'tool-result-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'tool-result',
      toolCallID: 'call-1',
      output: isError ? 'failed' : 'ok',
      isError,
      time: { start: 1, end: 2 },
    },
  };
}

function textMessage(text: string): OpenCodeMessage {
  return {
    type: 'text',
    timestamp: 2,
    part: {
      id: 'text-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'text',
      text,
    },
  };
}

function stepFinishMessage(reason: 'end_turn' | 'stop' | 'tool_use' | 'tool-calls' | 'error'): OpenCodeMessage {
  return {
    type: 'step_finish',
    timestamp: 3,
    part: {
      id: 'step-finish-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'step-finish',
      reason,
    },
  };
}

function runLoop(taskId: string, resumeSession = vi.fn()) {
  return runAgenticLoop({
    taskId,
    agentId: 'agent-1',
    sessionIdHint: 'session-1',
    completion: Promise.resolve(successResult),
    agent: {
      agenticLoopEnabled: true,
      agenticLoopMaxIterations: 2,
      agenticLoopTimeoutMs: 30_000,
    },
    resolveSessionId: () => 'session-1',
    resumeSession,
    isTaskActive: () => false,
    interruptTask: () => Promise.resolve(),
  });
}

describe('runAgenticLoop', () => {
  test('does not continue after tool use when the assistant already answered', async () => {
    const taskId = 'task-agentic-tool-answer';
    const resumeSession = vi.fn();
    initAgenticRunSignal(taskId);
    recordAgenticRunSignal(taskId, toolResultMessage(false));
    recordAgenticRunSignal(taskId, textMessage('I checked the runtime and fixed the issue.'));
    recordAgenticRunSignal(taskId, stepFinishMessage('end_turn'));

    await expect(runLoop(taskId, resumeSession)).resolves.toEqual(successResult);
    expect(resumeSession).not.toHaveBeenCalled();
  });

  test('continues when the assistant explicitly asks for another loop iteration', async () => {
    const taskId = 'task-agentic-explicit-continue';
    const resumeSession = vi.fn().mockResolvedValue({ completion: Promise.resolve(successResult) });
    initAgenticRunSignal(taskId);
    recordAgenticRunSignal(taskId, toolResultMessage(false));
    recordAgenticRunSignal(taskId, textMessage('More work remains.\nLOOP_STATUS: CONTINUE'));
    recordAgenticRunSignal(taskId, stepFinishMessage('end_turn'));

    await expect(runLoop(taskId, resumeSession)).resolves.toEqual(successResult);
    expect(resumeSession).toHaveBeenCalledTimes(1);
  });
});
