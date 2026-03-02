function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Build a valid OpenAI-compatible chat completions endpoint from either:
 * - host-only base URL: https://api.example.com
 * - versioned base URL: https://api.example.com/v1
 * - full endpoint: https://api.example.com/v1/chat/completions
 */
export function buildOpenAICompatibleChatCompletionsUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlash(String(baseUrl || '').trim());
  if (!trimmed) {
    throw new Error('Provider base URL is empty');
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = trimTrailingSlash(parsed.pathname || '');

    if (/\/chat\/completions$/i.test(pathname)) {
      return parsed.toString();
    }

    if (/\/v1$/i.test(pathname)) {
      parsed.pathname = `${pathname}/chat/completions`;
      return parsed.toString();
    }

    parsed.pathname = `${pathname}/v1/chat/completions`;
    return parsed.toString();
  } catch {
    // Non-URL fallback keeps behavior stable for unusual but valid fetch targets.
    if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
    if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
    return `${trimmed}/v1/chat/completions`;
  }
}

