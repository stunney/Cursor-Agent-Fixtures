import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface StandaloneProject {
  root: string;
  kind: "node" | "python" | "dotnet";
}

const PROJECT_MARKERS: Record<StandaloneProject["kind"], string> = {
  node: "package.json",
  python: "pyproject.toml",
  dotnet: "*.sln",
};

export function findStandaloneProjects(
  workspaceRoot: string,
  modifiedFiles: string[] = [],
): StandaloneProject[] {
  const roots = new Map<string, StandaloneProject>();

  if (modifiedFiles.length > 0) {
    for (const file of modifiedFiles) {
      const project = findProjectRootForFile(workspaceRoot, file);
      if (project) {
        roots.set(project.root, project);
      }
    }
  }

  if (roots.size === 0) {
    const workspaceProject = detectProjectAtRoot(workspaceRoot);
    if (workspaceProject) {
      roots.set(workspaceProject.root, workspaceProject);
    }
  }

  return [...roots.values()].sort((a, b) => a.root.localeCompare(b.root));
}

export function findProjectRootForFile(
  workspaceRoot: string,
  filePath: string,
): StandaloneProject | null {
  const absoluteWorkspace = resolve(workspaceRoot);
  const absoluteFile = resolve(
    filePath.startsWith(absoluteWorkspace)
      ? filePath
      : join(absoluteWorkspace, filePath),
  );

  let current = absoluteFile;
  if (!existsSync(current)) {
    current = join(current, "..");
  }
  if (!filePath.endsWith(sep) && !current.endsWith(sep)) {
    const statIsDir = tryIsDirectory(current);
    if (!statIsDir) {
      current = join(current, "..");
    }
  }

  while (current.startsWith(absoluteWorkspace) || current === absoluteWorkspace) {
    const detected = detectProjectAtRoot(current);
    if (detected) {
      return detected;
    }
    if (current === absoluteWorkspace) {
      break;
    }
    current = join(current, "..");
  }

  return null;
}

function detectProjectAtRoot(root: string): StandaloneProject | null {
  if (existsSync(join(root, PROJECT_MARKERS.node))) {
    return { root, kind: "node" };
  }
  if (existsSync(join(root, PROJECT_MARKERS.python))) {
    return { root, kind: "python" };
  }
  if (readdirSync(root).some((name) => name.endsWith(".sln"))) {
    return { root, kind: "dotnet" };
  }
  return null;
}

function tryIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function commandsForProject(project: StandaloneProject): string[] {
  switch (project.kind) {
    case "node":
      return ["npm run build --if-present", "npm test --if-present"];
    case "python":
      return ["python -m pytest"];
    case "dotnet":
      return ["dotnet build", "dotnet test"];
  }
}

export function filesInProjectRoot(
  workspaceRoot: string,
  projectRoot: string,
  modifiedFiles: string[],
): string[] {
  const absProject = resolve(projectRoot);
  return modifiedFiles.filter((file) => {
    const absFile = resolve(
      file.startsWith(workspaceRoot) ? file : join(workspaceRoot, file),
    );
    return absFile.startsWith(absProject);
  });
}

export function normalizeProjectKey(workspaceRoot: string, projectRoot: string): string {
  return relative(resolve(workspaceRoot), resolve(projectRoot)) || ".";
}
