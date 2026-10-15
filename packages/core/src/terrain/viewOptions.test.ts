import { describe, expect, it } from "vitest";
import { DEFAULT_EXAGGERATION } from "./types.js";

describe("default height scale", () => {
  it("opens at 3.0x (1.5x the previous 2.0x default)", () => {
    expect(DEFAULT_EXAGGERATION).toBe(3.0);
  });

  it("stays inside the App height-scale slider range (1–6)", () => {
    expect(DEFAULT_EXAGGERATION).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_EXAGGERATION).toBeLessThanOrEqual(6);
  });
});
