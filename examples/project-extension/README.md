# Project extension template

Copy this entire folder to your repository:

```text
.cursor/extensions/agent-fixtures/
```

Also copy the sibling gitignore so runtime state stays out of git:

```text
examples/.gitignore  →  .cursor/extensions/.gitignore
```

Runtime state is written beside this folder at `.cursor/extensions/state/`, not inside `agent-fixtures/`.

Then edit `config.json` for your team ticket pattern, branches, and stage fixtures.
