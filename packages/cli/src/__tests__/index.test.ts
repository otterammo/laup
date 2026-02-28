import { describe, expect, it } from "vitest";
import { SyncEngine } from "../index.js";

describe("@laup/cli public API", () => {
  it("re-exports SyncEngine", () => {
    expect(typeof SyncEngine).toBe("function");
  });
});
