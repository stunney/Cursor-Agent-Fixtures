# Agent Fixtures

[![CI](https://github.com/stunney/Cursor-Agent-Fixtures/actions/workflows/ci.yml/badge.svg)](https://github.com/stunney/Cursor-Agent-Fixtures/actions/workflows/ci.yml)

Deterministic setup and teardown actions at agent workflow lifecycle stages. Cursor rules are advisory; these fixtures run real code with defined config, exit codes, and recorded state.

## Install the plugin

1. Clone or copy this repo. Hook and MCP entrypoints are committed under `scripts/` (`hook.mjs`, `mcp-server.mjs`), so copying the repo into Cursor local plugins works without running a build.

2. Copy (do not symlink) the plugin into Cursor local plugins:

```powershell
# Windows
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cursor\plugins\local\agent-fixtures"
Copy-Item -Recurse -Force "C:\path\to\cursor-agent-fixtures\*" "$env:USERPROFILE\.cursor\plugins\local\agent-fixtures\"
```

```bash
# macOS / Linux
mkdir -p ~/.cursor/plugins/local/agent-fixtures
cp -R /path/to/cursor-agent-fixtures/* ~/.cursor/plugins/local/agent-fixtures/
```

3. Reload Cursor (`Developer: Reload Window`).

After changing TypeScript under `src/`, run `npm run build` (compiles tests to `dist/` and rebundles `scripts/*.mjs`), then recopy the plugin or update your local install.

## Configure a project

Copy the project extension template into your repo:

```text
examples/project-extension/  →  .cursor/extensions/agent-fixtures/
```

Your project should contain:

```text
.cursor/extensions/agent-fixtures/
├── config.json       # required
├── fixtures/         # optional overrides
├── scripts/          # optional scripts
└── state/            # runtime (gitignored)
```

If this folder or `config.json` is missing, the plugin no-ops and does not modify the repo.

## Lifecycle stages

| Stage | Cursor hook | Purpose |
|---|---|---|
| Multi-Agent Setup | `sessionStart` | Branch/ticket prep, shared session setup |
| Agent Setup | `sessionStart` / `subagentStart` | Per-agent setup (e.g. copy plan) |
| Agent Teardown | `stop` / `subagentStop` | Build/test verification (queued + deduplicated per project) |
| Multi-Agent Teardown | `stop` (parent completed) / `sessionEnd` | Commit + PR (dry-run by default) |

`beforeSubmitPrompt` blocks the first prompt if multi-agent setup failed (fail-closed gate).

## Multi-agent command queue and deduplication

When several agents touch the same repo:

- **Queue**: identical commands for the same conversation + project root are serialized via a file lock in `.cursor/extensions/agent-fixtures/state/queue/`. Agents wait their turn instead of running `npm run build` simultaneously.
- **Deduplication**: `run-verify` detects standalone project roots (`package.json`, `pyproject.toml`, `.sln`) from `modified_files`. For each root it runs build/test **once** per command unless new files in that root were modified since the last successful verify.
- **Recovery**: when a fixture fails, the `stop` / `subagentStop` hook returns a `followup_message` instructing the agent to fix the failure immediately in the same conversation (no user prompt required). Retries respect `recovery.maxAttempts` and the hook `loop_limit`.

## MCP tools

When the plugin MCP server is enabled, agents can inspect fixtures without re-implementing lifecycle logic:

- `list_fixtures` — all configured fixtures and last results
- `inspect_fixture` — resolved paths and last stdout/stderr
- `run_flow` — run on-demand flows only
- `fixture_status` — conversation state (branch, ticket, plan path, verify cache, recovery attempts)

## Example flows (stubs)

All four built-in fixtures run in **dry-run** mode by default (`dryRun: true` in `config.json`):

1. **ensure-branch** — git fetch / branch from ticket
2. **copy-plan** — copy plan from `~/.cursor/plans` to `.cursor/plans/`
3. **run-verify** — detect and print build/test commands
4. **commit-pr** — print git/gh commands (real commit only when `dryRun: false` and `commit.allow: true`)

Override any fixture by adding `.cursor/extensions/agent-fixtures/fixtures/<id>.js` or pointing `script` at a file in `scripts/`.

The project-extension template also calls local scripts on **agent start** and **agent stop**:

| Stage | Cursor hook | Script |
|---|---|---|
| Agent Setup | `sessionStart` / `subagentStart` | `scripts/on-agent-start.mjs` |
| Agent Teardown | `stop` / `subagentStop` | `scripts/on-agent-stop.mjs` |

Those scripts read the hook payload from stdin and, when `dryRun` is false, append to `state/lifecycle.log`. PowerShell variants (`*.ps1`) are in the same folder. See [examples/project-extension/README.md](examples/project-extension/README.md).

## Cloud agents

Cloud agents run `subagentStart`, `subagentStop`, `stop`, and other supported hooks from project `.cursor/hooks.json`. This plugin's hooks ship with the plugin install. Cloud agents do **not** run `sessionStart` / `sessionEnd`.

## Development

```bash
npm install
npm run build   # tsc → dist/ (tests) + esbuild → scripts/*.mjs (hooks/MCP)
npm test
```

## Release and marketplace

CI runs on every pull request and on pushes to `main` using free GitHub-hosted runners (`ubuntu-latest`). After a successful `main` build, CI creates a GitHub Release tagged `v{version}` from [`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json) when that tag does not exist yet. Bump the version in both `plugin.json` and `package.json` before merging to ship a new release snapshot.

### Public Cursor Marketplace

Cursor’s public marketplace is a curated, git-based listing with manual review — there is no publish API or publisher token.

1. Submit this repository once at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).
2. Each new release on `main` is the snapshot Cursor re-reviews before updating the listing.

### Team Marketplace

For private distribution within a Cursor Teams or Enterprise org:

1. In **Dashboard → Plugins → Team Marketplaces**, choose **Import from Repo** and paste `https://github.com/stunney/Cursor-Agent-Fixtures`.
2. Install the [Cursor GitHub App](https://cursor.com/docs/integrations/github) on this repository.
3. Enable **Auto Refresh** so pushes to `main` re-index the plugin (at most once every 10 minutes).

## License

MIT
