# Test Hermeticity and Portability Guidelines

**Requirement:** CIG-004 (DOC-620)  
**Status:** Active  
**Last Updated:** 2026-03-06

## Overview

All tests in the `laup` repository must run in a hermetic environment that:

1. Does not require privileged port binding (ports < 1024)
1. Does not access external network resources unless explicitly marked as integration tests
1. Handles platform-specific path differences correctly
1. Runs consistently across different operating systems (Linux, macOS, Windows)

## Hermetic Testing Requirements

### 1. No Privileged Ports

Tests **MUST NOT** bind to ports below 1024, as these require root/administrator privileges.

**❌ Bad:**

```typescript
const server = http.createServer();
server.listen(80); // Requires privileged access
```

**✅ Good:**

```typescript
const server = http.createServer();
server.listen(0); // Let OS assign available port
// or
server.listen(3000); // Use non-privileged port
```

### 2. No External Network Access

Unit tests **MUST NOT** make real HTTP requests to external services.

**❌ Bad:**

```typescript
it("should fetch data", async () => {
  const response = await fetch("https://api.example.com/data");
  expect(response.ok).toBe(true);
});
```

**✅ Good:**

```typescript
import { vi } from "vitest";

it("should fetch data", async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: "mocked" }),
  });
  global.fetch = mockFetch;
  
  const response = await fetch("https://api.example.com/data");
  expect(response.ok).toBe(true);
});
```

### 3. Integration Test Markers

If a test **requires** external network access or other non-hermetic resources, it must be explicitly marked:

```typescript
import { describe, it } from "vitest";

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Integration Tests", () => {
  it("should connect to real service", async () => {
    // This test only runs when RUN_INTEGRATION_TESTS is set
    const response = await fetch("https://api.example.com/health");
    expect(response.ok).toBe(true);
  });
});
```

Run integration tests with:

```bash
RUN_INTEGRATION_TESTS=true pnpm test:run
```

## Cross-Platform Path Handling

### Path Normalization

Use the provided path normalization utilities to handle platform differences:

```typescript
import { normalizePath, pathsEqual } from "../../tests/utils/path-normalization.js";

it("should handle paths correctly", () => {
  const expectedPath = normalizePath("/tmp/test");
  const actualPath = normalizePath(getTestPath());
  
  expect(pathsEqual(expectedPath, actualPath)).toBe(true);
});
```

### Common Platform Issues

#### macOS Symlinks

On macOS, paths like `/tmp` are symlinked to `/private/tmp`. Use `normalizePath()` to resolve these:

```typescript
// ❌ Bad: Direct comparison fails on macOS
expect(tmpdir()).toBe("/tmp");

// ✅ Good: Use normalizePath
expect(normalizePath(tmpdir())).toContain("tmp");
```

#### Windows Drive Letters

Windows paths use drive letters (e.g., `C:\`). Always use `path.join()` and avoid hardcoded separators:

```typescript
import { join } from "node:path";

// ❌ Bad: Only works on Unix
const configPath = "/home/user/.config";

// ✅ Good: Works everywhere
const configPath = join(os.homedir(), ".config");
```

#### Path Separators

Use `path.join()` instead of string concatenation:

```typescript
// ❌ Bad: Breaks on Windows
const filePath = baseDir + "/" + filename;

// ✅ Good: Works everywhere
const filePath = join(baseDir, filename);
```

### Snapshot Testing Paths

For snapshot tests, normalize paths to forward slashes:

```typescript
import { toForwardSlashes } from "../../tests/utils/path-normalization.js";

it("should match snapshot", () => {
  const result = {
    path: toForwardSlashes(somePath),
  };
  expect(result).toMatchSnapshot();
});
```

## CI Environment Matrix

Tests run on multiple platforms in CI:

- **ubuntu-latest** - Primary Linux environment
- **macos-latest** - macOS environment (matches many contributors)

Both environments must pass for the PR to merge.

## Timeout Configuration

Tests have strict timeout limits to prevent hanging:

- **Test timeout:** 30 seconds per test
- **Hook timeout:** 10 seconds for setup/teardown

If a test needs more time, it's likely not hermetic or should be an integration test.

## Debugging Non-Hermetic Tests

### Check for Network Calls

```bash
# Run tests with network monitoring
pnpm test:run --reporter=verbose 2>&1 | grep -i "fetch\|http\|request"
```

### Check for Port Binding

```bash
# Monitor ports during test run
lsof -i -P | grep node  # macOS/Linux
netstat -ano | findstr node  # Windows
```

### Platform-Specific Issues

Run tests locally on different platforms:

```bash
# Using Docker for Linux
docker run --rm -v $(pwd):/work -w /work node:22 pnpm test:run

# Native macOS
pnpm test:run

# WSL for Windows testing
wsl pnpm test:run
```

## Enforcement

These requirements are enforced through:

1. **CI checks** - Tests must pass on both Linux and macOS
1. **Code review** - Look for network calls, privileged ports, hardcoded paths
1. **Lint rules** - Custom rules flag common violations
1. **Documentation** - This guide and inline comments

## Examples

See existing tests for patterns:

- `tests/utils/path-normalization.test.ts` - Path handling examples
- `tests/validate-challenge-questions.test.ts` - Hermetic file operations
- `tests/quality/validate-gaps.test.ts` - Cross-platform file access

## Questions?

If you're unsure whether a test violates hermeticity:

1. Can it run without internet? ✅
1. Can it run without root? ✅
1. Does it pass on Linux, macOS, and Windows? ✅
1. Does it always produce the same result? ✅

If any answer is ❌, refactor the test or mark it as an integration test.
