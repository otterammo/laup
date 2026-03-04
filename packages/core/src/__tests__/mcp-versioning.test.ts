import { describe, expect, it } from "vitest";
import {
  buildMcpVersionConstraint,
  buildMcpVersionNotifications,
  evaluateMcpVersion,
} from "../mcp-versioning.js";

describe("mcp-versioning", () => {
  const server = {
    id: "acme/search",
    name: "Acme Search",
    version: {
      pinnedVersion: "1.2.0",
      constraint: ">=1.0.0 <2.0.0",
    },
  };

  it("builds a normalized constraint from explicit constraint", () => {
    expect(buildMcpVersionConstraint(server.version)).toBe(">=1.0.0 <2.0.0");
  });

  it("falls back to min/max constraints", () => {
    expect(buildMcpVersionConstraint({ minVersion: "1.0.0", maxVersion: "2.0.0" })).toBe(
      ">=1.0.0 <=2.0.0",
    );
  });

  it("evaluates update availability and pin drift", () => {
    const evaluation = evaluateMcpVersion({
      server,
      observedVersion: "1.1.0",
      availableVersions: ["1.2.1", "1.4.0", "2.0.0", "1.4.0", "garbage"],
    });

    expect(evaluation.pinDrift).toBe(true);
    expect(evaluation.updateAvailable).toBe(true);
    expect(evaluation.latestAvailableVersion).toBe("2.0.0");
    expect(evaluation.latestAllowedVersion).toBe("1.4.0");
  });

  it("is deterministic for unsorted available versions", () => {
    const a = evaluateMcpVersion({
      server,
      observedVersion: "1.2.0",
      availableVersions: ["1.2.9", "1.2.1", "1.2.9", "1.2.3"],
    });
    const b = evaluateMcpVersion({
      server,
      observedVersion: "1.2.0",
      availableVersions: ["1.2.3", "1.2.9", "1.2.1"],
    });

    expect(a.latestAllowedVersion).toBe("1.2.9");
    expect(a).toEqual(b);
  });

  it("builds update + drift notifications payloads", () => {
    const notifications = buildMcpVersionNotifications(
      {
        server,
        observedVersion: "1.1.0",
        availableVersions: ["1.3.0", "1.2.0"],
      },
      new Date("2026-03-04T18:00:00.000Z"),
    );

    expect(notifications.map((n) => n.type)).toEqual(["mcp.pin-drift", "mcp.update-available"]);
    expect(notifications[0]?.id).toBe("mcp-pin-drift:acme/search:1.2.0:1.1.0");
    expect(notifications[1]?.id).toBe("mcp-update-available:acme/search:1.2.0:1.3.0");
  });
});
