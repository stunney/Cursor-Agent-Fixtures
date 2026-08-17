import type { ConversationState, FixtureResult, FixtureStage } from "./types.js";
import { getLastStageFailureMessage } from "./state.js";

export interface RecoveryConfig {
  enabled?: boolean;
  maxAttempts?: number;
}

export interface RecoveryContext {
  stage: FixtureStage;
  fixtureId?: string;
  result?: FixtureResult;
  loopCount?: number;
  subagentType?: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export function shouldAttemptRecovery(
  state: ConversationState,
  config: RecoveryConfig,
  loopCount = 0,
): boolean {
  if (config.enabled === false) {
    return false;
  }
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts = state.recovery?.attempts ?? 0;
  return loopCount < maxAttempts && attempts < maxAttempts;
}

export function recordRecoveryAttempt(
  state: ConversationState,
  ctx: RecoveryContext,
  message: string,
): void {
  if (!state.recovery) {
    state.recovery = { attempts: 0 };
  }
  state.recovery.attempts += 1;
  state.recovery.lastFailure = {
    stage: ctx.stage,
    fixtureId: ctx.fixtureId ?? "unknown",
    message,
    at: new Date().toISOString(),
  };
}

export function buildRecoveryFollowup(
  state: ConversationState,
  stage: FixtureStage,
  loopCount = 0,
): string | null {
  const failure = getLastStageFailureMessage(state, stage);
  if (!failure) {
    return null;
  }

  const attempt = (state.recovery?.attempts ?? 0) + 1;
  const lines = [
    "Agent fixture failure — fix immediately in this conversation without asking the user.",
    `Stage: ${stage}`,
    `Recovery attempt: ${attempt} (hook loop ${loopCount + 1})`,
    "",
    "Failure output:",
    failure,
    "",
    "Instructions:",
    "1. Read the failure output and identify the root cause.",
    "2. Apply the minimal fix in the affected project only.",
    "3. Re-run the failing command locally if needed.",
    "4. Do not duplicate work another agent already completed — check fixture_status first.",
    "5. Continue the original task once verification passes.",
  ];

  return lines.join("\n");
}

export function buildSetupFailureFollowup(
  state: ConversationState,
  stage: FixtureStage,
): string | null {
  const failure = getLastStageFailureMessage(state, stage);
  if (!failure) {
    return null;
  }

  return [
    "Agent setup fixture failed — fix immediately before continuing.",
    `Stage: ${stage}`,
    "",
    failure,
    "",
    "Resolve the setup issue in this conversation, then retry the task.",
  ].join("\n");
}
