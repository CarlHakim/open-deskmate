import { EventEmitter } from 'events';
import type { OpenCodeMessage } from '@accomplish/shared';

export interface StreamParserEvents {
  message: [OpenCodeMessage];
  error: [Error];
}

// Maximum buffer size to prevent memory exhaustion (10MB)
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;
const VERBOSE_STREAM_PARSER = process.env.OPENDESKMATE_VERBOSE_STREAM === '1';
const EVENT_HINT_SCAN_CHARS = 256;
const NON_EVENT_CANDIDATE_GUARD_CHARS = 768;

/**
 * Parses NDJSON (newline-delimited JSON) stream from OpenCode CLI
 */
export class StreamParser extends EventEmitter<StreamParserEvents> {
  private currentJson: string = '';
  private depth = 0;
  private inString = false;
  private escape = false;
  private skippedCount = 0;

  /**
   * Feed raw data from stdout
   */
  feed(chunk: string): void {
    const sanitized = this.sanitizeChunk(chunk);
    this.consumeChunk(sanitized);
  }

  private sanitizeChunk(chunk: string): string {
    return chunk
      .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Consume a sanitized chunk of data, extracting JSON objects as they complete.
   */
  private consumeChunk(chunk: string): void {
    for (let i = 0; i < chunk.length; i += 1) {
      const char = chunk[i];

      if (this.depth === 0) {
        if (char === '{') {
          this.depth = 1;
          this.inString = false;
          this.escape = false;
          this.currentJson = '{';
          this.skippedCount = 0;
        } else {
          this.skippedCount += 1;
          if (this.skippedCount > MAX_BUFFER_SIZE) {
            this.emit('error', new Error('Stream buffer size exceeded maximum limit'));
            this.skippedCount = 0;
          }
        }
        continue;
      }

      if (this.inString) {
        if (this.escape) {
          this.escape = false;
          if (char === '\n' || char === '\r') {
            continue;
          }
          this.currentJson += char;
          continue;
        }

        if (char === '\\') {
          this.escape = true;
          this.currentJson += char;
          continue;
        }

        if (char === '"') {
          this.inString = false;
          this.currentJson += char;
          continue;
        }

        if (char === '\n' || char === '\r') {
          // Drop raw line breaks inserted by PTY wrapping inside strings.
          continue;
        }

        this.currentJson += char;
        continue;
      }

      if (char === '"') {
        this.inString = true;
        this.currentJson += char;
      } else if (char === '{') {
        this.depth += 1;
        this.currentJson += char;
      } else if (char === '}') {
        this.depth -= 1;
        this.currentJson += char;
        if (this.depth === 0) {
          this.finishJsonObject();
        }
      } else {
        this.currentJson += char;
      }

      if (this.currentJson.length > MAX_BUFFER_SIZE) {
        this.emit('error', new Error('Stream buffer size exceeded maximum limit'));
        this.resetState();
        continue;
      }

      // Guard: when PTY emits non-JSON log fragments with braces, we can latch onto
      // them and never reach a valid event boundary. Drop candidates that grow past
      // a threshold without looking like an OpenCode event payload.
      if (
        this.depth > 0 &&
        this.currentJson.length > NON_EVENT_CANDIDATE_GUARD_CHARS &&
        !this.isLikelyEventEnvelope(this.currentJson)
      ) {
        if (VERBOSE_STREAM_PARSER) {
          console.debug('[StreamParser] Dropping non-event brace candidate');
        }
        this.resetState();
      }
    }
  }

  private finishJsonObject(): void {
    const json = this.currentJson;
    this.resetState();
    this.tryParseJson(json, true);
  }

  private resetState(): void {
    this.currentJson = '';
    this.depth = 0;
    this.inString = false;
    this.escape = false;
  }

  private tryParseJson(text: string, emitError: boolean): { ok: boolean; error?: Error } {
    try {
      const parsed = JSON.parse(text) as unknown;

      // OpenCode NDJSON events always contain a top-level string `type`.
      // When --print-logs is enabled, OpenCode logs may include embedded JSON
      // snippets like `time={...}`. Our brace-depth scanner can pick those up,
      // but they are not OpenCodeMessage events. Ignore them silently.
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as any).type !== 'string') {
        return { ok: true };
      }

      const message = parsed as OpenCodeMessage;

      if (VERBOSE_STREAM_PARSER) {
        console.log('[StreamParser] Parsed message type:', message.type);
      }

      this.emit('message', message);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // Recovery path: PTY streams can interleave non-JSON text with JSON events.
      // Try extracting event-looking JSON objects from the corrupted payload.
      const recovered = this.tryRecoverCorruptedEventPayload(text);
      if (recovered) {
        return { ok: true };
      }

      // PTY output can contain non-event brace payloads (tool logs, snippets, etc.)
      // that are not OpenCode NDJSON events. Avoid noisy warnings unless the payload
      // looks like an actual OpenCode event envelope.
      if (emitError && this.isLikelyEventEnvelope(text)) {
        this.emit('error', new Error(`Failed to parse JSON: ${error.message}`));
      } else if (VERBOSE_STREAM_PARSER) {
        console.debug('[StreamParser] Ignoring non-event JSON parse failure');
      }
      return { ok: false, error };
    }
  }

  private isLikelyEventEnvelope(text: string): boolean {
    const head = text.slice(0, EVENT_HINT_SCAN_CHARS);
    // Typical OpenCode NDJSON starts with {"type":...}
    if (/^\s*\{\s*"type"\s*:/.test(head)) return true;
    // Also catch split/pretty-printed envelopes with type near the start.
    if (head.includes('"type"')) return true;
    return false;
  }

  private tryRecoverCorruptedEventPayload(text: string): boolean {
    if (!text || !text.includes('"type"')) return false;
    const starts = this.findTypeObjectStarts(text);
    for (const start of starts) {
      const extracted = this.extractBalancedObject(text, start);
      if (!extracted) continue;
      try {
        const parsed = JSON.parse(extracted) as unknown;
        if (!parsed || typeof parsed !== 'object' || typeof (parsed as any).type !== 'string') {
          continue;
        }
        const message = parsed as OpenCodeMessage;
        if (VERBOSE_STREAM_PARSER) {
          console.log('[StreamParser] Recovered message type:', message.type);
        }
        this.emit('message', message);
        return true;
      } catch {
        // keep trying other candidates
      }
    }
    return false;
  }

  private findTypeObjectStarts(text: string): number[] {
    const starts: number[] = [];
    const re = /\{\s*"type"\s*:/g;
    let match: RegExpExecArray | null = null;
    while ((match = re.exec(text)) !== null) {
      starts.push(match.index);
      if (starts.length >= 8) break; // bounded recovery work
    }
    return starts;
  }

  private extractBalancedObject(text: string, start: number): string | null {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  /**
   * Flush any remaining buffer content
   */
  flush(): void {
    if (this.currentJson.trim()) {
      const result = this.tryParseJson(this.currentJson, false);
      if (!result.ok) {
        this.tryParseJson(this.currentJson, true);
      }
    }
    this.resetState();
    this.skippedCount = 0;
  }

  /**
   * Reset the parser
   */
  reset(): void {
    this.resetState();
    this.skippedCount = 0;
  }
}
