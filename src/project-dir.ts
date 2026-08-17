import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_FILE,
  EXTENSION_FOLDER,
  type FixturesConfig,
  type ProjectContext,
} from "./types.js";

export function resolveWorkspaceRoot(workspaceRoots?: string[]): string | null {
  if (!workspaceRoots?.length) {
    return process.cwd();
  }
  return workspaceRoots[0] ?? null;
}

export function resolveProjectExtensionDir(workspaceRoot: string): string {
  return join(workspaceRoot, EXTENSION_FOLDER);
}

export function discoverProjectContext(
  workspaceRoots?: string[],
): ProjectContext | null {
  const workspaceRoot = resolveWorkspaceRoot(workspaceRoots);
  if (!workspaceRoot) {
    return null;
  }

  const projectExtensionDir = resolveProjectExtensionDir(workspaceRoot);
  const configPath = join(projectExtensionDir, CONFIG_FILE);

  if (!existsSync(projectExtensionDir) || !existsSync(configPath)) {
    return {
      configured: false,
      workspaceRoot,
      projectExtensionDir,
      config: null,
    };
  }

  return {
    configured: true,
    workspaceRoot,
    projectExtensionDir,
    config: null,
  };
}

export function isProjectConfigured(project: ProjectContext): boolean {
  const configPath = join(project.projectExtensionDir, CONFIG_FILE);
  return existsSync(configPath);
}

export function attachConfig(
  project: ProjectContext,
  config: FixturesConfig,
): ProjectContext {
  return { ...project, configured: true, config };
}
