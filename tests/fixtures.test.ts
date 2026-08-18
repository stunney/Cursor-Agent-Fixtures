import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";
import { describe, it, afterEach } from "node:test";
import {
  discoverProjectContext,
  isProjectConfigured,
  resolveStateDir,
} from "../src/project-dir.js";
import { loadProjectConfig, getStageEntries } from "../src/config.js";
import { getStagesForHook, isGateHook } from "../src/stages.js";
import {
  loadState,
  recordStageResults,
  requiredSetupFailed,
} from "../src/state.js";
import { runStage } from "../src/runner.js";
import ensureBranchFixture from "../src/fixtures/ensure-branch.js";
import type { FixtureContext, FixturesConfig } from "../src/types.js";

const tempDirs: string[] = [];
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLE_SCRIPTS = join(REPO_ROOT, "examples", "project-extension", "scripts");

function makeProject(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "agent-fixtures-test-"));
  tempDirs.push(root);
  const extDir = join(root, ".cursor", "extensions", "agent-fixtures");
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, "config.json"), JSON.stringify(config, null, 2));
  return root;
}

function copyExampleLifecycleScripts(extDir: string): void {
  mkdirSync(join(extDir, "scripts"), { recursive: true });
  copyFileSync(
    join(EXAMPLE_SCRIPTS, "on-agent-start.mjs"),
    join(extDir, "scripts", "on-agent-start.mjs"),
  );
  copyFileSync(
    join(EXAMPLE_SCRIPTS, "on-agent-stop.mjs"),
    join(extDir, "scripts", "on-agent-stop.mjs"),
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project-dir discovery", () => {
  it("returns not configured when extension folder is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-fixtures-empty-"));
    tempDirs.push(root);
    const ctx = discoverProjectContext([root]);
    assert.ok(ctx);
    assert.equal(isProjectConfigured(ctx!), false);
    assert.equal(ctx!.configured, false);
  });

  it("detects configured project when config.json exists", () => {
    const root = makeProject({
      version: 1,
      stages: {
        multiAgentSetup: [],
        agentSetup: [],
        agentTeardown: [],
        multiAgentTeardown: [],
      },
    });
    const ctx = discoverProjectContext([root]);
    assert.ok(ctx);
    assert.equal(isProjectConfigured(ctx!), true);
  });

  it("places runtime state under the project extension folder", () => {
    const root = makeProject({
      version: 1,
      stages: {
        multiAgentSetup: [],
        agentSetup: [],
        agentTeardown: [],
        multiAgentTeardown: [],
      },
    });
    const ctx = discoverProjectContext([root])!;
    const stateDir = resolveStateDir(ctx.projectExtensionDir);
    assert.equal(stateDir, join(ctx.projectExtensionDir, "state"));
  });
});

describe("stages mapping", () => {
  it("maps sessionStart to multiAgentSetup and agentSetup", () => {
    const plan = getStagesForHook("sessionStart", { hook_event_name: "sessionStart" });
    assert.deepEqual(plan.stages, ["multiAgentSetup", "agentSetup"]);
  });

  it("identifies beforeSubmitPrompt as gate hook", () => {
    assert.equal(isGateHook("beforeSubmitPrompt"), true);
    assert.equal(isGateHook("sessionStart"), false);
  });
});

describe("config merge", () => {
  it("loads project config with defaults", () => {
    const root = makeProject({
      version: 1,
      parentBranch: "develop",
      stages: {
        multiAgentSetup: [{ id: "ensure-branch", run: "always", process: "hook" }],
        agentSetup: [],
        agentTeardown: [],
        multiAgentTeardown: [],
      },
    });
    const ctx = discoverProjectContext([root])!;
    const config = loadProjectConfig(ctx);
    assert.equal(config.parentBranch, "develop");
    assert.equal(config.dryRun, true);
    assert.equal(getStageEntries(config, "multiAgentSetup").length, 1);
  });
});

describe("state and gate", () => {
  it("requiredSetupFailed when multiAgentSetup failed", () => {
    const root = makeProject({
      version: 1,
      stages: { multiAgentSetup: [], agentSetup: [], agentTeardown: [], multiAgentTeardown: [] },
    });
    const extDir = join(root, ".cursor", "extensions", "agent-fixtures");
    const state = loadState(extDir, "conv-1");
    recordStageResults(state, "multiAgentSetup", [
      {
        id: "ensure-branch",
        success: false,
        dryRun: true,
        stdout: "",
        stderr: "failed",
      },
    ]);
    assert.equal(requiredSetupFailed(state), true);
  });
});

describe("ensure-branch stub", () => {
  it("runs in dry-run and returns success", async () => {
    const root = makeProject({
      version: 1,
      dryRun: true,
      ticketPattern: "PROJ-123",
      stages: {
        multiAgentSetup: [{ id: "ensure-branch", run: "always", process: "hook" }],
        agentSetup: [],
        agentTeardown: [],
        multiAgentTeardown: [],
      },
    });
    const ctx: FixtureContext = {
      workspaceRoot: root,
      projectExtensionDir: join(root, ".cursor", "extensions", "agent-fixtures"),
      conversationId: "conv-1",
      hookPayload: { prompt: "Work on PROJ-123 feature" },
      config: loadProjectConfig(discoverProjectContext([root])!),
      state: loadState(join(root, ".cursor", "extensions", "agent-fixtures"), "conv-1"),
    };
    const result = await ensureBranchFixture.run(ctx);
    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.match(result.stdout, /ensure-branch/);
    assert.equal(result.data?.ticket, "PROJ-123");
  });
});

describe("runner stage execution", () => {
  it("calls local scripts on agent setup and teardown", async () => {
    const root = makeProject({
      version: 1,
      dryRun: true,
      stages: {
        multiAgentSetup: [],
        agentSetup: [
          {
            id: "on-agent-start",
            run: "always",
            process: "hook",
            script: "scripts/on-agent-start.mjs",
          },
        ],
        agentTeardown: [
          {
            id: "on-agent-stop",
            run: "always",
            process: "hook",
            script: "scripts/on-agent-stop.mjs",
          },
        ],
        multiAgentTeardown: [],
      },
    });
    const extDir = join(root, ".cursor", "extensions", "agent-fixtures");
    copyExampleLifecycleScripts(extDir);

    const project = discoverProjectContext([root])!;
    const config = loadProjectConfig(project);
    const state = loadState(project.projectExtensionDir, "conv-script");

    const start = await runStage(project, config, state, "agentSetup", {
      hook_event_name: "subagentStart",
      conversation_id: "conv-script",
      subagent_id: "sa-1",
      subagent_type: "explore",
    });
    assert.equal(start.success, true);
    assert.equal(start.results.length, 1);
    assert.match(start.results[0]!.stdout, /\[on-agent-start\] event=subagentStart/);

    const stop = await runStage(project, config, state, "agentTeardown", {
      hook_event_name: "subagentStop",
      conversation_id: "conv-script",
      subagent_id: "sa-1",
      subagent_type: "explore",
      status: "completed",
    });
    assert.equal(stop.success, true);
    assert.equal(stop.results.length, 1);
    assert.match(stop.results[0]!.stdout, /\[on-agent-stop\] event=subagentStop status=completed/);
    assert.match(start.results[0]!.stdout, /Would append this start event/);
    assert.match(stop.results[0]!.stdout, /Would append this stop event/);
    assert.equal(existsSync(join(extDir, "state", "lifecycle.log")), false);
  });

  it("writes lifecycle.log from start and stop scripts when dryRun is false", async () => {
    const root = makeProject({
      version: 1,
      dryRun: false,
      stages: {
        multiAgentSetup: [],
        agentSetup: [
          {
            id: "on-agent-start",
            run: "always",
            process: "hook",
            script: "scripts/on-agent-start.mjs",
          },
        ],
        agentTeardown: [
          {
            id: "on-agent-stop",
            run: "always",
            process: "hook",
            script: "scripts/on-agent-stop.mjs",
          },
        ],
        multiAgentTeardown: [],
      },
    });
    const extDir = join(root, ".cursor", "extensions", "agent-fixtures");
    copyExampleLifecycleScripts(extDir);

    const project = discoverProjectContext([root])!;
    const config = loadProjectConfig(project);
    const state = loadState(project.projectExtensionDir, "conv-live");

    const start = await runStage(project, config, state, "agentSetup", {
      hook_event_name: "sessionStart",
      conversation_id: "conv-live",
    });
    const stop = await runStage(project, config, state, "agentTeardown", {
      hook_event_name: "stop",
      conversation_id: "conv-live",
      status: "completed",
      modified_files: ["src/hook.ts"],
    });

    assert.equal(start.success, true);
    assert.equal(stop.success, true);
    const log = readFileSync(join(extDir, "state", "lifecycle.log"), "utf8");
    assert.match(log, /\[on-agent-start\] event=sessionStart/);
    assert.match(log, /\[on-agent-stop\] event=stop status=completed/);
    assert.match(log, /modifiedFiles=1/);
  });

  it("executes multiAgentSetup fixtures in dry-run", async () => {
    const root = makeProject({
      version: 1,
      dryRun: true,
      stages: {
        multiAgentSetup: [{ id: "ensure-branch", run: "always", process: "hook" }],
        agentSetup: [],
        agentTeardown: [],
        multiAgentTeardown: [],
      },
    });
    const project = discoverProjectContext([root])!;
    const config = loadProjectConfig(project);
    const state = loadState(project.projectExtensionDir, "conv-2");
    const result = await runStage(project, config, state, "multiAgentSetup", {
      hook_event_name: "sessionStart",
      conversation_id: "conv-2",
      prompt: "PROJ-99",
    });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 1);
  });
});
