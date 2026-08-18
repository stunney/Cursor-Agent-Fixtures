#!/usr/bin/env node
/**
 * Called from agentTeardown (stop / subagentStop).
 * Reads the fixture payload on stdin and logs agent stop.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const payload = readPayload();
const dryRun = payload.dryRun === true || process.env.AGENT_FIXTURES_DRY_RUN === "1";
const hook = payload.hook ?? {};
const event = hook.hook_event_name ?? "unknown";
const status = hook.status ?? "unknown";
const conversationId = hook.conversation_id ?? hook.session_id ?? "unknown";
const subagentId = hook.subagent_id ?? "parent";
const subagentType = hook.subagent_type ?? "parent";
const modified = Array.isArray(hook.modified_files) ? hook.modified_files.length : 0;
const line = `[on-agent-stop] event=${event} status=${status} conversation=${conversationId} subagent=${subagentId} type=${subagentType} modifiedFiles=${modified} dryRun=${dryRun}`;

console.log(line);
console.log(`workspace=${payload.workspaceRoot ?? process.env.AGENT_FIXTURES_WORKSPACE ?? ""}`);

if (dryRun) {
  console.log("Would append this stop event to state/lifecycle.log");
  process.exit(0);
}

appendLifecycleLog(payload.projectExtensionDir, line);
console.log("Recorded stop event in state/lifecycle.log");
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
