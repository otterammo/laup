import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/src/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts"],
      exclude: ["packages/**/src/__tests__/**"],
      thresholds: {
        lines: 75,
        statements: 73,
        functions: 80,
        branches: 60,
      },
    },
    // CIG-004: Test Hermeticity and Portability
    // Tests should run in isolation without external dependencies
    env: {
      // Ensure tests don't accidentally use production/staging endpoints
      NODE_ENV: "test",
      // Prevent accidental network calls in unit tests
      // Integration tests should explicitly opt out of this
      CI: process.env.CI || "false",
    },
    // Allow tests to be properly isolated
    isolate: true,
    // Prevent tests from running indefinitely
    testTimeout: 30000, // 30 seconds max per test
    // Hooks timeout for setup/teardown
    hookTimeout: 10000, // 10 seconds max for hooks
    // Pool options for hermetic execution (vitest 4+)
    pool: "forks",
    // Each test file runs in its own process for isolation
    fileParallelism: true,
  },
});
