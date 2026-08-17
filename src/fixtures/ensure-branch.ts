import { spawnSync } from "node:child_process";
import type { FixtureContext, FixtureModule, FixtureResult } from "../types.js";

export const ensureBranchFixture: FixtureModule = {
  id: "ensure-branch",
  stage: "multiAgentSetup",
  async run(ctx: FixtureContext): Promise<FixtureResult> {
    const dryRun = ctx.config.dryRun ?? true;
    const pattern = ctx.config.ticketPattern ?? "(?:[A-Z]+-\\d+|GH-\\d+)";
    const parentBranch = ctx.config.parentBranch ?? "main";

    const ticket = extractTicket(ctx, pattern);
    const branchSlug = ticket ? ticket.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "agent-work";
    const targetBranch = ticket ? `${branchSlug}` : branchSlug;

    const lines = [
      `[ensure-branch] dryRun=${dryRun}`,
      `ticket=${ticket ?? "(none)"}`,
      `parentBranch=${parentBranch}`,
      `targetBranch=${targetBranch}`,
      `Would run:`,
      `  git fetch origin ${parentBranch}`,
      `  git rev-parse --abbrev-ref HEAD`,
    ];

    if (ticket) {
      lines.push(`  git checkout -B ${targetBranch} origin/${parentBranch}`);
    } else {
      lines.push(`  git pull --ff-only origin ${parentBranch}`);
    }

    if (!dryRun) {
      const fetch = runGit(ctx.workspaceRoot, ["fetch", "origin", parentBranch]);
      if (fetch.status !== 0) {
        return failResult("ensure-branch", dryRun, lines.join("\n"), fetch.stderr);
      }
      if (ticket) {
        const checkout = runGit(ctx.workspaceRoot, [
          "checkout",
          "-B",
          targetBranch,
          `origin/${parentBranch}`,
        ]);
        if (checkout.status !== 0) {
          return failResult("ensure-branch", dryRun, lines.join("\n"), checkout.stderr);
        }
      }
    }

    return {
      id: "ensure-branch",
      success: true,
      dryRun,
      stdout: lines.join("\n"),
      stderr: "",
      data: { ticket: ticket ?? undefined, branch: targetBranch },
    };
  },
};

function extractTicket(ctx: FixtureContext, pattern: string): string | null {
  const regex = new RegExp(pattern, "i");
  const prompt = String(ctx.hookPayload.prompt ?? "");
  const task = String(ctx.hookPayload.task ?? "");
  const branch = getCurrentBranch(ctx.workspaceRoot);
  for (const source of [prompt, task, branch ?? "", ctx.state.ticket ?? ""]) {
    const match = source.match(regex);
    if (match) {
      return match[0].toUpperCase();
    }
  }
  return null;
}

function getCurrentBranch(workspaceRoot: string): string | null {
  const result = runGit(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function runGit(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function failResult(
  id: string,
  dryRun: boolean,
  stdout: string,
  stderr: string,
): FixtureResult {
  return { id, success: false, dryRun, stdout, stderr };
}

export default ensureBranchFixture;
