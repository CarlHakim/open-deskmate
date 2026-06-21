import { describe, expect, test } from 'vitest';
import {
  BUILD_AI_TESTS_INSTRUCTION,
  buildAiTestsInstruction,
} from '@/lib/build-ai-tests-instruction';

describe('build AI tests instruction', () => {
  test('does not inject anything when switched off', () => {
    expect(buildAiTestsInstruction(false)).toBeNull();
  });

  test('injects the exact configured instruction when switched on', () => {
    expect(buildAiTestsInstruction(true)).toBe(BUILD_AI_TESTS_INSTRUCTION);
    expect(buildAiTestsInstruction(true)).toBe(
      'If this task changes code, add or update automated tests covering the behavior, run the relevant checks, and keep fixing issues until they pass. If the project has no test setup and tests are appropriate for this codebase, add a lightweight setup and package scripts first. For non-code tasks, do not create a test framework.'
    );
  });
});

