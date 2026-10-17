import { describe, expect, it } from "vitest";
import { BattleClock } from "./battleClock";

describe("battle suspension", () => {
  it("freezes all active time during repeated folio frames, then resumes without catch-up", () => {
    const clock = new BattleClock();
    expect(clock.sample(0.02, false)).toEqual({ dt: 0.02, t: 0.02 });
    for (let i = 0; i < 600; i++) expect(clock.sample(1, true)).toBeNull();
    expect(clock.sample(0.02, false)).toEqual({ dt: 0.02, t: 0.04 });
  });
  it("composes folio and user pause without unpausing an already paused battle", () => {
    const clock = new BattleClock();
    const userPaused = true;
    expect(clock.sample(0.02, true || userPaused)).toBeNull();
    expect(clock.sample(0.02, false || userPaused)).toBeNull();
    expect(clock.sample(0.02, false)).toEqual({ dt: 0.02, t: 0.02 });
  });
  it("bounds long frames and rejects negative deltas", () => {
    const clock = new BattleClock();
    expect(clock.sample(15, false)).toEqual({ dt: 0.05, t: 0.05 });
    expect(clock.sample(-1, false)).toEqual({ dt: 0, t: 0.05 });
  });
});
