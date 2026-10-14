import { describe, expect, it } from "vitest";
import { FPS_REPORT_INTERVAL_MS, createFpsSampler, formatFps, fpsFromSamples } from "./fps";

describe("fpsFromSamples", () => {
  it("converts frames + elapsed time to rounded fps", () => {
    expect(fpsFromSamples(60, 1000)).toBe(60);
    expect(fpsFromSamples(30, 500)).toBe(60);
    expect(fpsFromSamples(7, 500)).toBe(14);
  });

  it("rounds fractional rates", () => {
    expect(fpsFromSamples(59, 1000)).toBe(59);
    expect(fpsFromSamples(1, 33.333)).toBe(30);
  });

  it("returns 0 for empty or degenerate windows", () => {
    expect(fpsFromSamples(0, 500)).toBe(0);
    expect(fpsFromSamples(10, 0)).toBe(0);
    expect(fpsFromSamples(10, -5)).toBe(0);
    expect(fpsFromSamples(-3, 500)).toBe(0);
  });
});

describe("createFpsSampler", () => {
  it("returns null until the report interval elapses", () => {
    const sampler = createFpsSampler(500);
    expect(sampler.frame(0)).toBeNull();
    expect(sampler.frame(100)).toBeNull();
    expect(sampler.frame(499)).toBeNull();
  });

  it("reports ~60fps for 60 frames in one second with a 500ms window", () => {
    const sampler = createFpsSampler(500);
    let reported: number | null = null;
    // 61 timestamps 0..1000ms at ~16.67ms: first report lands at t>=500.
    for (let i = 0; i <= 60; i++) {
      const v = sampler.frame(i * (1000 / 60));
      if (v !== null) reported = reported === null ? v : reported;
    }
    expect(reported).not.toBeNull();
    expect(reported!).toBeGreaterThanOrEqual(55);
    expect(reported!).toBeLessThanOrEqual(65);
  });

  it("resets the window after each report", () => {
    const sampler = createFpsSampler(500);
    expect(sampler.frame(0)).toBeNull();
    const first = sampler.frame(500);
    expect(first).toBe(4); // 2 frames / 500ms
    expect(sampler.frame(600)).toBeNull();
    expect(sampler.frame(1000)).toBe(4); // next window: 2 frames / 500ms
  });

  it("ignores non-finite timestamps", () => {
    const sampler = createFpsSampler(500);
    expect(sampler.frame(0)).toBeNull();
    expect(sampler.frame(Number.NaN)).toBeNull();
    expect(sampler.frame(500)).toBe(4);
  });

  it("restarts the window when the clock jumps backwards", () => {
    const sampler = createFpsSampler(500);
    expect(sampler.frame(1000)).toBeNull();
    expect(sampler.frame(500)).toBeNull();
    expect(sampler.frame(1000)).toBe(4);
  });

  it("handles a zero-elapsed burst without dividing by zero", () => {
    const sampler = createFpsSampler(500);
    expect(sampler.frame(100)).toBeNull();
    expect(sampler.frame(100)).toBeNull();
    const v = sampler.frame(600);
    expect(v).toBe(6); // 3 frames / 500ms
  });

  it("falls back to the default interval for non-positive values", () => {
    const sampler = createFpsSampler(0);
    expect(sampler.frame(0)).toBeNull();
    expect(sampler.frame(FPS_REPORT_INTERVAL_MS - 1)).toBeNull();
    expect(sampler.frame(FPS_REPORT_INTERVAL_MS)).not.toBeNull();
  });

  it("supports custom report intervals", () => {
    const sampler = createFpsSampler(1000);
    expect(sampler.frame(0)).toBeNull();
    expect(sampler.frame(500)).toBeNull();
    expect(sampler.frame(1000)).toBe(3);
  });
});

describe("formatFps", () => {
  it("renders the overlay label", () => {
    expect(formatFps(60)).toBe("60 FPS");
    expect(formatFps(0)).toBe("0 FPS");
  });
});
