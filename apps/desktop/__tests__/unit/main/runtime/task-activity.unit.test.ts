import { describe, expect, test } from 'vitest';
import {
  createInitialTaskActivityTrackerState,
  markAssistantSeen,
  markToolFinished,
  markToolStarted,
  shouldDetectTaskStall,
} from '../../../../src/main/runtime/task-activity';

describe('task activity stall detector', () => {
  test('tool result followed by final answer does not stall', () => {
    let state = createInitialTaskActivityTrackerState();
    state = markToolFinished(state, 1000);
    state = markAssistantSeen(state, 1200);
    expect(shouldDetectTaskStall(state)).toBe(false);
  });

  test('tool result followed by no final answer creates a stall condition', () => {
    const state = markToolFinished(createInitialTaskActivityTrackerState(), 1000);
    expect(shouldDetectTaskStall(state)).toBe(true);
  });

  test('permission waiting does not trigger a false stall', () => {
    const state = {
      ...markToolFinished(createInitialTaskActivityTrackerState(), 1000),
      waitingForPermission: true,
    };
    expect(shouldDetectTaskStall(state)).toBe(false);
  });

  test('completed task with no final answer is recoverable', () => {
    const state = markToolFinished(createInitialTaskActivityTrackerState(), 1000);
    expect(shouldDetectTaskStall(state)).toBe(true);
  });

  test('substantial standalone tool output does not trigger missing-answer recovery', () => {
    const state = markToolFinished(createInitialTaskActivityTrackerState(), 1000, true);
    expect(shouldDetectTaskStall(state)).toBe(false);
  });

  test('later tool attempt suppresses stale missing-answer recovery', () => {
    let state = createInitialTaskActivityTrackerState();
    state = markToolFinished(state, 1000);
    state = markToolStarted(state, 1200);
    expect(shouldDetectTaskStall(state)).toBe(false);
  });

  test('new failed attempt becomes the current stall candidate', () => {
    let state = createInitialTaskActivityTrackerState();
    state = markToolFinished(state, 1000);
    state = markToolStarted(state, 1200);
    state = markToolFinished(state, 1400);
    expect(shouldDetectTaskStall(state)).toBe(true);
  });
});
