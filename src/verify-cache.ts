import type { ConversationState } from "./types.js";

export interface VerifyCacheEntry {
  command: string;
  success: boolean;
  completedAt: string;
  coveredFiles: string[];
  stdout: string;
  stderr: string;
  skipped?: boolean;
}

export type VerifyCache = Record<string, Record<string, VerifyCacheEntry>>;

export function getVerifyCache(state: ConversationState): VerifyCache {
  if (!state.verify) {
    state.verify = {};
  }
  return state.verify;
}

export function shouldSkipVerify(
  state: ConversationState,
  projectKey: string,
  command: string,
  filesInRoot: string[],
): { skip: boolean; reason?: string; prior?: VerifyCacheEntry } {
  const cache = getVerifyCache(state)[projectKey]?.[command];
  if (!cache || !cache.success) {
    return { skip: false };
  }

  const newFiles = filesInRoot.filter(
    (file) => !cache.coveredFiles.includes(file),
  );
  if (newFiles.length === 0) {
    return {
      skip: true,
      reason: `Already verified for ${projectKey} with no new modifications`,
      prior: cache,
    };
  }

  return { skip: false };
}

export function recordVerifyResult(
  state: ConversationState,
  projectKey: string,
  command: string,
  entry: VerifyCacheEntry,
): void {
  const verify = getVerifyCache(state);
  if (!verify[projectKey]) {
    verify[projectKey] = {};
  }
  verify[projectKey][command] = entry;
}

export function markVerifySkipped(
  state: ConversationState,
  projectKey: string,
  command: string,
  reason: string,
  prior: VerifyCacheEntry,
): void {
  recordVerifyResult(state, projectKey, command, {
    ...prior,
    skipped: true,
    completedAt: new Date().toISOString(),
    stdout: `${prior.stdout}\n[skipped] ${reason}`,
  });
}
