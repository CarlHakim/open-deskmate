

export const MAX_TEXT_LENGTH = 8000;

export const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function sanitizeString(input: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return trimmed;
}

export function sanitizeProviderId(input: unknown, field = 'provider'): string {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const provider = input.trim().toLowerCase();
  if (!PROVIDER_ID_RE.test(provider)) {
    throw new Error(`${field} is invalid`);
  }
  return provider;
}



export function sanitizeOptionalText(input: unknown, field: string, maxLength: number): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  if (input.length > maxLength) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return input;
}
