---
version: "1.0"
scope: project
metadata:
  name: test-project
  team: engineering
tools:
  claude-code:
    deniedTools:
      - "Bash(git push*)"
      - "Bash(rm -rf*)"
permissions:
  deniedTools:
    - "Bash(rm -rf*)"
  approvalRequired:
    - deployments
---

# Test Project Instructions

Always use TypeScript strict mode.
Prefer functional patterns over class-based patterns.

## Code Style

- Use `const` over `let`; never use `var`
- Prefer explicit return types on public functions
