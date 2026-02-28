import { describe, expect, it } from "vitest";
import {
  compareVersions,
  findLatestSatisfying,
  parseConstraint,
  parseVersion,
  satisfies,
  sortVersionsDesc,
} from "../skill-version.js";

describe("skill-version", () => {
  describe("parseVersion", () => {
    it("parses basic version", () => {
      const v = parseVersion("1.2.3");
      expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it("parses version with prerelease", () => {
      const v = parseVersion("1.2.3-beta.1");
      expect(v).toEqual({ major: 1, minor: 2, patch: 3, prerelease: "beta.1" });
    });

    it("returns null for invalid version", () => {
      expect(parseVersion("1.2")).toBeNull();
      expect(parseVersion("invalid")).toBeNull();
    });
  });

  describe("compareVersions", () => {
    it("compares major versions", () => {
      expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    it("compares minor versions", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(0);
      expect(compareVersions("1.1.0", "1.2.0")).toBeLessThan(0);
    });

    it("compares patch versions", () => {
      expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
      expect(compareVersions("1.0.1", "1.0.2")).toBeLessThan(0);
    });

    it("compares equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("prerelease is less than release", () => {
      expect(compareVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
    });
  });

  describe("parseConstraint", () => {
    it("parses exact version", () => {
      expect(parseConstraint("1.0.0")).toEqual({ type: "exact", version: "1.0.0" });
    });

    it("parses caret constraint", () => {
      expect(parseConstraint("^1.2.3")).toEqual({ type: "caret", version: "1.2.3" });
    });

    it("parses tilde constraint", () => {
      expect(parseConstraint("~1.2.3")).toEqual({ type: "tilde", version: "1.2.3" });
    });

    it("parses any constraint", () => {
      expect(parseConstraint("*")).toEqual({ type: "any" });
      expect(parseConstraint("latest")).toEqual({ type: "any" });
    });

    it("parses greater than or equal", () => {
      expect(parseConstraint(">=1.0.0")).toEqual({
        type: "range",
        min: "1.0.0",
        minInclusive: true,
      });
    });

    it("parses less than", () => {
      expect(parseConstraint("<2.0.0")).toEqual({
        type: "range",
        max: "2.0.0",
        maxInclusive: false,
      });
    });
  });

  describe("satisfies", () => {
    it("exact constraint", () => {
      expect(satisfies("1.0.0", "1.0.0")).toBe(true);
      expect(satisfies("1.0.1", "1.0.0")).toBe(false);
    });

    it("any constraint", () => {
      expect(satisfies("1.0.0", "*")).toBe(true);
      expect(satisfies("99.99.99", "*")).toBe(true);
    });

    it("caret constraint", () => {
      expect(satisfies("1.2.3", "^1.2.3")).toBe(true);
      expect(satisfies("1.9.9", "^1.2.3")).toBe(true);
      expect(satisfies("1.2.4", "^1.2.3")).toBe(true);
      expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
      expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
    });

    it("tilde constraint", () => {
      expect(satisfies("1.2.3", "~1.2.3")).toBe(true);
      expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
      expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
      expect(satisfies("1.2.2", "~1.2.3")).toBe(false);
    });

    it("greater than or equal", () => {
      expect(satisfies("1.0.0", ">=1.0.0")).toBe(true);
      expect(satisfies("2.0.0", ">=1.0.0")).toBe(true);
      expect(satisfies("0.9.9", ">=1.0.0")).toBe(false);
    });

    it("less than", () => {
      expect(satisfies("1.9.9", "<2.0.0")).toBe(true);
      expect(satisfies("2.0.0", "<2.0.0")).toBe(false);
    });
  });

  describe("findLatestSatisfying", () => {
    const versions = ["1.0.0", "1.1.0", "1.2.0", "2.0.0", "2.1.0"];

    it("finds latest for any", () => {
      expect(findLatestSatisfying(versions, "*")).toBe("2.1.0");
    });

    it("finds latest for caret", () => {
      expect(findLatestSatisfying(versions, "^1.0.0")).toBe("1.2.0");
    });

    it("finds latest for tilde", () => {
      expect(findLatestSatisfying(["1.0.0", "1.0.1", "1.0.2", "1.1.0"], "~1.0.0")).toBe("1.0.2");
    });

    it("returns null when no match", () => {
      expect(findLatestSatisfying(versions, "3.0.0")).toBeNull();
    });
  });

  describe("sortVersionsDesc", () => {
    it("sorts versions in descending order", () => {
      const versions = ["1.0.0", "2.1.0", "1.2.0", "2.0.0"];
      expect(sortVersionsDesc(versions)).toEqual(["2.1.0", "2.0.0", "1.2.0", "1.0.0"]);
    });
  });
});
