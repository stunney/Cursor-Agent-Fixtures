import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";
import { describe, it, afterEach } from "node:test";
import {
  findStandaloneProjects,
  findProjectRootForFile,
  normalizeProjectKey,
  filesInProjectRoot,
} from "../src/project-roots.js";
import {
  shouldSkipVerify,
  recordVerifyResult,
} from "../src/verify-cache.js";
import { withCommandQueue } from "../src/command-queue.js";
import {
  buildRecoveryFollowup,
  shouldAttemptRecovery,
} from "../src/recovery.js";
import { getStagesForHook } from "../src/stages.js";
import { loadState, recordStageResults } from "../src/state.js";

const tempDirs: string[] = [];

function makeMonorepo(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-fixtures-mono-"));
  tempDirs.push(root);
  const pkgA = join(root, "packages", "a");
  const pkgB = join(root, "packages", "b");
  mkdirSync(pkgA, { recursive: true });
  mkdirSync(pkgB, { recursive: true });
  writeFileSync(join(pkgA, "package.json"), "{}");
  writeFileSync(join(pkgB, "package.json"), "{}");
  writeFileSync(join(pkgA, "index.ts"), "export {}");
  writeFileSync(join(pkgB, "index.ts"), "export {}");
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project roots", () => {
  it("finds distinct standalone projects from modified files", () => {
    const root = makeMonorepo();
    const projects = findStandaloneProjects(root, [
      "packages/a/index.ts",
      "packages/b/index.ts",
    ]);
    assert.equal(projects.length, 2);
    assert.ok(projects.every((p) => p.kind === "node"));
  });

  it("walks up to nearest package.json for a modified file", () => {
    const root = makeMonorepo();
    const project = findProjectRootForFile(root, "packages/a/src/foo.ts");
    assert.ok(project);
    assert.match(project!.root, /packages[/\\]a$/);
  });

  it("groups modified files by project root", () => {
    const root = makeMonorepo();
    const project = findProjectRootForFile(root, "packages/a/index.ts")!;
    const grouped = filesInProjectRoot(root, project.root, [
      "packages/a/index.ts",
      "packages/b/index.ts",
    ]);
    assert.deepEqual(grouped, ["packages/a/index.ts"]);
    assert.equal(normalizeProjectKey(root, project.root).replace(/\\/g, "/"), "packages/a");
  });
});

describe("verify deduplication", () => {
  it("skips command when project root already verified with same files", () => {
    const state = loadState(join(tmpdir(), "unused"), "conv-1");
    recordVerifyResult(state, "packages/a", "npm run build --if-present", {
      command: "npm run build --if-present",
      success: true,
      completedAt: new Date().toISOString(),
      coveredFiles: ["packages/a/index.ts"],
      stdout: "ok",
      stderr: "",
    });
    const skip = shouldSkipVerify(state, "packages/a", "npm run build --if-present", [
      "packages/a/index.ts",
    ]);
    assert.equal(skip.skip, true);
  });

  it("re-runs when new files modified in same project root", () => {
    const state = loadState(join(tmpdir(), "unused"), "conv-1");
    recordVerifyResult(state, "packages/a", "npm run build --if-present", {
      command: "npm run build --if-present",
      success: true,
      completedAt: new Date().toISOString(),
      coveredFiles: ["packages/a/index.ts"],
      stdout: "ok",
      stderr: "",
    });
    const skip = shouldSkipVerify(state, "packages/a", "npm run build --if-present", [
      "packages/a/index.ts",
      "packages/a/new.ts",
    ]);
    assert.equal(skip.skip, false);
  });
});

describe("command queue", () => {
  it("serializes concurrent command execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-fixtures-queue-"));
    tempDirs.push(root);
    const extDir = join(root, "agent-fixtures");
    mkdirSync(extDir, { recursive: true });

    let active = 0;
    let maxActive = 0;
    const run = async () =>
      withCommandQueue(extDir, "test-key", "agent-a", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 50));
        active -= 1;
        return "done";
      });

    await Promise.all([run(), run()]);
    assert.equal(maxActive, 1);
  });
});

describe("recovery", () => {
  it("builds actionable followup for teardown failure", () => {
    const state = loadState(join(tmpdir(), "unused"), "conv-1");
    recordStageResults(state, "agentTeardown", [
      {
        id: "run-verify",
        success: false,
        dryRun: true,
        stdout: "",
        stderr: "npm run build failed",
      },
    ]);
    const followup = buildRecoveryFollowup(state, "agentTeardown", 0);
    assert.ok(followup);
    assert.match(followup!, /fix immediately/i);
    assert.match(followup!, /npm run build failed/);
  });

  it("respects max recovery attempts", () => {
    const state = loadState(join(tmpdir(), "unused"), "conv-1");
    state.recovery = { attempts: 5 };
    assert.equal(shouldAttemptRecovery(state, { maxAttempts: 5 }, 0), false);
  });
});

describe("parent stop runs multi-agent teardown", () => {
  it("includes multiAgentTeardown on completed parent stop", () => {
    const plan = getStagesForHook("stop", {
      hook_event_name: "stop",
      status: "completed",
    });
    assert.deepEqual(plan.stages, ["agentTeardown", "multiAgentTeardown"]);
  });

  it("does not include multiAgentTeardown for subagent stop", () => {
    const plan = getStagesForHook("subagentStop", {
      hook_event_name: "subagentStop",
      status: "completed",
    });
    assert.deepEqual(plan.stages, ["agentTeardown"]);
  });
});
