# Project extension template

Copy this entire folder to your repository:

```text
.cursor/extensions/agent-fixtures/
```

Then edit `config.json` for your team ticket pattern, branches, and stage fixtures.

## Local start / stop scripts

`agentSetup` and `agentTeardown` call project-local scripts in addition to the built-in fixtures:

| Stage | Cursor hook | Script |
|---|---|---|
| Agent Setup | `sessionStart` / `subagentStart` | `scripts/on-agent-start.mjs` |
| Agent Teardown | `stop` / `subagentStop` | `scripts/on-agent-stop.mjs` |

Each script receives JSON on stdin:

```json
{
  "hook": { "hook_event_name": "subagentStart", "conversation_id": "...", "subagent_id": "...", "subagent_type": "explore" },
  "dryRun": true,
  "workspaceRoot": "/path/to/repo",
  "projectExtensionDir": "/path/to/repo/.cursor/extensions/agent-fixtures"
}
```

Environment variables: `AGENT_FIXTURES_DRY_RUN` (`1` or `0`) and `AGENT_FIXTURES_WORKSPACE`.

In dry-run mode the scripts print the start/stop event and do not write files. With `"dryRun": false` they append to `state/lifecycle.log`.

PowerShell copies (`on-agent-start.ps1`, `on-agent-stop.ps1`) are included if you prefer `script` paths ending in `.ps1`. `verify.ps1` shows the same stdin payload pattern for a custom verify command.
