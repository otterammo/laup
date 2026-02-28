---
version: "1.0"
scope: project
metadata:
  name: acme-platform
  team: backend-platform
  updated: "2026-02-25"
  tags:
    - typescript
    - microservices
tools:
  cursor:
    globs:
      - "src/**/*.ts"
      - "src/**/*.tsx"
    alwaysApply: false
  aider:
    model: claude-sonnet-4-6
    autoCommits: false
  claude-code:
    deniedTools:
      - "Bash(git push*)"
permissions:
  deniedTools:
    - "Bash(rm -rf*)"
  approvalRequired:
    - deployments
---

# Project Instructions

You are working on the Acme Platform, a distributed microservices system.
Follow the conventions in this file precisely.

## Code Style

- Use TypeScript strict mode for all new files
- Prefer `const` over `let`; never use `var`
