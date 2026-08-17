---
name: fixtures-status
description: Show agent fixture status for the current conversation via MCP
---

# Fixtures Status

Call the `agent-fixtures` MCP tool `fixture_status` and summarize:

- Whether `.cursor/extensions/agent-fixtures/` is configured
- Current ticket, branch, and plan path from fixture state
- Stage outcomes (setup/teardown success or failure)
- Available on-demand flows

Do not manually re-run lifecycle fixtures unless the user requests it.
