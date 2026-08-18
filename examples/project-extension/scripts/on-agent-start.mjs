#!/usr/bin/env node
/**
 * Called from agentSetup (sessionStart / subagentStart).
 * Reads the fixture payload on stdin and logs agent start.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const payload = readPayload();
const dryRun = payload.dryRun === true || process.env.AGENT_FIXTURES_DRY_RUN === "1";
const hook = payload.hook ?? {};
const event = hook.hook_event_name ?? "unknown";
const conversationId = hook.conversation_id ?? hook.session_id ?? "unknown";
const subagentId = hook.subagent_id ?? "parent";
const subagentType = hook.subagent_type ?? "parent";
const line = `[on-agent-start] event=${event} conversation=${conversationId} subagent=${subagentId} type=${subagentType} dryRun=${dryRun}`;

console.log(line);
console.log(`workspace=${payload.workspaceRoot ?? process.env.AGENT_FIXTURES_WORKSPACE ?? ""}`);

if (dryRun) {
  console.log("Would append this start event to state/lifecycle.log");
  process.exit(0);
}

appendLifecycleLog(payload.projectExtensionDir, line);
console.log("Recorded start event in state/lifecycle.log");
process.exit(0);

function readPayload() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function appendLifecycleLog(projectExtensionDir, text) {
  if (!projectExtensionDir) {
    return;
  }
  const stateDir = join(projectExtensionDir, "state");
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(join(stateDir, "lifecycle.log"), `${new Date().toISOString()} ${text}\n`);
}
