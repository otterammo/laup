# Configuration Scope Semantics (CONF-004)

LAUP supports three configuration scopes that form a hierarchy from least specific to most specific:

```text
org (lowest precedence)
  └── team
        └── project (highest precedence)
```

## Scope Definitions

| Scope     | Description                                      | Typical Location                  |
| --------- | ------------------------------------------------ | --------------------------------- |
| `org`     | Organization-wide defaults and policies          | `~/.config/laup/org.md`           |
| `team`    | Team-level conventions and overrides             | `~/.config/laup/teams/<team>.md`  |
| `project` | Project-specific instructions (highest priority) | `<repo>/laup.md`                  |

## Merge Semantics

When documents exist at multiple scopes, LAUP merges them with the following rules:

### Precedence Order

Higher-precedence scopes override lower-precedence scopes:

```text
project > team > org
```

### Merge Rules

1. **Bodies** are concatenated in precedence order (org first, project last), separated by blank lines.

1. **Scalar values** (version, strings, booleans) from higher-precedence scopes replace lower-precedence values.

1. **Arrays** are replaced entirely — they are not concatenated. A project-level `deniedTools: [tool-c]` replaces an org-level `deniedTools: [tool-a, tool-b]`.

1. **Objects** are shallow-merged. Keys from higher-precedence scopes override keys from lower-precedence scopes, but unset keys are preserved from lower scopes.

1. **Tool overrides** are merged per tool. Each tool's configuration object is shallow-merged independently.

### Example

**org.md:**

```yaml
---
version: "1.0"
scope: org
permissions:
  deniedTools:
    - "Bash(rm -rf*)"
tools:
  cursor:
    alwaysApply: true
---

# Organization Standards

All code must pass linting.
```

**team.md:**

```yaml
---
version: "1.0"
scope: team
tools:
  cursor:
    globs:
      - "src/**/*.ts"
  aider:
    model: claude-sonnet-4-6
---

# Team Conventions

Use TypeScript strict mode.
```

**project laup.md:**

```yaml
---
version: "1.0"
scope: project
tools:
  cursor:
    alwaysApply: false
---

# Project Instructions

This project uses React.
```

**Merged result:**

```yaml
---
version: "1.0"
scope: project
permissions:
  deniedTools:
    - "Bash(rm -rf*)"
tools:
  cursor:
    alwaysApply: false # from project (overrides org)
    globs: # from team (preserved)
      - "src/**/*.ts"
  aider:
    model: claude-sonnet-4-6 # from team
---

# Organization Standards

All code must pass linting.

# Team Conventions

Use TypeScript strict mode.

# Project Instructions

This project uses React.
```

## CLI Usage

```bash
# Sync with scope-aware merging (reads org + team + project, merges, then syncs)
laup sync --source laup.md --merge-scopes

# Specify team name for team-scope operations
laup sync --source laup.md --merge-scopes --team backend-platform

# Custom org/team config locations
laup sync --source laup.md --merge-scopes --org-path /path/to/org.md --teams-dir /path/to/teams/

# Sync without merging (project file only)
laup sync --source laup.md
```

## Scope Resolution

When `--merge-scopes` is used, LAUP searches for documents in this order:

1. Organization config: `~/.config/laup/org.md` (if exists)
1. Team config: `~/.config/laup/teams/<team>.md` (if `--team` specified or `metadata.team` set)
1. Project config: `<source>` (the file specified by `--source`)

All found documents are merged according to the rules above before syncing to tool-specific formats.
