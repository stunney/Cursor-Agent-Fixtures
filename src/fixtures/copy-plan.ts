import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { FixtureContext, FixtureModule, FixtureResult } from "../types.js";

export const copyPlanFixture: FixtureModule = {
  id: "copy-plan",
  stage: "agentSetup",
  async run(ctx: FixtureContext): Promise<FixtureResult> {
    const dryRun = ctx.config.dryRun ?? true;
    const plansHome = join(homedir(), ".cursor", "plans");
    const workspacePlans = join(ctx.workspaceRoot, ".cursor", "plans");
    const ticket = ctx.state.ticket;
    const subagentType = ctx.subagentType ?? "parent";
    const conversationId = ctx.conversationId;

    const candidates = listPlanCandidates(plansHome, ticket, conversationId, subagentType);
    const destinationDir = workspacePlans;
    const selected = candidates[0] ?? null;
    const destFile = selected
      ? join(destinationDir, `${subagentType}-${selected.name}`)
      : join(destinationDir, `${subagentType}-plan.md`);

    const lines = [
      `[copy-plan] dryRun=${dryRun}`,
      `plansHome=${plansHome}`,
      `destination=${destFile}`,
      `candidates=${candidates.length}`,
      ...candidates.slice(0, 5).map((c) => `  - ${c.path}`),
    ];

    if (!selected) {
      lines.push("No matching plan found in ~/.cursor/plans; would create placeholder.");
    } else {
      lines.push(`Would copy: ${selected.path} -> ${destFile}`);
    }

    if (!dryRun && selected) {
      mkdirSync(destinationDir, { recursive: true });
      copyFileSync(selected.path, destFile);
    } else if (!dryRun && !selected) {
      mkdirSync(destinationDir, { recursive: true });
    }

    return {
      id: "copy-plan",
      success: true,
      dryRun,
      stdout: lines.join("\n"),
      stderr: "",
      data: { planPath: destFile },
    };
  },
};

interface PlanCandidate {
  name: string;
  path: string;
}

function listPlanCandidates(
  plansHome: string,
  ticket: string | undefined,
  conversationId: string,
  subagentType: string,
): PlanCandidate[] {
  if (!existsSync(plansHome)) {
    return [];
  }

  const files = readdirSync(plansHome, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const scored = files
    .map((name) => {
      const lower = name.toLowerCase();
      let score = 0;
      if (ticket && lower.includes(ticket.toLowerCase())) score += 3;
      if (lower.includes(conversationId.toLowerCase())) score += 2;
      if (lower.includes(subagentType.toLowerCase())) score += 1;
      if (name.endsWith(".plan.md") || name.endsWith(".md")) score += 1;
      return { name, path: join(plansHome, name), score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ name, path }) => ({ name, path }));
}

export default copyPlanFixture;
