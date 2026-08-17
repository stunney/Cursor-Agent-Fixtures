import type { FixtureStage, HookInput } from "./types.js";

export interface StagePlan {
  stages: FixtureStage[];
  isSubagent: boolean;
}

export function getStagesForHook(hookEvent: string, input: HookInput): StagePlan {
  switch (hookEvent) {
    case "sessionStart":
      return {
        stages: ["multiAgentSetup", "agentSetup"],
        isSubagent: false,
      };
    case "subagentStart":
      return {
        stages: ["agentSetup"],
        isSubagent: true,
      };
    case "stop": {
      const stages: FixtureStage[] = ["agentTeardown"];
      const isParent = !input.subagent_id;
      if (isParent && input.status === "completed") {
        stages.push("multiAgentTeardown");
      }
      return { stages, isSubagent: false };
    }
    case "subagentStop":
      return {
        stages: ["agentTeardown"],
        isSubagent: true,
      };
    case "sessionEnd":
      return {
        stages: ["multiAgentTeardown"],
        isSubagent: false,
      };
    default:
      return { stages: [], isSubagent: false };
  }
}

export function isGateHook(hookEvent: string): boolean {
  return hookEvent === "beforeSubmitPrompt";
}

export function getConversationId(input: HookInput): string {
  const id =
    input.conversation_id ??
    input.session_id ??
    input.parent_conversation_id;
  return id ?? "unknown";
}

export function getSubagentId(input: HookInput): string | undefined {
  return input.subagent_id;
}

export function getSubagentType(input: HookInput): string | undefined {
  return input.subagent_type;
}
