# Test Suite

This directory contains the test suite for the `laup` monorepo.

## Structure

```text
tests/
├── utils/                          # Test utilities and helpers
│   ├── path-normalization.ts       # Cross-platform path handling
│   └── path-normalization.test.ts  # Tests for path utilities
├── scripts/                        # Tests for build/dev scripts
├── quality/                        # Quality gate validation tests
├── lint-staged/                    # Pre-commit hook tests
└── fixtures/                       # Test fixture data
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test

# Run tests once (CI mode)
pnpm test:run

# Run with coverage
pnpm test:run --coverage

# Run specific test file
pnpm test path/to/test.test.ts

# Run integration tests (requires explicit flag)
RUN_INTEGRATION_TESTS=true pnpm test:run
```

## Test Guidelines

All tests must follow the **Test Hermeticity and Portability** requirements (CIG-004):

1. ✅ No privileged port binding (ports < 1024)
1. ✅ No external network access (unless marked as integration test)
1. ✅ Cross-platform path handling
1. ✅ Consistent results across Linux, macOS, and Windows

See [hermeticity-guidelines.md](../docs/testing/hermeticity-guidelines.md) for detailed requirements.

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect } from "vitest";

describe("Feature Name", () => {
  it("should do something", () => {
    const result = doSomething();
    expect(result).toBe(expected);
  });
});
```

### Cross-Platform Path Handling

Use the path normalization utilities for cross-platform compatibility:

```typescript
import { normalizePath, pathsEqual } from "./utils/path-normalization.js";

it("should handle paths correctly", () => {
  const path1 = normalizePath("/tmp/test");
  const path2 = normalizePath("/tmp/test/");
  
  expect(pathsEqual(path1, path2)).toBe(true);
});
```

### Integration Tests

Mark tests that require external resources:

```typescript
describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("API Integration", () => {
  it("should fetch from real API", async () => {
    // Only runs when RUN_INTEGRATION_TESTS=true
  });
});
```

### Timeouts

Tests have strict timeouts:

- **Test timeout:** 30 seconds
- **Hook timeout:** 10 seconds

Override for specific tests only when necessary:

```typescript
it("long-running operation", async () => {
  // Do work
}, 60000); // 60 second timeout
```

## Test Utilities

### Path Normalization (`utils/path-normalization.ts`)

Helper functions for cross-platform path handling:

- `normalizePath(path)` - Normalize path for comparison (resolves symlinks, handles drive letters)
- `pathsEqual(pathA, pathB)` - Compare two paths across platforms
- `toForwardSlashes(path)` - Convert path to forward slashes (for snapshots)
- `getPathSeparator()` - Get platform-specific path separator

Example:

```typescript
import { normalizePath } from "./utils/path-normalization.js";

const normalized = normalizePath("/tmp/../test");
// macOS: /private/test
// Linux: /test
// Windows: C:\test (or similar)
```

## CI Behavior

Tests run on multiple platforms in CI:

- **ubuntu-latest** - Primary Linux environment
- **macos-latest** - macOS environment

Both must pass for PR merge.

## Common Issues

### "EACCES: permission denied" on port

❌ **Problem:** Test tries to bind to privileged port

```typescript
server.listen(80);
```

✅ **Solution:** Use unprivileged port or let OS assign

```typescript
server.listen(0); // OS assigns available port
```

### Path comparison fails on macOS

❌ **Problem:** Direct path comparison with symlinked paths

```typescript
expect(somePath).toBe("/tmp/test");
```

✅ **Solution:** Use path normalization

```typescript
expect(pathsEqual(somePath, "/tmp/test")).toBe(true);
```

### Test hangs forever

❌ **Problem:** External network call or infinite loop

```typescript
await fetch("https://external-api.com");
```

✅ **Solution:** Mock the call or mark as integration test

```typescript
vi.mock("node:fetch");
// or
describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)("Integration", () => {
  // ...
});
```

## Debugging

### Verbose output

```bash
pnpm test:run --reporter=verbose
```

### Run single test

```bash
pnpm test path/to/file.test.ts -t "test name pattern"
```

### Debug in VS Code

Add breakpoint and use "Debug Test at Cursor" or run:

```bash
node --inspect-brk ./node_modules/.bin/vitest run path/to/test.test.ts
```

## Coverage

Coverage thresholds are enforced per CIG-003. See coverage report:

```bash
pnpm test:run --coverage
open coverage/index.html
```

## Questions?

- See [docs/testing/hermeticity-guidelines.md](../docs/testing/hermeticity-guidelines.md)
- Check existing tests for patterns
- Ask in PR review if unsure about test design
