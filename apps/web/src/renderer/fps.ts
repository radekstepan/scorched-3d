// FPS sampler for the render loop.
//
// Pure, framework-free accumulator: feed it one timestamp per rendered frame
// (e.g. `performance.now()` inside the `requestAnimationFrame` tick) and it
// reports a rounded frames-per-second value each time the report interval
// elapses, otherwise `null`. The caller writes the value straight into the DOM
// so React never re-renders at frame rate. Kept free of three.js and React so
// it stays unit-testable in a node environment.

/** How often the sampler emits a fresh FPS value (2 reports/sec). */
export const FPS_REPORT_INTERVAL_MS = 500;

export interface FpsSampler {
  /** Feed one rendered frame; returns rounded FPS once per interval, else null. */
  frame: (nowMs: number) => number | null;
}

/**
 * Frames-per-second over a sample window: `frames * 1000 / elapsedMs`,
 * rounded. Returns 0 for empty or non-positive windows (clock glitches,
 * zero-elapsed frames) instead of dividing by zero.
 */
export function fpsFromSamples(frames: number, elapsedMs: number): number {
  if (frames <= 0 || elapsedMs <= 0) return 0;
  return Math.round((frames * 1000) / elapsedMs);
}

/** Render an FPS value for the overlay (`-- FPS` before the first report). */
export function formatFps(fps: number): string {
  return `${fps} FPS`;
}

export function createFpsSampler(intervalMs: number = FPS_REPORT_INTERVAL_MS): FpsSampler {
  const interval = intervalMs > 0 ? intervalMs : FPS_REPORT_INTERVAL_MS;
  let windowStart: number | null = null;
  let frames = 0;

  return {
    frame(nowMs: number): number | null {
      if (!Number.isFinite(nowMs)) return null;
      if (windowStart === null) {
        windowStart = nowMs;
        frames = 1;
        return null;
      }
      const elapsed = nowMs - windowStart;
      if (elapsed < 0) {
        // Clock jumped backwards: restart the window on this frame.
        windowStart = nowMs;
        frames = 1;
        return null;
      }
      frames += 1;
      if (elapsed < interval) return null;
      const fps = fpsFromSamples(frames, elapsed);
      windowStart = nowMs;
      frames = 0;
      return fps;
    },
  };
}
