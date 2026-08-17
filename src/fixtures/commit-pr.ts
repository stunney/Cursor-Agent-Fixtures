import { spawnSync } from "node:child_process";
import type { FixtureContext, FixtureModule, FixtureResult } from "../types.js";

export const commitPrFixture: FixtureModule = {
  id: "commit-pr",
  stage: "multiAgentTeardown",
  async run(ctx: FixtureContext): Promise<FixtureResult> {
    const dryRun = ctx.config.dryRun ?? true;
    const allowCommit = ctx.config.commit?.allow ?? false;
    const parentBranch = ctx.config.parentBranch ?? "main";
    const branch = ctx.state.branch ?? getCurrentBranch(ctx.workspaceRoot) ?? "HEAD";
    const ticket = ctx.state.ticket ?? "agent-work";
    const commitMessage = `feat(${ticket}): agent workflow changes`;

    const status = runGit(ctx.workspaceRoot, ["status", "--short"]);
    const lines = [
      `[commit-pr] dryRun=${dryRun} allowCommit=${allowCommit}`,
      `branch=${branch}`,
      `parentBranch=${parentBranch}`,
      `commitMessage=${commitMessage}`,
      `git status:`,
      status.stdout || "(clean)",
      `Would run:`,
      `  git add -A`,
      `  git commit -m "${commitMessage}"`,
      `  gh pr create --base ${parentBranch} --head ${branch} --title "${commitMessage}"`,
    ];

    if (!dryRun && allowCommit) {
      const add = runGit(ctx.workspaceRoot, ["add", "-A"]);
      if (add.status !== 0) {
        return fail("commit-pr", dryRun, lines.join("\n"), add.stderr);
      }
      const commit = runGit(ctx.workspaceRoot, ["commit", "-m", commitMessage]);
      if (commit.status !== 0 && !commit.stderr.includes("nothing to commit")) {
        return fail("commit-pr", dryRun, lines.join("\n"), commit.stderr);
      }
      const pr = spawnSync(
        "gh",
        [
          "pr",
          "create",
          "--base",
          parentBranch,
          "--head",
          branch,
          "--title",
          commitMessage,
          "--body",
          "Automated PR from agent fixtures multi-agent teardown.",
        ],
        { cwd: ctx.workspaceRoot, encoding: "utf8" },
      );
      if (pr.status !== 0) {
        return fail("commit-pr", dryRun, lines.join("\n"), pr.stderr ?? "");
      }
      lines.push(`PR created: ${pr.stdout.trim()}`);
    }

    return {
      id: "commit-pr",
      success: true,
      dryRun,
      stdout: lines.join("\n"),
      stderr: "",
    };
  },
};

function getCurrentBranch(workspaceRoot: string): string | null {
  const result = runGit(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : null;
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

function fail(
  id: string,
  dryRun: boolean,
  stdout: string,
  stderr: string,
): FixtureResult {
  return { id, success: false, dryRun, stdout, stderr };
}

export default commitPrFixture;
