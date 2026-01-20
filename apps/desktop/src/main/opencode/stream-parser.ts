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
  private buffer: string = '';
  private pendingJson: string | null = null;

  /**
   * Feed raw data from stdout
   */
  feed(chunk: string): void {
    this.buffer += chunk;

    // Prevent memory exhaustion from unbounded buffer growth
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.emit('error', new Error('Stream buffer size exceeded maximum limit'));
      // Keep the last portion of the buffer to maintain parsing continuity
      this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE / 2);
    }

    this.parseBuffer();
  }

  /**
   * Parse complete lines from the buffer
   */
  private parseBuffer(): void {
    const lines = this.buffer.split('\n');

    // Keep incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        this.parseLine(line);
      }
    }

    // If the buffer already contains complete JSON objects without a trailing newline,
    // parse them now to avoid losing messages on fast shutdown.
    if (!this.pendingJson) {
      const trimmed = this.buffer.trim();
      if (trimmed.startsWith('{')) {
        const { objects, remainder } = this.extractJsonObjects(this.buffer);
        if (objects.length > 0 && remainder !== this.buffer) {
          for (const obj of objects) {
            this.tryParseJson(obj);
          }
          this.buffer = remainder;
        }
      }
    }
  }

  private sanitizeLine(line: string): string {
    return line
      .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Check if a line is terminal UI decoration (not JSON)
   * These are outputted by the CLI's interactive prompts
   */
  private isTerminalDecoration(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.includes('{')) {
      return false;
    }
    // Box-drawing and UI characters used by the CLI's interactive prompts
    const terminalChars = ['│', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼', '─', '◆', '●', '○', '◇'];
    // Check if line starts with a terminal decoration character
    if (terminalChars.some(char => trimmed.startsWith(char))) {
      return true;
    }
    // Also skip ANSI escape sequences and other control characters
    if (/^[\x00-\x1F\x7F]/.test(trimmed) || /^\x1b\[/.test(trimmed)) {
      return true;
    }
    return false;
  }

  /**
   * Parse a single JSON line
   */
  private parseLine(line: string): void {
    const sanitized = this.sanitizeLine(line);
    const trimmed = sanitized.trim();

    // Skip empty lines
    if (!trimmed) return;

    if (this.pendingJson) {
      const combined = this.pendingJson + sanitized;
      this.pendingJson = null;

      const { objects, remainder } = this.extractJsonObjects(combined);
      if (objects.length > 0) {
        for (const obj of objects) {
          this.tryParseJson(obj);
        }
      }

      if (remainder) {
        this.pendingJson = remainder;
        this.tryParsePendingJson();
      } else if (objects.length === 0) {
        // Still incomplete; keep buffering until we can parse.
        this.pendingJson = combined;
        this.tryParsePendingJson();
      }

      if (this.pendingJson && this.pendingJson.length > MAX_BUFFER_SIZE / 2) {
        this.emit('error', new Error('Pending JSON buffer size exceeded limit'));
        this.pendingJson = null;
      }
      return;
    }

    // Skip terminal UI decorations (interactive prompts, box-drawing chars)
    if (this.isTerminalDecoration(trimmed)) {
      return;
    }

    // Only attempt to parse lines that look like JSON (start with {)
    let candidate = trimmed;
    if (!candidate.startsWith('{')) {
      const jsonStart = candidate.indexOf('{');
      if (jsonStart !== -1) {
        candidate = candidate.slice(jsonStart);
      } else {
        // Log non-JSON lines for debugging but don't emit errors
        // These could be CLI status messages, etc.
        console.log('[StreamParser] Skipping non-JSON line:', candidate.substring(0, 50));
        return;
      }
    }

    const { objects, remainder } = this.extractJsonObjects(candidate);
    if (objects.length > 0) {
      for (const obj of objects) {
        this.tryParseJson(obj);
      }
    }

    if (remainder) {
      this.pendingJson = remainder;
      this.tryParsePendingJson();
    } else if (objects.length === 0 && !this.tryParseJson(trimmed)) {
      this.pendingJson = trimmed;
      this.tryParsePendingJson();
    }
  }

  private tryParsePendingJson(): boolean {
    if (!this.pendingJson) return false;
    const candidate = this.pendingJson.trim();
    if (!candidate.startsWith('{')) {
      this.pendingJson = null;
      return false;
    }
    if (this.tryParseJson(candidate)) {
      this.pendingJson = null;
      return true;
    }
    return false;
  }

  private extractJsonObjects(text: string): { objects: string[]; remainder: string } {
    const objects: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\' && inString) {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === '{') {
        if (depth === 0) {
          start = i;
        }
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          objects.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }

    const remainder = start !== -1 ? text.slice(start) : '';
    return { objects, remainder };
  }

  private tryParseJson(text: string): boolean {
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
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Flush any remaining buffer content
   */
  flush(): void {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer);
    }
    if (this.pendingJson) {
      this.tryParsePendingJson();
    }
    this.buffer = '';
  }

  /**
   * Reset the parser
   */
  reset(): void {
    this.buffer = '';
    this.pendingJson = null;
  }
}
