import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "./project-dir.js";
import type { ConversationState, FixtureStage, StageState } from "./types.js";

export function getStatePath(
  projectExtensionDir: string,
  conversationId: string,
): string {
  return join(resolveStateDir(projectExtensionDir), `${conversationId}.json`);
}

export function loadState(
  projectExtensionDir: string,
  conversationId: string,
): ConversationState {
  const statePath = getStatePath(projectExtensionDir, conversationId);
  if (!existsSync(statePath)) {
    return createEmptyState(conversationId);
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as ConversationState;
  } catch {
    return createEmptyState(conversationId);
  }
}

export function saveState(
  projectExtensionDir: string,
  state: ConversationState,
): void {
  const stateDir = resolveStateDir(projectExtensionDir);
  mkdirSync(stateDir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(
    getStatePath(projectExtensionDir, state.conversationId),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

function createEmptyState(conversationId: string): ConversationState {
  return {
    conversationId,
    stages: {},
    updatedAt: new Date().toISOString(),
  };
}

export function recordStageResults(
  state: ConversationState,
  stage: FixtureStage,
  results: StageState["results"],
): ConversationState {
  const success = results.every((result) => result.success);
  state.stages[stage] = {
    stage,
    results,
    completedAt: new Date().toISOString(),
    success,
  };
  return state;
}

export function mergeStateData(
  state: ConversationState,
  data: Record<string, unknown>,
): ConversationState {
  if (typeof data.ticket === "string") {
    state.ticket = data.ticket;
  }
  if (typeof data.branch === "string") {
    state.branch = data.branch;
  }
  if (typeof data.planPath === "string") {
    state.planPath = data.planPath;
  }
  return state;
}

export function hasCompletedStage(
  state: ConversationState,
  stage: FixtureStage,
): boolean {
  const stageState = state.stages[stage];
  return Boolean(stageState?.success);
}

export function requiredSetupFailed(state: ConversationState): boolean {
  const multiSetup = state.stages.multiAgentSetup;
  return Boolean(multiSetup && !multiSetup.success);
}

export function getLastStageFailureMessage(
  state: ConversationState,
  stage: FixtureStage,
): string | null {
  const stageState = state.stages[stage];
  if (!stageState || stageState.success) {
    return null;
  }
  const failed = stageState.results.find((result) => !result.success);
  if (!failed) {
    return `Stage ${stage} failed.`;
  }
  return failed.stderr || failed.stdout || `Fixture ${failed.id} failed in ${stage}.`;
}
