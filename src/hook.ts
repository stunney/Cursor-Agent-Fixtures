import { stdin } from "node:process";
import { loadProjectConfig, getOnDemandFlows } from "./config.js";
import { discoverProjectContext, isProjectConfigured } from "./project-dir.js";
import { runStage } from "./runner.js";
import {
  buildRecoveryFollowup,
  buildSetupFailureFollowup,
  recordRecoveryAttempt,
  shouldAttemptRecovery,
} from "./recovery.js";
import {
  getConversationId,
  getStagesForHook,
  isGateHook,
} from "./stages.js";
import {
  loadState,
  saveState,
  requiredSetupFailed,
  getLastStageFailureMessage,
  hasCompletedStage,
} from "./state.js";
import type { FixtureStage, HookInput } from "./types.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput;
  try {
    input = JSON.parse(raw || "{}") as HookInput;
  } catch {
    writeOutput({});
    return;
  }

  const hookEvent = input.hook_event_name ?? "";
  const project = discoverProjectContext(input.workspace_roots);

  if (!project || !isProjectConfigured(project)) {
    writeOutput(buildNoOpResponse(hookEvent));
    return;
  }

  const config = loadProjectConfig(project);
  const conversationId = getConversationId(input);
  let state = loadState(project.projectExtensionDir, conversationId);

  if (isGateHook(hookEvent)) {
    writeOutput(buildGateResponse(state));
    return;
  }

  const plan = getStagesForHook(hookEvent, input);
  const stagesToRun = plan.stages.filter((stage) => {
    if (stage === "multiAgentTeardown" && hasCompletedStage(state, stage)) {
      return false;
    }
    return true;
  });
  const allResults: string[] = [];
  let lastFailedStage: FixtureStage | null = null;

  for (const stage of stagesToRun) {
    const result = await runStage(project, config, state, stage, input);
    state = result.state;
    saveState(project.projectExtensionDir, state);

    for (const fixtureResult of result.results) {
      allResults.push(
        `[${stage}/${fixtureResult.id}] success=${fixtureResult.success}\n${fixtureResult.stdout}`,
      );
    }

    if (!result.success) {
      lastFailedStage = stage;
    }

    if (
      hookEvent === "subagentStart" &&
      stage === "agentSetup" &&
      !result.success
    ) {
      writeOutput({
        permission: "deny",
        user_message: `Agent setup fixture failed: ${getLastStageFailureMessage(state, stage)}`,
      });
      return;
    }
  }

  if (lastFailedStage && shouldAttemptRecovery(state, config.recovery ?? {}, input.loop_count ?? 0)) {
    const failureMessage = getLastStageFailureMessage(state, lastFailedStage);
    if (failureMessage) {
      recordRecoveryAttempt(
        state,
        { stage: lastFailedStage, loopCount: input.loop_count },
        failureMessage,
      );
      saveState(project.projectExtensionDir, state);
    }
  }

  writeOutput(
    buildHookResponse(
      hookEvent,
      input,
      project,
      config,
      state,
      allResults,
      lastFailedStage,
    ),
  );
}

function buildNoOpResponse(hookEvent: string): Record<string, unknown> {
  if (hookEvent === "beforeSubmitPrompt") {
    return { continue: true };
  }
  if (hookEvent === "subagentStart") {
    return { permission: "allow" };
  }
  return {};
}

function buildGateResponse(state: ReturnType<typeof loadState>): Record<string, unknown> {
  if (requiredSetupFailed(state)) {
    const followup = buildSetupFailureFollowup(state, "multiAgentSetup");
    return {
      continue: false,
      user_message:
        "Multi-agent setup fixture failed. Fix .cursor/extensions/agent-fixtures/ config or state before continuing.",
      ...(followup ? { agent_message: followup } : {}),
    };
  }
  return { continue: true };
}

function buildHookResponse(
  hookEvent: string,
  input: HookInput,
  project: NonNullable<ReturnType<typeof discoverProjectContext>>,
  config: ReturnType<typeof loadProjectConfig>,
  state: ReturnType<typeof loadState>,
  allResults: string[],
  lastFailedStage: FixtureStage | null,
): Record<string, unknown> {
  const summary = allResults.join("\n\n");
  const onDemand = getOnDemandFlows(config)
    .map((flow) => `- ${flow.id} (${flow.process})`)
    .join("\n");
  const loopCount = input.loop_count ?? 0;
  const recoveryEnabled = shouldAttemptRecovery(state, config.recovery ?? {}, loopCount);

  switch (hookEvent) {
    case "sessionStart":
      return {
        env: {
          AGENT_FIXTURES_DIR: project.projectExtensionDir,
          AGENT_FIXTURES_CONVERSATION_ID: state.conversationId,
        },
        additional_context: [
          "Agent Fixtures ran deterministic setup for this session.",
          "Verify commands are queued per project and deduplicated across agents.",
          summary,
          onDemand ? `On-demand flows available via MCP:\n${onDemand}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      };

    case "subagentStart":
      return { permission: "allow" };

    case "stop":
    case "subagentStop": {
      if (input.status === "aborted" || !lastFailedStage) {
        return {};
      }
      if (!recoveryEnabled) {
        return {};
      }
      const followup = buildRecoveryFollowup(state, lastFailedStage, loopCount);
      if (followup) {
        return { followup_message: followup };
      }
      return {};
    }

    case "sessionEnd":
      return {};

    default:
      return {};
  }
}

function writeOutput(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main().catch((error) => {
  console.error("[agent-fixtures hook]", error);
  writeOutput({});
});
