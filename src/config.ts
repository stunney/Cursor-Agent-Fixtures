import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_FILE } from "./types.js";
import type { FixtureEntry, FixturesConfig, ProjectContext } from "./types.js";

const fixtureEntrySchema = z.object({
  id: z.string().min(1),
  run: z.enum(["always", "on-demand"]),
  process: z.enum(["hook", "agent"]),
  script: z.string().optional(),
  module: z.string().optional(),
});

const fixturesConfigSchema = z.object({
  version: z.literal(1),
  ticketPattern: z.string().optional(),
  parentBranch: z.string().optional(),
  dryRun: z.boolean().optional(),
  commit: z
    .object({
      allow: z.boolean().optional(),
    })
    .optional(),
  queue: z
    .object({
      lockTimeoutMs: z.number().optional(),
      pollMs: z.number().optional(),
    })
    .optional(),
  recovery: z
    .object({
      enabled: z.boolean().optional(),
      maxAttempts: z.number().optional(),
    })
    .optional(),
  stages: z.object({
    multiAgentSetup: z.array(fixtureEntrySchema),
    agentSetup: z.array(fixtureEntrySchema),
    agentTeardown: z.array(fixtureEntrySchema),
    multiAgentTeardown: z.array(fixtureEntrySchema),
  }),
  flows: z.array(fixtureEntrySchema).optional(),
});

export const DEFAULT_CONFIG: FixturesConfig = {
  version: 1,
  ticketPattern: "(?:[A-Z]+-\\d+|GH-\\d+)",
  parentBranch: "main",
  dryRun: true,
  commit: { allow: false },
  queue: { lockTimeoutMs: 120_000, pollMs: 200 },
  recovery: { enabled: true, maxAttempts: 5 },
  stages: {
    multiAgentSetup: [
      { id: "ensure-branch", run: "always", process: "hook" },
    ],
    agentSetup: [{ id: "copy-plan", run: "always", process: "hook" }],
    agentTeardown: [{ id: "run-verify", run: "always", process: "hook" }],
    multiAgentTeardown: [
      { id: "commit-pr", run: "always", process: "hook" },
    ],
  },
  flows: [{ id: "ensure-branch", run: "on-demand", process: "agent" }],
};

export function loadProjectConfig(project: ProjectContext): FixturesConfig {
  const configPath = join(project.projectExtensionDir, CONFIG_FILE);
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  const parsed = fixturesConfigSchema.parse(raw);
  return mergeWithDefaults(parsed);
}

function mergeWithDefaults(config: FixturesConfig): FixturesConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    commit: { ...DEFAULT_CONFIG.commit, ...config.commit },
    queue: { ...DEFAULT_CONFIG.queue, ...config.queue },
    recovery: { ...DEFAULT_CONFIG.recovery, ...config.recovery },
    stages: { ...DEFAULT_CONFIG.stages, ...config.stages },
  };
}

export function listAllEntries(config: FixturesConfig): FixtureEntry[] {
  const stageEntries = Object.values(config.stages).flat();
  const flowEntries = config.flows ?? [];
  const byId = new Map<string, FixtureEntry>();
  for (const entry of [...stageEntries, ...flowEntries]) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

export function getStageEntries(
  config: FixturesConfig,
  stage: keyof FixturesConfig["stages"],
  runMode: "always" | "on-demand" = "always",
): FixtureEntry[] {
  return (config.stages[stage] ?? []).filter((entry) => entry.run === runMode);
}

export function getOnDemandFlows(config: FixturesConfig): FixtureEntry[] {
  return config.flows ?? [];
}

export { fixturesConfigSchema };
