---
version: "1.0"
scope: project
tools:
  aider:
    model: claude-sonnet-4-6
    autoCommits: false
---

# Test Project Instructions

Always use TypeScript strict mode.
Prefer functional patterns over class-based patterns.

## Code Style

- Use `const` over `let`; never use `var`
- Prefer explicit return types on public functions
