export type FixtureStage =
  | "multiAgentSetup"
  | "agentSetup"
  | "agentTeardown"
  | "multiAgentTeardown";

export type RunMode = "always" | "on-demand";
export type ProcessMode = "hook" | "agent";

export interface FixtureEntry {
  id: string;
  run: RunMode;
  process: ProcessMode;
  script?: string;
  module?: string;
}

export interface FixturesConfig {
  version: number;
  ticketPattern?: string;
  parentBranch?: string;
  dryRun?: boolean;
  commit?: { allow?: boolean };
  queue?: {
    lockTimeoutMs?: number;
    pollMs?: number;
  };
  recovery?: {
    enabled?: boolean;
    maxAttempts?: number;
  };
  stages: Record<FixtureStage, FixtureEntry[]>;
  flows?: FixtureEntry[];
}

export interface FixtureResult {
  id: string;
  success: boolean;
  dryRun: boolean;
  stdout: string;
  stderr: string;
  data?: Record<string, unknown>;
}

export interface FixtureContext {
  workspaceRoot: string;
  projectExtensionDir: string;
  conversationId: string;
  subagentId?: string;
  subagentType?: string;
  hookPayload: Record<string, unknown>;
  config: FixturesConfig;
  state: ConversationState;
}

export interface ConversationState {
  conversationId: string;
  ticket?: string;
  branch?: string;
  planPath?: string;
  stages: Record<string, StageState>;
  verify?: Record<
    string,
    Record<
      string,
      {
        command: string;
        success: boolean;
        completedAt: string;
        coveredFiles: string[];
        stdout: string;
        stderr: string;
        skipped?: boolean;
      }
    >
  >;
  recovery?: {
    attempts: number;
    lastFailure?: {
      stage: FixtureStage;
      fixtureId: string;
      message: string;
      at: string;
    };
  };
  updatedAt: string;
}

export interface StageState {
  stage: FixtureStage;
  results: FixtureResult[];
  completedAt: string;
  success: boolean;
}

export interface HookInput {
  hook_event_name: string;
  conversation_id?: string;
  generation_id?: string;
  workspace_roots?: string[];
  session_id?: string;
  subagent_id?: string;
  subagent_type?: string;
  task?: string;
  status?: string;
  modified_files?: string[];
  loop_count?: number;
  parent_conversation_id?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface ProjectContext {
  configured: boolean;
  workspaceRoot: string;
  projectExtensionDir: string;
  config: FixturesConfig | null;
}

export interface FixtureModule {
  id: string;
  stage: FixtureStage;
  run(ctx: FixtureContext): Promise<FixtureResult>;
}

export const EXTENSION_FOLDER = ".cursor/extensions/agent-fixtures";
export const CONFIG_FILE = "config.json";
export const STATE_DIR = "state";
