---
version: "1.0"
scope: project
tools:
  opencode:
    model: "claude-3.7-sonnet"
    maxTokens: 5000
    autoCompact: true
---

# Test Project Instructions

Always use TypeScript strict mode.
Prefer functional patterns over class-based patterns.

## Code Style

- Use `const` over `let`; never use `var`
- Prefer explicit return types on public functions
