import { describe, expect, it } from "vitest";
import {
  BASE_HEIGHT_SCALE,
  DEFAULT_EXAGGERATION,
  effectiveExaggeration,
  MAX_EXAGGERATION,
  MIN_EXAGGERATION,
  worldHeight,
} from "./types.js";

describe("rebased height scale (old 2x is the new 1x)", () => {
  it("bakes a 2x base factor into the raw→world mapping", () => {
    expect(BASE_HEIGHT_SCALE).toBe(2.0);
  });

  it("renders the old 2x view at the new 1x slider stop", () => {
    expect(worldHeight(100, 1.0)).toBe(200);
  });

  it("preserves the previous 3.0x opening view at the new default", () => {
    expect(DEFAULT_EXAGGERATION).toBe(1.5);
    expect(worldHeight(100, DEFAULT_EXAGGERATION)).toBe(300);
  });

  it("keeps the default inside the rebased slider range (0.5–3)", () => {
    expect(MIN_EXAGGERATION).toBe(0.5);
    expect(MAX_EXAGGERATION).toBe(3.0);
    expect(DEFAULT_EXAGGERATION).toBeGreaterThanOrEqual(MIN_EXAGGERATION);
    expect(DEFAULT_EXAGGERATION).toBeLessThanOrEqual(MAX_EXAGGERATION);
  });

  it("maps the rebased slider back onto the old 1–6 shader scale", () => {
    expect(effectiveExaggeration(MIN_EXAGGERATION)).toBe(1.0);
    expect(effectiveExaggeration(1.0)).toBe(2.0);
    expect(effectiveExaggeration(DEFAULT_EXAGGERATION)).toBe(3.0);
    expect(effectiveExaggeration(MAX_EXAGGERATION)).toBe(6.0);
  });

  it("scales linearly so re-snaps stay proportional", () => {
    expect(worldHeight(100, 3.0)).toBe(worldHeight(100, 1.0) * 3);
  });
});
