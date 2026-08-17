import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { getStageEntries } from "./config.js";
import { mergeStateData, recordStageResults } from "./state.js";
import type {
  ConversationState,
  FixtureContext,
  FixtureEntry,
  FixtureModule,
  FixtureResult,
  FixtureStage,
  FixturesConfig,
  HookInput,
  ProjectContext,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_FIXTURES_DIR = join(__dirname, "fixtures");

const BUILTIN_FIXTURES: Record<string, () => Promise<{ default: FixtureModule }>> = {
  "ensure-branch": () => import("./fixtures/ensure-branch.js"),
  "copy-plan": () => import("./fixtures/copy-plan.js"),
  "run-verify": () => import("./fixtures/run-verify.js"),
  "commit-pr": () => import("./fixtures/commit-pr.js"),
};

export interface RunStageResult {
  state: ConversationState;
  results: FixtureResult[];
  success: boolean;
}

export async function runStage(
  project: ProjectContext,
  config: FixturesConfig,
  state: ConversationState,
  stage: FixtureStage,
  hookInput: HookInput,
): Promise<RunStageResult> {
  const entries = getStageEntries(config, stage, "always");
  const results: FixtureResult[] = [];

  for (const entry of entries) {
    const result = await executeFixture(project, config, state, entry, stage, hookInput);
    results.push(result);
    if (result.data) {
      mergeStateData(state, result.data);
    }
  }

  recordStageResults(state, stage, results);
  const success = results.every((result) => result.success);
  return { state, results, success };
}

export async function runOnDemandFlow(
  project: ProjectContext,
  config: FixturesConfig,
  state: ConversationState,
  flowId: string,
  hookInput: HookInput,
): Promise<FixtureResult> {
  const flow =
    (config.flows ?? []).find((entry) => entry.id === flowId) ??
    Object.values(config.stages)
      .flat()
      .find((entry) => entry.id === flowId && entry.run === "on-demand");

  if (!flow) {
    return {
      id: flowId,
      success: false,
      dryRun: config.dryRun ?? true,
      stdout: "",
      stderr: `On-demand flow "${flowId}" not found in project config.`,
    };
  }

  if (flow.run !== "on-demand") {
    return {
      id: flowId,
      success: false,
      dryRun: config.dryRun ?? true,
      stdout: "",
      stderr: `Fixture "${flowId}" is always-run and cannot be invoked via run_flow.`,
    };
  }

  const stage = findStageForFixture(config, flowId) ?? "agentSetup";
  return executeFixture(project, config, state, flow, stage, hookInput);
}

function findStageForFixture(
  config: FixturesConfig,
  fixtureId: string,
): FixtureStage | null {
  for (const [stage, entries] of Object.entries(config.stages)) {
    if (entries.some((entry) => entry.id === fixtureId)) {
      return stage as FixtureStage;
    }
  }
  return null;
}

async function executeFixture(
  project: ProjectContext,
  config: FixturesConfig,
  state: ConversationState,
  entry: FixtureEntry,
  stage: FixtureStage,
  hookInput: HookInput,
): Promise<FixtureResult> {
  if (entry.script) {
    return runScriptFixture(project, config, entry, hookInput);
  }

  const module = await resolveFixtureModule(project, entry);
  if (!module) {
    return {
      id: entry.id,
      success: false,
      dryRun: config.dryRun ?? true,
      stdout: "",
      stderr: `No fixture module found for "${entry.id}".`,
    };
  }

  const ctx: FixtureContext = {
    workspaceRoot: project.workspaceRoot,
    projectExtensionDir: project.projectExtensionDir,
    conversationId: state.conversationId,
    subagentId: hookInput.subagent_id,
    subagentType: hookInput.subagent_type,
    hookPayload: hookInput,
    config,
    state,
  };

  try {
    return await module.run(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: entry.id,
      success: false,
      dryRun: config.dryRun ?? true,
      stdout: "",
      stderr: message,
    };
  }
}

function runScriptFixture(
  project: ProjectContext,
  config: FixturesConfig,
  entry: FixtureEntry,
  hookInput: HookInput,
): FixtureResult {
  const scriptPath = join(project.projectExtensionDir, entry.script!);
  if (!existsSync(scriptPath)) {
    return {
      id: entry.id,
      success: false,
      dryRun: config.dryRun ?? true,
      stdout: "",
      stderr: `Script not found: ${entry.script}`,
    };
  }

  const dryRun = config.dryRun ?? true;
  const payload = JSON.stringify({
    hook: hookInput,
    dryRun,
    workspaceRoot: project.workspaceRoot,
    projectExtensionDir: project.projectExtensionDir,
  });

  const isWindows = process.platform === "win32";
  const ext = scriptPath.toLowerCase();
  let command: string;
  let args: string[];

  if (ext.endsWith(".ps1")) {
    command = "powershell";
    args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
  } else if (ext.endsWith(".js") || ext.endsWith(".mjs")) {
    command = "node";
    args = [scriptPath];
  } else if (ext.endsWith(".sh") && !isWindows) {
    command = "bash";
    args = [scriptPath];
  } else if (ext.endsWith(".cmd") || ext.endsWith(".bat")) {
    command = scriptPath;
    args = [];
  } else {
    command = isWindows ? "cmd.exe" : "sh";
    args = isWindows ? ["/c", scriptPath] : [scriptPath];
  }

  const result = spawnSync(command, args, {
    input: payload,
    encoding: "utf8",
    cwd: project.workspaceRoot,
    env: {
      ...process.env,
      AGENT_FIXTURES_DRY_RUN: dryRun ? "1" : "0",
      AGENT_FIXTURES_WORKSPACE: project.workspaceRoot,
    },
  });

  return {
    id: entry.id,
    success: result.status === 0,
    dryRun,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function resolveFixtureModule(
  project: ProjectContext,
  entry: FixtureEntry,
): Promise<FixtureModule | null> {
  const candidates: string[] = [];

  if (entry.module) {
    candidates.push(join(project.projectExtensionDir, entry.module));
  }

  candidates.push(
    join(project.projectExtensionDir, "fixtures", `${entry.id}.js`),
    join(project.projectExtensionDir, "fixtures", `${entry.id}.mjs`),
    join(project.projectExtensionDir, "fixtures", `${entry.id}.ts`),
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const mod = await import(pathToFileURL(candidate).href);
      const fixture = mod.default ?? mod.fixture ?? mod;
      if (fixture && typeof fixture.run === "function") {
        return fixture as FixtureModule;
      }
    }
  }

  const loader = BUILTIN_FIXTURES[entry.id];
  if (loader) {
    const mod = await loader();
    return mod.default;
  }

  return null;
}

export function describeFixtureResolution(
  project: ProjectContext,
  entry: FixtureEntry,
): { resolvedPath: string | null; source: "project-module" | "project-script" | "builtin" | "missing" } {
  if (entry.script) {
    const scriptPath = join(project.projectExtensionDir, entry.script);
    return {
      resolvedPath: existsSync(scriptPath) ? scriptPath : null,
      source: "project-script",
    };
  }

  const moduleCandidates = [
    entry.module ? join(project.projectExtensionDir, entry.module) : null,
    join(project.projectExtensionDir, "fixtures", `${entry.id}.js`),
    join(project.projectExtensionDir, "fixtures", `${entry.id}.mjs`),
  ].filter(Boolean) as string[];

  for (const candidate of moduleCandidates) {
    if (existsSync(candidate)) {
      return { resolvedPath: candidate, source: "project-module" };
    }
  }

  if (BUILTIN_FIXTURES[entry.id]) {
    return {
      resolvedPath: join(PLUGIN_FIXTURES_DIR, `${entry.id}.js`),
      source: "builtin",
    };
  }

  return { resolvedPath: null, source: "missing" };
}
