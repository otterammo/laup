# DOC-215: Tool Adapter Requirements

This document specifies requirements for new tool adapters: Codex CLI, GitHub Copilot, and OpenCode.

## Overview

Each adapter implements the `ToolAdapter` interface to render canonical LAUP instructions to tool-native formats.

```typescript
interface ToolAdapter {
  toolId: string;
  displayName: string;
  category: ToolCategory;
  render(doc: CanonicalInstruction): string | string[];
  write(rendered: string | string[], targetDir: string): string[];
  getOutputPaths?(targetDir: string): string[];
}
```

---

## ADAPT-001: Codex CLI Adapter

**Tool**: OpenAI Codex CLI (`@openai/codex`)
**Category**: `cli`
**Priority**: MUST

### Output Format

Codex CLI reads agent instructions from `AGENTS.md` files (per the [agents.md standard](https://agents.md)).

**File**: `AGENTS.md` (repository root)
**Format**: Plain Markdown with optional YAML frontmatter

```markdown
<!-- laup:generated — do not edit directly, edit laup.md instead -->

# Project Instructions

[canonical body content]
```

### Tool-Specific Overrides

```yaml
tools:
  codex:
    # No tool-specific overrides currently defined
```

### Acceptance Criteria

- [ ] Renders canonical body to `AGENTS.md`
- [ ] Includes `laup:generated` comment header
- [ ] Passes all tests

---

## ADAPT-002: GitHub Copilot Adapter

**Tool**: GitHub Copilot
**Category**: `ide`
**Priority**: MUST

### Output Format

Copilot reads custom instructions from `.github/copilot-instructions.md`.

**File**: `.github/copilot-instructions.md`
**Format**: Plain Markdown

```markdown
<!-- laup:generated — do not edit directly, edit laup.md instead -->

[canonical body content]
```

### Tool-Specific Overrides

```yaml
tools:
  copilot:
    # Path-specific instructions (optional future enhancement)
    # pathInstructions:
    #   - glob: "src/**/*.ts"
    #     file: "typescript.instructions.md"
```

### Acceptance Criteria

- [ ] Renders canonical body to `.github/copilot-instructions.md`
- [ ] Creates `.github` directory if needed
- [ ] Includes `laup:generated` comment header
- [ ] Passes all tests

---

## ADAPT-003: OpenCode Adapter

**Tool**: OpenCode / Crush (charmbracelet/crush)
**Category**: `cli`
**Priority**: MUST

### Output Format

OpenCode reads agent instructions from `AGENTS.md` (same as Codex) and tool config from `.opencode.json`.

**Primary File**: `AGENTS.md` (Markdown instructions)
**Config File**: `.opencode.json` (optional, for MCP servers and model config)

```markdown
<!-- laup:generated — do not edit directly, edit laup.md instead -->

[canonical body content]
```

### Tool-Specific Overrides

```yaml
tools:
  opencode:
    model: "claude-3.7-sonnet"
    maxTokens: 5000
    autoCompact: true
    mcpServers:
      example:
        type: stdio
        command: "path/to/server"
```

### Config File Generation

When overrides are present, generate `.opencode.json`:

```json
{
  "agents": {
    "coder": {
      "model": "claude-3.7-sonnet",
      "maxTokens": 5000
    }
  },
  "autoCompact": true,
  "mcpServers": {}
}
```

### Acceptance Criteria

- [ ] Renders canonical body to `AGENTS.md`
- [ ] Generates `.opencode.json` when overrides present
- [ ] Includes `laup:generated` comment in both files
- [ ] Passes all tests

---

## Shared AGENTS.md Consideration

Both Codex and OpenCode use `AGENTS.md`. If both adapters are active:

1. The file content should be identical (both use canonical body)
1. Only write once (last adapter wins, or merge in registry)
1. Consider a shared `AgentsMdAdapter` base class

---

## Test Requirements

Each adapter requires:

1. **Unit tests**: render() produces correct output
1. **Integration tests**: write() creates files correctly
1. **Override tests**: tool-specific overrides apply
1. **Header tests**: `laup:generated` marker present

---

## Implementation Order

1. ADAPT-002 (Copilot) — most distinct output format
1. ADAPT-001 (Codex) — AGENTS.md format
1. ADAPT-003 (OpenCode) — AGENTS.md + config file
