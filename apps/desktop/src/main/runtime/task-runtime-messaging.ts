import { BrowserWindow } from 'electron';
import type { OpenCodeMessage, TaskActivityEvent, TaskMessage } from '@accomplish/shared';
import { addTaskActivity, addTaskMessage } from '../store/taskHistory';
import { buildAssistantContentWithReasoning } from './task-message-reasoning';

export function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function extractScreenshots(output: string): {
  cleanedText: string;
  attachments: Array<{ type: 'screenshot' | 'json'; data: string; label?: string }>;
} {
  const attachments: Array<{ type: 'screenshot' | 'json'; data: string; label?: string }> = [];

  const dataUrlRegex = /data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+/g;
  let match;
  while ((match = dataUrlRegex.exec(output)) !== null) {
    attachments.push({
      type: 'screenshot',
      data: match[0],
      label: 'Browser screenshot',
    });
  }

  const rawBase64Regex = /(?<![;,])(?:^|["\s])?(iVBORw0[A-Za-z0-9+/=]{100,})(?:["\s]|$)/g;
  while ((match = rawBase64Regex.exec(output)) !== null) {
    const base64Data = match[1];
    if (base64Data && base64Data.length > 100) {
      attachments.push({
        type: 'screenshot',
        data: `data:image/png;base64,${base64Data}`,
        label: 'Browser screenshot',
      });
    }
  }

  const cleanedText = output
    .replace(dataUrlRegex, '[Screenshot captured]')
    .replace(rawBase64Regex, '[Screenshot captured]');

  return { cleanedText, attachments };
}

function sanitizeToolOutput(text: string, isError: boolean): string {
  let result = text;

  if (isError) {
    const timeoutMatch = result.match(/timed? ?out after (\d+)ms/i);
    if (timeoutMatch) {
      const seconds = Math.round(parseInt(timeoutMatch[1]) / 1000);
      return `Timed out after ${seconds}s`;
    }

    const protocolMatch = result.match(/Protocol error \([^)]+\):\s*(.+)/i);
    if (protocolMatch) {
      result = protocolMatch[1].trim();
    }

    result = result.replace(/^Error executing code:\s*/i, '');
    result = result.replace(/browserType\.connectOverCDP:\s*/i, '');
    result = result.replace(/\s+at\s+.+/g, '');
    result = result.replace(/\w+Error:\s*/g, '');
  }

  return result.trim();
}

function extractAssistantFromToolOutput(toolName: string, toolOutput: string): string | null {
  if (toolName.toLowerCase() !== 'bash') {
    return null;
  }

  const trimmed = toolOutput.trim();
  if (!trimmed) {
    return null;
  }

  const pageTitleMatch = trimmed.match(/(?:RESULT_TITLE|PAGE_TITLE|TITLE):\s*([^\r\n]+)/i);
  if (pageTitleMatch) {
    return `Page title: ${pageTitleMatch[1].trim()}`;
  }

  const jsonMatch = trimmed.match(/\{[^\r\n]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { title?: unknown; url?: unknown };
      if (typeof parsed.title === 'string' && parsed.title.trim()) {
        const title = parsed.title.trim();
        const url = typeof parsed.url === 'string' ? parsed.url.trim() : '';
        return url ? `Page title: ${title}\nURL: ${url}` : `Page title: ${title}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function toTaskMessage(message: OpenCodeMessage): TaskMessage | null {
  if (message.type === 'text') {
    const content = buildAssistantContentWithReasoning(message, message.part.text);
    if (content) {
      return {
        id: createMessageId(),
        type: 'assistant',
        content,
        timestamp: new Date().toISOString(),
      };
    }
    return null;
  }

  if (message.type === 'tool_call') {
    return {
      id: createMessageId(),
      type: 'tool',
      content: `Using tool: ${message.part.tool}`,
      toolName: message.part.tool,
      toolInput: message.part.input,
      timestamp: new Date().toISOString(),
    };
  }

  if (message.type === 'tool_result') {
    const toolResultMsg = message as import('@accomplish/shared').OpenCodeToolResultMessage;
    const toolOutput = toolResultMsg.part.output || '';
    const isError = Boolean(toolResultMsg.part.isError);
    const { cleanedText, attachments } = extractScreenshots(toolOutput);
    const sanitizedText = sanitizeToolOutput(cleanedText, isError);

    return {
      id: createMessageId(),
      type: 'tool',
      content: sanitizedText || 'Tool result',
      toolName: 'tool_result',
      timestamp: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  if (message.type === 'tool_use') {
    const toolUseMsg = message as import('@accomplish/shared').OpenCodeToolUseMessage;
    const toolName = toolUseMsg.part.tool || 'unknown';
    const toolInput = toolUseMsg.part.state?.input;
    const toolOutput = toolUseMsg.part.state?.output || '';
    const status = toolUseMsg.part.state?.status;

    if (status === 'completed' || status === 'error') {
      const { cleanedText, attachments } = extractScreenshots(toolOutput);

      if (status === 'completed') {
        const assistantContent = extractAssistantFromToolOutput(toolName, cleanedText);
        if (assistantContent) {
          return {
            id: createMessageId(),
            type: 'assistant',
            content: assistantContent,
            timestamp: new Date().toISOString(),
            attachments: attachments.length > 0 ? attachments : undefined,
          };
        }
      }

      const isError = status === 'error';
      const sanitizedText = sanitizeToolOutput(cleanedText, isError);

      return {
        id: createMessageId(),
        type: 'tool',
        content: sanitizedText || `Tool ${toolName} ${status}`,
        toolName,
        toolInput,
        timestamp: new Date().toISOString(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    }
    return null;
  }

  const fallbackText = (message as { part?: { text?: unknown }; text?: unknown; content?: unknown }).part?.text
    ?? (message as { text?: unknown }).text
    ?? (message as { content?: unknown }).content;
  const fallbackContent = buildAssistantContentWithReasoning(
    message,
    typeof fallbackText === 'string' ? fallbackText : undefined
  );
  if (fallbackContent) {
    return {
      id: createMessageId(),
      type: 'assistant',
      content: fallbackContent,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

export function forwardToAllRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

export function emitTaskActivityEvent(activity: TaskActivityEvent): void {
  addTaskActivity(activity.taskId, activity);
  forwardToAllRenderers('task:activity', activity);
}

export function emitSystemTaskMessage(taskId: string, content: string): void {
  const trimmed = String(content || '').trim();
  if (!trimmed) return;
  const message: TaskMessage = {
    id: createMessageId(),
    type: 'system',
    content: trimmed,
    timestamp: new Date().toISOString(),
  };
  addTaskMessage(taskId, message);
  forwardToAllRenderers('task:update', {
    taskId,
    type: 'message',
    message,
  });
}

export function injectTaskMessage(
  taskId: string,
  message: TaskMessage,
  options?: { skipSessionLog?: boolean; sessionLogContent?: string }
): void {
  addTaskMessage(taskId, message, options);
  forwardToAllRenderers('task:update', {
    taskId,
    type: 'message',
    message,
  });
}
