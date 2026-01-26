import { EventEmitter } from 'events';
import type { OpenCodeMessage } from '@accomplish/shared';

export interface StreamParserEvents {
  message: [OpenCodeMessage];
  error: [Error];
}

// Maximum buffer size to prevent memory exhaustion (10MB)
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

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
      const message = JSON.parse(text) as OpenCodeMessage;

      // Log parsed message for debugging
      console.log('[StreamParser] Parsed message type:', message.type);

      // Enhanced logging for MCP/Playwriter-related messages
      if (message.type === 'tool_call' || message.type === 'tool_result') {
        const part = message.part as Record<string, unknown>;
        console.log('[StreamParser] Tool message details:', {
          type: message.type,
          tool: part?.tool,
          hasInput: !!part?.input,
          hasOutput: !!part?.output,
        });

        // Check if it's a dev-browser tool
        const toolName = String(part?.tool || '').toLowerCase();
        const output = String(part?.output || '').toLowerCase();
        if (toolName.includes('dev-browser') ||
            toolName.includes('browser') ||
            toolName.includes('mcp') ||
            output.includes('dev-browser') ||
            output.includes('browser')) {
          console.log('[StreamParser] >>> DEV-BROWSER MESSAGE <<<');
          console.log('[StreamParser] Full message:', JSON.stringify(message, null, 2));
        }
      }

      this.emit('message', message);
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (emitError) {
        this.emit('error', new Error(`Failed to parse JSON: ${error.message}`));
      }
      return { ok: false, error };
    }
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
