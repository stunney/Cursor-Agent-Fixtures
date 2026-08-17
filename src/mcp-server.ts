import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getOnDemandFlows,
  listAllEntries,
  loadProjectConfig,
} from "./config.js";
import { discoverProjectContext, isProjectConfigured } from "./project-dir.js";
import {
  describeFixtureResolution,
  runOnDemandFlow,
} from "./runner.js";
import { getConversationId } from "./stages.js";
import { loadState } from "./state.js";
import type { HookInput } from "./types.js";

const server = new Server(
  { name: "agent-fixtures", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

let cachedWorkspaceRoots: string[] | undefined;
let cachedConversationId: string | undefined;

function getProject(workspaceRoots?: string[]) {
  if (workspaceRoots?.length) {
    cachedWorkspaceRoots = workspaceRoots;
  }
  return discoverProjectContext(cachedWorkspaceRoots);
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_fixtures",
      description:
        "List configured agent fixtures by stage, run mode, process, and last result.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_root: { type: "string", description: "Optional workspace root override" },
        },
      },
    },
    {
      name: "inspect_fixture",
      description:
        "Inspect a fixture's resolved module/script path, config entry, and last run output.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Fixture id" },
          workspace_root: { type: "string" },
          conversation_id: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "run_flow",
      description:
        "Execute an on-demand fixture flow. Always-run lifecycle fixtures cannot be invoked here.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "On-demand flow id" },
          workspace_root: { type: "string" },
          conversation_id: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "fixture_status",
      description:
        "Return conversation fixture state: branch, ticket, plan path, stage outcomes, configured flag.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_root: { type: "string" },
          conversation_id: { type: "string" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, string>;
  const workspaceRoots = args.workspace_root
    ? [args.workspace_root]
    : cachedWorkspaceRoots;

  const project = getProject(workspaceRoots);
  if (!project) {
    return textResult({ configured: false, error: "No workspace root available." });
  }

  const configured = isProjectConfigured(project);
  if (!configured && request.params.name !== "fixture_status") {
    return textResult({
      configured: false,
      projectExtensionDir: project.projectExtensionDir,
      message:
        "Project not configured. Copy examples/project-extension/ to .cursor/extensions/agent-fixtures/",
    });
  }

  const config = configured ? loadProjectConfig(project) : null;
  const conversationId =
    args.conversation_id ?? cachedConversationId ?? "unknown";
  cachedConversationId = conversationId;
  const state = configured
    ? loadState(project.projectExtensionDir, conversationId)
    : null;

  switch (request.params.name) {
    case "list_fixtures": {
      if (!config) {
        return textResult({ configured: false });
      }
      const entries = listAllEntries(config);
      const items = entries.map((entry) => {
        const resolution = describeFixtureResolution(project, entry);
        const stageKey = Object.entries(config.stages).find(([, list]) =>
          list.some((e) => e.id === entry.id),
        )?.[0];
        const stageState = stageKey ? state?.stages[stageKey] : undefined;
        const last = stageState?.results.find((r) => r.id === entry.id);
        return {
          id: entry.id,
          stage: stageKey ?? "(flow)",
          run: entry.run,
          process: entry.process,
          resolvedPath: resolution.resolvedPath,
          source: resolution.source,
          lastResult: last ?? null,
        };
      });
      return textResult({ configured: true, fixtures: items });
    }

    case "inspect_fixture": {
      if (!config || !state) {
        return textResult({ configured: false });
      }
      const id = args.id;
      const entry = listAllEntries(config).find((e) => e.id === id);
      if (!entry) {
        return textResult({ error: `Fixture "${id}" not found.` });
      }
      const resolution = describeFixtureResolution(project, entry);
      const stageKey = Object.entries(config.stages).find(([, list]) =>
        list.some((e) => e.id === id),
      )?.[0];
      const stageState = stageKey ? state.stages[stageKey] : undefined;
      const last = stageState?.results.find((r) => r.id === id);
      return textResult({
        id,
        entry,
        resolution,
        lastResult: last ?? null,
        state: {
          ticket: state.ticket,
          branch: state.branch,
          planPath: state.planPath,
        },
      });
    }

    case "run_flow": {
      if (!config || !state) {
        return textResult({ configured: false });
      }
      const hookInput: HookInput = {
        hook_event_name: "run_flow",
        conversation_id: conversationId,
        workspace_roots: [project.workspaceRoot],
      };
      const result = await runOnDemandFlow(
        project,
        config,
        state,
        args.id,
        hookInput,
      );
      return textResult(result);
    }

    case "fixture_status": {
      return textResult({
        configured,
        projectExtensionDir: project.projectExtensionDir,
        workspaceRoot: project.workspaceRoot,
        conversationId,
        state: state ?? null,
        onDemandFlows: config ? getOnDemandFlows(config) : [],
      });
    }

    default:
      return textResult({ error: `Unknown tool: ${request.params.name}` });
  }
});

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[agent-fixtures mcp]", error);
  process.exit(1);
});
