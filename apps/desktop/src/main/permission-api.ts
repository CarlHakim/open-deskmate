/**
 * Permission API Server
 *
 * HTTP server that the file-permission MCP server calls to request
 * user permission for file operations. This bridges the MCP server
 * (separate process) with the Electron UI.
 */

import http from 'http';
import fs from 'fs';
import { BrowserWindow } from 'electron';
import type { PermissionRequest, FileOperation } from '@accomplish/shared';
import { enqueueWebPermissionRequest } from './services/webhook-permissions';
import path from 'path';
import { getWorkspaceRoot } from './store/appSettings';
import { getTask } from './store/taskHistory';
import {
  createPermissionPolicyAuditEntry,
  evaluateFilePermissionPolicy,
} from './permissions/policy-engine';
import { recordPermissionPolicyAuditEntry } from './permissions/policy-store';

export const PERMISSION_API_PORT = 9226;

interface PendingPermission {
  resolve: (allowed: boolean) => void;
  timeoutId: NodeJS.Timeout;
}

// Store pending permission requests waiting for user response
const pendingPermissions = new Map<string, PendingPermission>();
const filePermissionMeta = new Map<string, { taskId: string; filePath: string; targetPath?: string }>();
const pendingPermissionRequests = new Map<string, PermissionRequest>();

type TaskFilePermissionPolicy = {
  /** When enabled, the app auto-approves all file operations for this task. */
  allowAllForTask: boolean;
};

const taskFilePolicies = new Map<string, TaskFilePermissionPolicy>();

// Store reference to main window and task manager
let mainWindow: BrowserWindow | null = null;
let resolveTaskIdForPermission: ((requestedTaskId?: string) => string | null) | null = null;
let resolveTaskWorkspaceRootForPermission: ((taskId: string) => string | null) | null = null;

type PermissionApiInitOptions = {
  resolveTaskId: (requestedTaskId?: string) => string | null;
  resolveTaskWorkspaceRoot?: (taskId: string) => string | null;
};

/**
 * Initialize the permission API with dependencies
 */
export function initPermissionApi(
  window: BrowserWindow,
  taskIdResolver: ((requestedTaskId?: string) => string | null) | PermissionApiInitOptions
): void {
  mainWindow = window;
  if (typeof taskIdResolver === 'function') {
    resolveTaskIdForPermission = taskIdResolver;
    resolveTaskWorkspaceRootForPermission = null;
    return;
  }
  resolveTaskIdForPermission = taskIdResolver.resolveTaskId;
  resolveTaskWorkspaceRootForPermission = taskIdResolver.resolveTaskWorkspaceRoot ?? null;
}

/**
 * Resolve a pending permission request from the MCP server
 * Called when user responds via the UI
 */
export function resolvePermission(requestId: string, allowed: boolean): boolean {
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeoutId);
  pending.resolve(allowed);
  pendingPermissions.delete(requestId);
  filePermissionMeta.delete(requestId);
  pendingPermissionRequests.delete(requestId);
  return true;
}

export function listPendingPermissionRequests(taskId?: string): PermissionRequest[] {
  const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
  return Array.from(pendingPermissionRequests.values())
    .filter((request) => !normalizedTaskId || request.taskId === normalizedTaskId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function normalizePathForCompare(p: string): string {
  // Resolve removes .. and normalizes slashes. Best effort: use realpath for existing files.
  const resolved = path.resolve(p);
  let canonical = resolved;
  try {
    canonical = fs.realpathSync.native(resolved);
  } catch {
    canonical = resolved;
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function isSubPath(candidatePath: string, parentDir: string): boolean {
  const cand = normalizePathForCompare(candidatePath);
  const parent = normalizePathForCompare(parentDir);
  const rel = path.relative(parent, cand);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function getOrCreateTaskFilePolicy(taskId: string): TaskFilePermissionPolicy {
  const existing = taskFilePolicies.get(taskId);
  if (existing) return existing;
  const created: TaskFilePermissionPolicy = { allowAllForTask: false };
  taskFilePolicies.set(taskId, created);
  return created;
}

export function applyAllowAllForFileRequest(requestId: string): boolean {
  const meta = filePermissionMeta.get(requestId);
  if (!meta) return false;

  const policy = getOrCreateTaskFilePolicy(meta.taskId);
  // UX expectation for "Allow all (this task)": do not block on further file
  // permission prompts until this task completes.
  policy.allowAllForTask = true;

  return true;
}

export function clearTaskFilePermissionPolicy(taskId: string): void {
  taskFilePolicies.delete(taskId);
}

function resolveTaskWorkspaceRoot(taskId: string): string | null {
  const fromResolver = resolveTaskWorkspaceRootForPermission?.(taskId);
  const candidate = typeof fromResolver === 'string' ? fromResolver.trim() : '';
  if (candidate) return candidate;
  const globalRoot = (getWorkspaceRoot() || '').trim();
  return globalRoot || null;
}

function resolveFilePermissionPath(input: string | undefined, workspaceRoot: string | null): string | undefined {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return undefined;
  if (path.isAbsolute(value)) {
    return path.resolve(value);
  }
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
  return path.resolve(root || process.cwd(), value);
}

function createFilePermissionPolicyInput(taskId: string, filePath: string, targetPath?: string): {
  workspaceRoot: string | null;
  filePath: string;
  targetPath?: string;
} {
  const workspaceRoot = resolveTaskWorkspaceRoot(taskId);
  return {
    workspaceRoot,
    filePath: resolveFilePermissionPath(filePath, workspaceRoot) ?? filePath,
    targetPath: resolveFilePermissionPath(targetPath, workspaceRoot),
  };
}

function shouldAutoAllowFileOperation(taskId: string, operation: FileOperation, filePath: string, targetPath?: string): boolean {
  const policy = taskFilePolicies.get(taskId);
  const agentId = getTask(taskId)?.agentId;
  const policyInput = createFilePermissionPolicyInput(taskId, filePath, targetPath);
  const decision = evaluateFilePermissionPolicy({
    taskId,
    agentId,
    operation,
    filePath: policyInput.filePath,
    targetPath: policyInput.targetPath,
    workspaceRoot: policyInput.workspaceRoot,
    allowAllForTask: policy?.allowAllForTask,
  });
  recordPermissionPolicyAuditEntry(createPermissionPolicyAuditEntry({
    origin: 'file-permission-api',
    agentId,
    request: {
      taskId,
      type: 'file',
      fileOperation: operation,
      filePath: policyInput.filePath,
      targetPath: policyInput.targetPath,
    },
    decision,
  }));
  return decision.action === 'allow';
}

function shouldAutoDenyFileOperation(taskId: string, operation: FileOperation, filePath: string, targetPath?: string): boolean {
  const policy = taskFilePolicies.get(taskId);
  const agentId = getTask(taskId)?.agentId;
  const policyInput = createFilePermissionPolicyInput(taskId, filePath, targetPath);
  const decision = evaluateFilePermissionPolicy({
    taskId,
    agentId,
    operation,
    filePath: policyInput.filePath,
    targetPath: policyInput.targetPath,
    workspaceRoot: policyInput.workspaceRoot,
    allowAllForTask: policy?.allowAllForTask,
  });
  return decision.action === 'deny';
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `filereq_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function broadcastPermissionRequest(permissionRequest: PermissionRequest): void {
  const sent = new Set<number>();
  const windows = [
    mainWindow,
    ...BrowserWindow.getAllWindows(),
  ].filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()));

  for (const window of windows) {
    const id = window.webContents.id;
    if (sent.has(id)) continue;
    sent.add(id);
    window.webContents.send('permission:request', permissionRequest);
  }
}

/**
 * Create and start the HTTP server for permission requests
 */
export function startPermissionApiServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers for local requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Only handle POST /permission
    if (req.method !== 'POST' || req.url !== '/permission') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let data: {
      operation?: string;
      filePath?: string;
      targetPath?: string;
      contentPreview?: string;
      taskId?: string;
    };

    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Validate required fields
    if (!data.operation || !data.filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'operation and filePath are required' }));
      return;
    }

    // Validate operation type
    const validOperations = ['create', 'delete', 'rename', 'move', 'modify', 'overwrite'];
    if (!validOperations.includes(data.operation)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid operation. Must be one of: ${validOperations.join(', ')}` }));
      return;
    }

    // Check if we have the necessary dependencies
    if (!mainWindow || mainWindow.isDestroyed() || !resolveTaskIdForPermission) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Permission API not initialized' }));
      return;
    }

    const requestedTaskId = typeof data.taskId === 'string' ? data.taskId.trim() : '';
    const taskId = resolveTaskIdForPermission(requestedTaskId || undefined);
    if (!taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No matching active task for permission request' }));
      return;
    }

    const policyInput = createFilePermissionPolicyInput(taskId, data.filePath, data.targetPath);

    // If the user chose "allow all" for this task, auto-approve operations within allowed directories.
    if (shouldAutoAllowFileOperation(taskId, data.operation as FileOperation, data.filePath, data.targetPath)) {
      console.log(`[Permission API] Auto-approving file operation for task ${taskId}: ${data.operation} ${policyInput.filePath}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ allowed: true, autoApproved: true }));
      return;
    }

    if (shouldAutoDenyFileOperation(taskId, data.operation as FileOperation, data.filePath, data.targetPath)) {
      console.log(`[Permission API] Auto-denying file operation for task ${taskId}: ${data.operation} ${policyInput.filePath}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ allowed: false, autoDenied: true }));
      return;
    }

    const requestId = generateRequestId();

    // Create permission request for the UI
    const permissionRequest: PermissionRequest = {
      id: requestId,
      taskId,
      type: 'file',
      fileOperation: data.operation as FileOperation,
      filePath: policyInput.filePath,
      targetPath: policyInput.targetPath,
      contentPreview: data.contentPreview?.substring(0, 500),
      createdAt: new Date().toISOString(),
    };

    filePermissionMeta.set(requestId, {
      taskId,
      filePath: policyInput.filePath,
      targetPath: policyInput.targetPath,
    });
    pendingPermissionRequests.set(requestId, permissionRequest);

    // Send to every renderer. The active route can change between the model
    // asking for permission and the UI drawing the prompt.
    broadcastPermissionRequest(permissionRequest);
    try {
      enqueueWebPermissionRequest(permissionRequest);
    } catch (err) {
      console.warn('[Permission API] Failed to enqueue web permission request:', err);
    }

    // Wait for user response (with 5 minute timeout)
    const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

    try {
      const allowed = await new Promise<boolean>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingPermissions.delete(requestId);
          filePermissionMeta.delete(requestId);
          pendingPermissionRequests.delete(requestId);
          reject(new Error('Permission request timed out'));
        }, PERMISSION_TIMEOUT_MS);

        pendingPermissions.set(requestId, { resolve, timeoutId });
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ allowed }));
    } catch (error) {
      pendingPermissionRequests.delete(requestId);
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timed out', allowed: false }));
    }
  });

  server.listen(PERMISSION_API_PORT, '127.0.0.1', () => {
    console.log(`[Permission API] Server listening on port ${PERMISSION_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[Permission API] Port ${PERMISSION_API_PORT} already in use, skipping server start`);
    } else {
      console.error('[Permission API] Server error:', error);
    }
  });

  return server;
}

/**
 * Check if a request ID is a file permission request from the MCP server
 */
export function isFilePermissionRequest(requestId: string): boolean {
  return requestId.startsWith('filereq_');
}
