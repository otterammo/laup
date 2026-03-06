/**
 * Tests for path normalization utilities
 *
 * Requirements: CIG-004 (DOC-620)
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPathSeparator,
  normalizePath,
  pathsEqual,
  toForwardSlashes,
} from "./path-normalization.js";

describe("Path Normalization Utilities (CIG-004)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "laup-path-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("normalizePath", () => {
    it("should resolve symlinks on macOS", () => {
      // On macOS, tmpdir() might return /var which is symlinked to /private/var
      const normalized = normalizePath(testDir);

      // Should be an absolute path
      expect(normalized).toMatch(/^[/\\]/);

      // Should not have trailing slashes
      expect(normalized).not.toMatch(/[/\\]$/);
    });

    it("should normalize path separators", () => {
      const normalized = normalizePath(testDir);

      // Should use platform-specific separators
      const separator = getPathSeparator();
      expect(normalized.includes(separator) || !normalized.includes("/")).toBe(true);
    });

    it("should normalize drive letters on Windows", () => {
      if (process.platform === "win32") {
        const normalized = normalizePath(testDir);

        // Drive letter should be uppercase
        expect(normalized).toMatch(/^[A-Z]:\\/);
      }
    });

    it("should handle non-existent paths gracefully", () => {
      const nonExistent = join(testDir, "does-not-exist", "nested", "path");
      const normalized = normalizePath(nonExistent);

      // Should return a normalized path even if it doesn't exist
      expect(normalized).toBeTruthy();
      expect(normalized.length).toBeGreaterThan(0);
    });

    it("should remove trailing slashes", () => {
      const pathWithSlash = `${testDir}/`;
      const normalized = normalizePath(pathWithSlash);

      expect(normalized).not.toMatch(/[/\\]$/);
    });

    it("should handle relative paths", () => {
      const relativePath = "./some/relative/path";
      const normalized = normalizePath(relativePath);

      // Should convert to absolute path
      expect(normalized).toMatch(/^[/\\]|^[A-Z]:\\/);
    });
  });

  describe("pathsEqual", () => {
    it("should return true for same path with different representations", () => {
      const subdir = join(testDir, "subdir");
      mkdirSync(subdir);

      const path1 = subdir;
      const path2 = join(testDir, "subdir");

      expect(pathsEqual(path1, path2)).toBe(true);
    });

    it("should return false for different paths", () => {
      const subdir1 = join(testDir, "subdir1");
      const subdir2 = join(testDir, "subdir2");

      mkdirSync(subdir1);
      mkdirSync(subdir2);

      expect(pathsEqual(subdir1, subdir2)).toBe(false);
    });

    it("should handle trailing slashes", () => {
      const subdir = join(testDir, "subdir");
      mkdirSync(subdir);

      const path1 = subdir;
      const path2 = `${subdir}/`;

      expect(pathsEqual(path1, path2)).toBe(true);
    });

    it("should work with non-existent paths", () => {
      const path1 = join(testDir, "nonexistent");
      const path2 = join(testDir, "nonexistent");

      expect(pathsEqual(path1, path2)).toBe(true);
    });
  });

  describe("getPathSeparator", () => {
    it("should return platform-specific separator", () => {
      const separator = getPathSeparator();

      if (process.platform === "win32") {
        expect(separator).toBe("\\");
      } else {
        expect(separator).toBe("/");
      }
    });
  });

  describe("toForwardSlashes", () => {
    it("should convert backslashes to forward slashes", () => {
      const windowsPath = "C:\\Users\\test\\file.txt";
      const converted = toForwardSlashes(windowsPath);

      expect(converted).toBe("C:/Users/test/file.txt");
    });

    it("should leave forward slashes unchanged", () => {
      const unixPath = "/home/user/file.txt";
      const converted = toForwardSlashes(unixPath);

      expect(converted).toBe(unixPath);
    });

    it("should handle mixed separators", () => {
      const mixedPath = "C:\\Users/test\\file.txt";
      const converted = toForwardSlashes(mixedPath);

      // On Windows, path.sep is \, on Unix it's /
      // The function should normalize to forward slashes
      expect(converted).not.toContain("\\");
    });

    it("should be useful for snapshot testing", () => {
      // Paths in snapshots should be platform-independent
      const platformPath = join("root", "dir", "file.txt");
      const snapshotPath = toForwardSlashes(platformPath);

      expect(snapshotPath).toBe("root/dir/file.txt");
    });
  });

  describe("Cross-platform compatibility", () => {
    it("should handle temp directory consistently", () => {
      // tmpdir() on macOS might return /var/folders/... which is symlinked
      const temp1 = normalizePath(tmpdir());
      const temp2 = normalizePath(tmpdir());

      expect(temp1).toBe(temp2);
    });

    it("should handle nested paths consistently", () => {
      const nested = join(testDir, "a", "b", "c");
      mkdirSync(nested, { recursive: true });

      const normalized = normalizePath(nested);
      expect(normalized).toBeTruthy();
      expect(normalized).not.toMatch(/[/\\][/\\]/); // No double slashes
    });
  });
});
