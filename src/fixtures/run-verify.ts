import { spawnSync } from "node:child_process";
import { buildQueueKey, withCommandQueue } from "../command-queue.js";
import {
  commandsForProject,
  filesInProjectRoot,
  findStandaloneProjects,
  normalizeProjectKey,
} from "../project-roots.js";
import {
  markVerifySkipped,
  recordVerifyResult,
  shouldSkipVerify,
} from "../verify-cache.js";
import type { FixtureContext, FixtureModule, FixtureResult } from "../types.js";

export const runVerifyFixture: FixtureModule = {
  id: "run-verify",
  stage: "agentTeardown",
  async run(ctx: FixtureContext): Promise<FixtureResult> {
    const dryRun = ctx.config.dryRun ?? true;
    const modifiedFiles = getModifiedFiles(ctx);
    const projects = findStandaloneProjects(ctx.workspaceRoot, modifiedFiles);
    const holder =
      ctx.subagentId ?? ctx.subagentType ?? ctx.conversationId ?? "parent";

    const lines = [
      `[run-verify] dryRun=${dryRun}`,
      `modifiedFiles=${modifiedFiles.length}`,
      `standaloneProjects=${projects.length}`,
    ];

    if (projects.length === 0) {
      lines.push("No standalone projects detected for modified files.");
      return {
        id: "run-verify",
        success: true,
        dryRun,
        stdout: lines.join("\n"),
        stderr: "",
      };
    }

    const queueOptions = {
      lockTimeoutMs: ctx.config.queue?.lockTimeoutMs,
      pollMs: ctx.config.queue?.pollMs,
    };

    for (const project of projects) {
      const projectKey = normalizeProjectKey(ctx.workspaceRoot, project.root);
      const filesInRoot = filesInProjectRoot(
        ctx.workspaceRoot,
        project.root,
        modifiedFiles,
      );
      const commands = commandsForProject(project);

      lines.push(`project=${projectKey} kind=${project.kind}`);
      lines.push(`  files=${filesInRoot.length}`);

      for (const command of commands) {
        const skipCheck = shouldSkipVerify(
          ctx.state,
          projectKey,
          command,
          filesInRoot,
        );

        if (skipCheck.skip && skipCheck.prior) {
          markVerifySkipped(
            ctx.state,
            projectKey,
            command,
            skipCheck.reason ?? "deduplicated",
            skipCheck.prior,
          );
          lines.push(`  [skip] ${command} — ${skipCheck.reason}`);
          continue;
        }

        const queueKey = buildQueueKey(
          ctx.conversationId,
          project.root,
          command,
        );
        lines.push(`  [queue] ${command}`);

        if (dryRun) {
          recordVerifyResult(ctx.state, projectKey, command, {
            command,
            success: true,
            completedAt: new Date().toISOString(),
            coveredFiles: filesInRoot,
            stdout: `[dry-run] would run: ${command} in ${project.root}`,
            stderr: "",
          });
          lines.push(`  [dry-run] ${command}`);
          continue;
        }

        try {
          const runResult = await withCommandQueue(
            ctx.projectExtensionDir,
            queueKey,
            holder,
            async () =>
              runCommand(project.root, command, skipCheck.skip ? skipCheck.prior : undefined),
            queueOptions,
          );

          recordVerifyResult(ctx.state, projectKey, command, {
            command,
            success: runResult.success,
            completedAt: new Date().toISOString(),
            coveredFiles: filesInRoot,
            stdout: runResult.stdout,
            stderr: runResult.stderr,
          });

          lines.push(
            `  [${runResult.success ? "ok" : "fail"}] ${command}`,
          );

          if (!runResult.success) {
            return {
              id: "run-verify",
              success: false,
              dryRun,
              stdout: lines.join("\n"),
              stderr: runResult.stderr || `Command failed: ${command}`,
              data: { projectKey, command, projectRoot: project.root },
            };
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          recordVerifyResult(ctx.state, projectKey, command, {
            command,
            success: false,
            completedAt: new Date().toISOString(),
            coveredFiles: filesInRoot,
            stdout: "",
            stderr: message,
          });
          return {
            id: "run-verify",
            success: false,
            dryRun,
            stdout: lines.join("\n"),
            stderr: message,
            data: { projectKey, command, projectRoot: project.root },
          };
        }
      }
    }

    return {
      id: "run-verify",
      success: true,
      dryRun,
      stdout: lines.join("\n"),
      stderr: "",
    };
  },
};

function getModifiedFiles(ctx: FixtureContext): string[] {
  const fromHook = ctx.hookPayload.modified_files;
  if (Array.isArray(fromHook)) {
    return fromHook.map(String);
  }
  return [];
}

function runCommand(
  cwd: string,
  command: string,
  cached?: { success: boolean; stdout: string; stderr: string },
): { success: boolean; stdout: string; stderr: string } {
  if (cached?.success) {
    return {
      success: true,
      stdout: cached.stdout,
      stderr: cached.stderr,
    };
  }

  const result = spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf8",
  });

  return {
    success: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? `Command failed: ${command}`,
  };
}

export default runVerifyFixture;
