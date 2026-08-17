import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  openSync,
  closeSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_LOCK_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 200;

export interface QueueOptions {
  lockTimeoutMs?: number;
  pollMs?: number;
}

export interface QueueTicket {
  id: string;
  key: string;
  pid: number;
  holder: string;
  enqueuedAt: string;
}

function sanitizeKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

function queueDir(projectExtensionDir: string): string {
  const dir = join(projectExtensionDir, "state", "queue");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function lockPath(projectExtensionDir: string, key: string): string {
  return join(queueDir(projectExtensionDir), `${sanitizeKey(key)}.lock`);
}

function queueManifestPath(projectExtensionDir: string, key: string): string {
  return join(queueDir(projectExtensionDir), `${sanitizeKey(key)}.queue.json`);
}

function readQueue(projectExtensionDir: string, key: string): QueueTicket[] {
  const path = queueManifestPath(projectExtensionDir, key);
  if (!existsSync(path)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as QueueTicket[];
  } catch {
    return [];
  }
}

function writeQueue(
  projectExtensionDir: string,
  key: string,
  tickets: QueueTicket[],
): void {
  writeFileSync(
    queueManifestPath(projectExtensionDir, key),
    JSON.stringify(tickets, null, 2),
    "utf8",
  );
}

function tryAcquireLock(projectExtensionDir: string, key: string): boolean {
  const path = lockPath(projectExtensionDir, key);
  try {
    const fd = openSync(path, "wx");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(projectExtensionDir: string, key: string): void {
  const path = lockPath(projectExtensionDir, key);
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // best effort
  }
}

function isStaleLock(projectExtensionDir: string, key: string, timeoutMs: number): boolean {
  const path = lockPath(projectExtensionDir, key);
  if (!existsSync(path)) {
    return false;
  }
  try {
    const age = Date.now() - statSync(path).mtimeMs;
    return age > timeoutMs;
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withCommandQueue<T>(
  projectExtensionDir: string,
  key: string,
  holder: string,
  fn: () => Promise<T>,
  options: QueueOptions = {},
): Promise<T> {
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const ticketId = `${holder}-${process.pid}-${Date.now()}`;

  const ticket: QueueTicket = {
    id: ticketId,
    key,
    pid: process.pid,
    holder,
    enqueuedAt: new Date().toISOString(),
  };

  enqueue(projectExtensionDir, key, ticket);

  const deadline = Date.now() + lockTimeoutMs;
  while (Date.now() < deadline) {
    if (isHeadOfQueue(projectExtensionDir, key, ticketId)) {
      if (tryAcquireLock(projectExtensionDir, key)) {
        try {
          return await fn();
        } finally {
          releaseLock(projectExtensionDir, key);
          dequeue(projectExtensionDir, key, ticketId);
        }
      }
    }

    if (isStaleLock(projectExtensionDir, key, lockTimeoutMs)) {
      releaseLock(projectExtensionDir, key);
    }

    await sleep(pollMs);
  }

  dequeue(projectExtensionDir, key, ticketId);
  throw new Error(`Timed out waiting for command queue lock: ${key}`);
}

function enqueue(
  projectExtensionDir: string,
  key: string,
  ticket: QueueTicket,
): void {
  const queue = readQueue(projectExtensionDir, key);
  if (!queue.some((entry) => entry.id === ticket.id)) {
    queue.push(ticket);
    writeQueue(projectExtensionDir, key, queue);
  }
}

function dequeue(
  projectExtensionDir: string,
  key: string,
  ticketId: string,
): void {
  const queue = readQueue(projectExtensionDir, key).filter(
    (entry) => entry.id !== ticketId,
  );
  writeQueue(projectExtensionDir, key, queue);
}

function isHeadOfQueue(
  projectExtensionDir: string,
  key: string,
  ticketId: string,
): boolean {
  const queue = readQueue(projectExtensionDir, key);
  return queue.length === 0 || queue[0]?.id === ticketId;
}

export function buildQueueKey(
  conversationId: string,
  projectRoot: string,
  command: string,
): string {
  return `${conversationId}::${projectRoot}::${command}`;
}
