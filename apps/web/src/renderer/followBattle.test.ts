import { describe, expect, it } from "vitest";
import {
  CombatEventTracker,
  FOLLOW_DEADZONE,
  FOLLOW_EVENT_WINDOW,
  FOLLOW_MAX_EVENTS,
  FOLLOW_RESUME_DELAY,
  FollowHoldTracker,
  followBattleStep,
  followSuppressed,
} from "./followBattle";

describe("CombatEventTracker", () => {
  it("returns null on a quiet field", () => {
    expect(new CombatEventTracker().centroid()).toBeNull();
  });

  it("averages recorded impacts", () => {
    const tracker = new CombatEventTracker();
    tracker.record(0, 0);
    tracker.record(100, 200);
    expect(tracker.centroid()).toEqual({ x: 50, z: 100, count: 2 });
    expect(tracker.size).toBe(2);
  });

  it("drops impacts past the window, oldest first", () => {
    const tracker = new CombatEventTracker();
    tracker.record(0, 0);
    tracker.tick(FOLLOW_EVENT_WINDOW / 2);
    tracker.record(100, 0);
    // First impact ages out; the live one carries the centroid alone.
    tracker.tick(FOLLOW_EVENT_WINDOW / 2);
    expect(tracker.centroid()).toEqual({ x: 100, z: 0, count: 1 });
    // Then the field goes quiet and the camera rests.
    tracker.tick(FOLLOW_EVENT_WINDOW);
    expect(tracker.centroid()).toBeNull();
  });

  it("ignores non-positive ticks", () => {
    const tracker = new CombatEventTracker();
    tracker.record(10, 20);
    tracker.tick(0);
    tracker.tick(-1);
    tracker.tick(Number.NaN);
    expect(tracker.size).toBe(1);
  });

  it("ignores non-finite records", () => {
    const tracker = new CombatEventTracker();
    tracker.record(Number.NaN, 0);
    tracker.record(0, Number.POSITIVE_INFINITY);
    expect(tracker.centroid()).toBeNull();
  });

  it("caps the ring, evicting oldest first", () => {
    const tracker = new CombatEventTracker();
    for (let i = 0; i < FOLLOW_MAX_EVENTS + 10; i++) tracker.record(i, 0);
    expect(tracker.size).toBe(FOLLOW_MAX_EVENTS);
    // Oldest (0..9) evicted: mean of 10..FOLLOW_MAX_EVENTS+9.
    const lo = 10;
    const hi = FOLLOW_MAX_EVENTS + 9;
    expect(tracker.centroid()).toEqual({ x: (lo + hi) / 2, z: 0, count: FOLLOW_MAX_EVENTS });
  });

  it("clear empties the ring", () => {
    const tracker = new CombatEventTracker();
    tracker.record(1, 2);
    tracker.clear();
    expect(tracker.centroid()).toBeNull();
    expect(tracker.size).toBe(0);
  });
});

describe("followSuppressed", () => {
  it("holds while the user drives, however long the gesture runs", () => {
    expect(followSuppressed(1000, 0, true)).toBe(true);
  });

  it("holds for the resume delay after the last manual input, then releases", () => {
    expect(followSuppressed(10, 10, false)).toBe(true);
    expect(followSuppressed(10 + FOLLOW_RESUME_DELAY - 0.01, 10, false)).toBe(true);
    expect(followSuppressed(10 + FOLLOW_RESUME_DELAY, 10, false)).toBe(false);
    expect(followSuppressed(100, 10, false)).toBe(false);
  });

  it("never suppresses on non-finite clocks", () => {
    expect(followSuppressed(Number.NaN, 0, false)).toBe(false);
    expect(followSuppressed(0, Number.NaN, false)).toBe(false);
  });
});

describe("FollowHoldTracker", () => {
  it("starts idle and ignores releases of unknown contacts", () => {
    const hold = new FollowHoldTracker();
    expect(hold.userPanning).toBe(false);
    expect(hold.pointerUp(999)).toBe(false);
    expect(hold.userPanning).toBe(false);
  });

  it("holds while a right-button contact is down, ending on its release", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(2, 1, "mouse");
    expect(hold.userPanning).toBe(true);
    expect(hold.pointerUp(1)).toBe(true);
    expect(hold.userPanning).toBe(false);
    // A second release of the same contact ends nothing.
    expect(hold.pointerUp(1)).toBe(false);
  });

  it("ignores rotate/zoom contacts: left, middle, and pen barrel-less buttons", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(0, 1, "mouse");
    hold.pointerDown(1, 2, "mouse");
    hold.pointerDown(0, 3, "pen");
    expect(hold.userPanning).toBe(false);
    expect(hold.pointerUp(1)).toBe(false);
    expect(hold.pointerUp(2)).toBe(false);
    expect(hold.pointerUp(3)).toBe(false);
  });

  it("treats a pen right button like a mouse pan", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(2, 7, "pen");
    expect(hold.userPanning).toBe(true);
    expect(hold.pointerUp(7)).toBe(true);
  });

  it("treats a missing pointer type as a mouse (button decides)", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(2, 7, "");
    expect(hold.userPanning).toBe(true);
    expect(hold.pointerUp(7)).toBe(true);
  });

  it("holds only once two touch contacts are down (one finger rotates)", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(0, 10, "touch");
    expect(hold.userPanning).toBe(false);
    expect(hold.pointerUp(10)).toBe(false);
    hold.pointerDown(0, 10, "touch");
    hold.pointerDown(0, 11, "touch");
    expect(hold.userPanning).toBe(true);
    // Dropping back to one finger ends the pan hold.
    expect(hold.pointerUp(11)).toBe(true);
    expect(hold.userPanning).toBe(false);
    expect(hold.pointerUp(10)).toBe(false);
  });

  it("stays held while any pan contact remains", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(2, 1, "mouse");
    hold.pointerDown(0, 10, "touch");
    hold.pointerDown(0, 11, "touch");
    expect(hold.pointerUp(1)).toBe(false);
    expect(hold.userPanning).toBe(true);
    expect(hold.pointerUp(10)).toBe(true);
    expect(hold.userPanning).toBe(false);
  });

  it("a third touch finger keeps the hold when one lifts", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(0, 10, "touch");
    hold.pointerDown(0, 11, "touch");
    hold.pointerDown(0, 12, "touch");
    expect(hold.pointerUp(10)).toBe(false);
    expect(hold.userPanning).toBe(true);
  });

  it("reset drops every contact (suspend path)", () => {
    const hold = new FollowHoldTracker();
    hold.pointerDown(2, 1, "mouse");
    hold.pointerDown(0, 10, "touch");
    hold.reset();
    expect(hold.userPanning).toBe(false);
    expect(hold.pointerUp(1)).toBe(false);
    expect(hold.pointerUp(10)).toBe(false);
  });
});

describe("followBattleStep", () => {
  it("moves toward the centroid, closing most of the gap within ~2 s", () => {
    let tx = 0;
    let tz = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      const step = followBattleStep(tx, tz, 1000, 0, dt);
      tx += step.x;
      tz += step.z;
    }
    // 1 - exp(-2.5 * 2) ≈ 0.993 of the gap.
    expect(tx).toBeGreaterThan(990);
    expect(tx).toBeLessThanOrEqual(1000);
    expect(tz).toBe(0);
  });

  it("never overshoots, even on huge steps", () => {
    const step = followBattleStep(0, 0, 100, 60, 10);
    expect(step.x).toBeGreaterThan(0);
    expect(step.x).toBeLessThanOrEqual(100);
    expect(step.z).toBeGreaterThan(0);
    expect(step.z).toBeLessThanOrEqual(60);
  });

  it("rests inside the deadzone instead of micro-jittering", () => {
    expect(followBattleStep(0, 0, FOLLOW_DEADZONE, 0, 1 / 60)).toEqual({ x: 0, z: 0 });
    expect(followBattleStep(0, 0, 3, 4, 1 / 60)).toEqual({ x: 0, z: 0 });
  });

  it("returns zero on non-positive or non-finite inputs", () => {
    expect(followBattleStep(0, 0, 1000, 0, 0)).toEqual({ x: 0, z: 0 });
    expect(followBattleStep(0, 0, 1000, 0, -1)).toEqual({ x: 0, z: 0 });
    expect(followBattleStep(Number.NaN, 0, 1000, 0, 0.016)).toEqual({ x: 0, z: 0 });
    expect(followBattleStep(0, 0, Number.NaN, 0, 0.016)).toEqual({ x: 0, z: 0 });
  });
});
