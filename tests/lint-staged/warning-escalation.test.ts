import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("LGR-003: Staged-file lint warning escalation", () => {
  it("should treat warnings as blocking when checking staged files", () => {
    // Create a temporary test file with a warning-level violation
    const tempDir = mkdtempSync(join(tmpdir(), "lint-staged-test-"));
    const testFile = join(tempDir, "test-warning.ts");

    // noNonNullAssertion is configured as "warn" in biome.json
    // Using non-null assertion (!) should trigger this warning
    const codeWithWarning = `export function example(value: string | null) {
  // This should trigger noNonNullAssertion warning
  return value!.toUpperCase();
}
`;

    writeFileSync(testFile, codeWithWarning);

    try {
      // Run biome check with --error-on-warnings
      execSync(`npx biome check --error-on-warnings "${testFile}"`, {
        cwd: join(process.cwd()),
        encoding: "utf8",
      });

      // If we reach here, the check passed (no warnings/errors detected)
      // This should NOT happen - we expect it to fail
      expect.fail("Biome check should have failed with --error-on-warnings");
    } catch (error) {
      // We expect this to throw because warnings should be treated as errors
      expect(error).toBeDefined();
      // Verify it's a non-zero exit code
      expect((error as { status?: number }).status).toBeGreaterThan(0);
    } finally {
      // Cleanup
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should pass when no warnings are present", () => {
    // Create a temporary test file without warnings
    const tempDir = mkdtempSync(join(tmpdir(), "lint-staged-test-"));
    const testFile = join(tempDir, "test-no-warning.ts");

    // Clean code without warnings
    const cleanCode = `export function example(value: string | null): string {
  if (value === null) {
    return "";
  }
  return value.toUpperCase();
}
`;

    writeFileSync(testFile, cleanCode);

    try {
      // Run biome check with --error-on-warnings
      execSync(`npx biome check --error-on-warnings "${testFile}"`, {
        cwd: join(process.cwd()),
        encoding: "utf8",
      });

      // Should succeed without errors
      expect(true).toBe(true);
    } finally {
      // Cleanup
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should verify package.json lint-staged config includes --error-on-warnings", () => {
    // Read package.json and verify the configuration
    const packageJson = JSON.parse(
      execSync("cat package.json", {
        cwd: join(process.cwd()),
        encoding: "utf8",
      }),
    );

    const lintStagedConfig = packageJson["lint-staged"];
    const tsConfig = lintStagedConfig["*.{ts,tsx,js,jsx,json}"];

    expect(tsConfig).toBeDefined();
    expect(Array.isArray(tsConfig)).toBe(true);

    // Find the biome check command
    const biomeCommand = tsConfig.find((cmd: string) => cmd.includes("biome check"));
    expect(biomeCommand).toBeDefined();

    // Verify it includes --error-on-warnings
    expect(biomeCommand).toContain("--error-on-warnings");
  });
});
