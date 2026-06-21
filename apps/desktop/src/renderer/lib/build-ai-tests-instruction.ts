export const BUILD_AI_TESTS_INSTRUCTION = 'If this task changes code, add or update automated tests covering the behavior, run the relevant checks, and keep fixing issues until they pass. If the project has no test setup and tests are appropriate for this codebase, add a lightweight setup and package scripts first. For non-code tasks, do not create a test framework.';

export function buildAiTestsInstruction(enabled: boolean): string | null {
  return enabled ? BUILD_AI_TESTS_INSTRUCTION : null;
}

