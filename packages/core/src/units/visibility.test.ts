import { describe, expect, it } from "vitest";
import { HUNT_ENGAGE_RADIUS, THREAT_DISENGAGE_RADIUS } from "./retaliation.js";
import { SCOUT_DISENGAGE_RADIUS, SCOUT_NOTICE_RADIUS, acquireStrategicHunt, chooseTarget } from "./strategy.js";
import type { TreeStand } from "./combat.js";
import { acquireHunt, type ThreatMemory } from "./retaliation.js";
import {
  SIGHT_ELEVATION_GAIN,
  SIGHT_ELEVATION_MAX_BONUS,
  SIGHT_FOREST_COST,
  SIGHT_FOREST_MAX_FRACTION,
  SIGHT_MIN_RANGE,
  STRUCTURE_SIGHT_LIFT,
  canSpot,
  canSpotPoint,
  effectiveNotice,
  elevationBonus,
  eyeHeight,
  eyeYFor,
  forestPenalty,
  sightClearsTerrain,
  type SightContext,
} from "./visibility.js";

const FLAT = 100;
const flatGround = (_x: number, _z: number): number => FLAT;

/** A standing tree seated on flat ground. */
function tree(x: number, z: number, standing = true): TreeStand {
  return { x, z, groundY: FLAT, standing };
}

describe("eyeHeight", () => {
  it("puts the walker head above every hull and the scout lowest", () => {
    expect(eyeHeight("commander")).toBeGreaterThan(eyeHeight("hammer"));
    expect(eyeHeight("hammer")).toBeGreaterThan(eyeHeight("stump"));
    expect(eyeHeight("stump")).toBeGreaterThan(eyeHeight("flash"));
    expect(eyeHeight("flash")).toBeGreaterThan(eyeHeight("peewee"));
  });

  it("reads unknown kinds as a low hull, never NaN", () => {
    expect(eyeHeight(undefined)).toBe(12);
    expect(eyeHeight(null)).toBe(12);
    expect(Number.isFinite(eyeHeight(undefined))).toBe(true);
  });
});

describe("elevationBonus", () => {
  it("is zero on level ground or looking up", () => {
    expect(elevationBonus(112, 112)).toBe(0);
    expect(elevationBonus(100, 150)).toBe(0);
  });

  it("grows with the height advantage and caps", () => {
    expect(elevationBonus(112 + 30, 112)).toBe(30 * SIGHT_ELEVATION_GAIN);
    expect(elevationBonus(112 + 1000, 112)).toBe(SIGHT_ELEVATION_MAX_BONUS);
  });

  it("keeps the elevated gate inside the disengage bound on both scales", () => {
    expect(HUNT_ENGAGE_RADIUS + SIGHT_ELEVATION_MAX_BONUS).toBeLessThan(THREAT_DISENGAGE_RADIUS);
    expect(SCOUT_NOTICE_RADIUS + SIGHT_ELEVATION_MAX_BONUS).toBeLessThan(SCOUT_DISENGAGE_RADIUS);
  });
});

describe("forestPenalty", () => {
  it("is zero on open ground", () => {
    expect(forestPenalty(0, HUNT_ENGAGE_RADIUS)).toBe(0);
    expect(forestPenalty(-2, HUNT_ENGAGE_RADIUS)).toBe(0);
  });

  it("costs per crossed tree, capped at a base fraction", () => {
    expect(forestPenalty(2, HUNT_ENGAGE_RADIUS)).toBe(2 * SIGHT_FOREST_COST);
    expect(forestPenalty(100, HUNT_ENGAGE_RADIUS)).toBe(
      HUNT_ENGAGE_RADIUS * SIGHT_FOREST_MAX_FRACTION,
    );
  });
});

describe("effectiveNotice", () => {
  it("is the base gate on level open ground", () => {
    expect(effectiveNotice(HUNT_ENGAGE_RADIUS, 112, 112, 0)).toBe(HUNT_ENGAGE_RADIUS);
  });

  it("adds high ground and subtracts wood", () => {
    expect(effectiveNotice(HUNT_ENGAGE_RADIUS, 112 + 50, 112, 2)).toBe(
      HUNT_ENGAGE_RADIUS + 50 * SIGHT_ELEVATION_GAIN - 2 * SIGHT_FOREST_COST,
    );
  });

  it("floors at point-blank range but never expands a tighter gate", () => {
    // A mid-size gate shaded past the floor still holds point-blank range.
    expect(effectiveNotice(300, 112, 112, 100)).toBe(SIGHT_MIN_RANGE);
    // ...while a tighter caller gate is never expanded by the floor.
    expect(effectiveNotice(100, 112, 112, 100)).toBe(100);
    // The full hunt gate bottoms out at the forest cap, above the floor.
    expect(effectiveNotice(HUNT_ENGAGE_RADIUS, 112, 112, 100)).toBe(
      HUNT_ENGAGE_RADIUS * (1 - SIGHT_FOREST_MAX_FRACTION),
    );
  });

  it("is zero without a base gate", () => {
    expect(effectiveNotice(0, 200, 100, 0)).toBe(0);
  });
});

describe("eyeYFor", () => {
  const positions = [
    { x: 0, z: 0 },
    { x: 500, z: 0 },
  ];

  it("prefers the explicit eye entry", () => {
    const sight: SightContext = { groundY: flatGround, eyeY: [250, undefined] };
    expect(eyeYFor(0, positions, sight, "flash")).toBe(250);
  });

  it("seats the kind's eyes on the live ground", () => {
    const sight: SightContext = { groundY: flatGround, kinds: ["commander", "peewee"] };
    expect(eyeYFor(0, positions, sight)).toBe(FLAT + eyeHeight("commander"));
    expect(eyeYFor(1, positions, sight)).toBe(FLAT + eyeHeight("peewee"));
  });

  it("falls back to the caller roster kind, then a low hull", () => {
    const sight: SightContext = { groundY: flatGround };
    expect(eyeYFor(0, positions, sight, "hammer")).toBe(FLAT + eyeHeight("hammer"));
    expect(eyeYFor(0, positions, sight)).toBe(FLAT + eyeHeight(undefined));
  });
});

describe("sightClearsTerrain", () => {
  it("clears over flat ground", () => {
    expect(
      sightClearsTerrain({ x: 0, y: 112, z: 0 }, { x: 1000, y: 112, z: 0 }, flatGround),
    ).toBe(true);
  });

  it("is blocked by a ridge between the eyes", () => {
    const ridge = (x: number, _z: number): number => (x > 400 && x < 600 ? 300 : FLAT);
    expect(sightClearsTerrain({ x: 0, y: 112, z: 0 }, { x: 1000, y: 112, z: 0 }, ridge)).toBe(
      false,
    );
  });

  it("clears a gentle swell inside the graze", () => {
    const swell = (x: number, _z: number): number => (x > 400 && x < 600 ? FLAT + 5 : FLAT);
    expect(sightClearsTerrain({ x: 0, y: 112, z: 0 }, { x: 1000, y: 112, z: 0 }, swell)).toBe(
      true,
    );
  });

  it("lets high eyes see over a low rise", () => {
    const rise = (x: number, _z: number): number => (x > 400 && x < 600 ? FLAT + 30 : FLAT);
    // Eye-to-eye line at ~112 dips into the 130 rise: blocked.
    expect(sightClearsTerrain({ x: 0, y: 112, z: 0 }, { x: 1000, y: 112, z: 0 }, rise)).toBe(
      false,
    );
    // A ridge-top observer looks clean over it.
    expect(sightClearsTerrain({ x: 0, y: 260, z: 0 }, { x: 1000, y: 112, z: 0 }, rise)).toBe(
      true,
    );
  });

  it("refuses non-finite endpoints", () => {
    expect(
      sightClearsTerrain({ x: 0, y: Number.NaN, z: 0 }, { x: 1000, y: 112, z: 0 }, flatGround),
    ).toBe(false);
  });
});

describe("canSpot", () => {
  const positions = [
    { x: 0, z: 0 },
    { x: 1000, z: 0 },
  ];
  const open: SightContext = { groundY: flatGround };

  it("matches the distance gate on level open ground", () => {
    expect(canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, open, ["flash", "flash"])).toBe(true);
    const far = [
      { x: 0, z: 0 },
      { x: HUNT_ENGAGE_RADIUS + 1, z: 0 },
    ];
    expect(canSpot(0, 1, far, HUNT_ENGAGE_RADIUS, open, ["flash", "flash"])).toBe(false);
  });

  it("extends past the base gate from high ground", () => {
    const hill = (x: number, _z: number): number => (x < 100 ? FLAT + 80 : FLAT);
    const sight: SightContext = { groundY: hill };
    const at = [
      { x: 0, z: 0 },
      { x: HUNT_ENGAGE_RADIUS + 100, z: 0 },
    ];
    // +80 of height buys the capped +140: 1200 < 1240 spots.
    expect(canSpot(0, 1, at, HUNT_ENGAGE_RADIUS, sight, ["flash", "flash"])).toBe(true);
    // Low ground looking up at the same pair earns nothing.
    expect(canSpot(1, 0, at, HUNT_ENGAGE_RADIUS, sight, ["flash", "flash"])).toBe(false);
  });

  it("cannot see through a mountain at any range", () => {
    const mountain = (x: number, _z: number): number => (x > 200 && x < 400 ? 400 : FLAT);
    const sight: SightContext = { groundY: mountain };
    const near = [
      { x: 0, z: 0 },
      { x: 500, z: 0 },
    ];
    expect(canSpot(0, 1, near, HUNT_ENGAGE_RADIUS, sight, ["flash", "flash"])).toBe(false);
  });

  it("shrinks through thick forest but holds point-blank", () => {
    const woods = [tree(200, 0), tree(300, 0), tree(400, 0), tree(500, 0), tree(600, 0)];
    const sight: SightContext = { groundY: flatGround, trees: woods };
    // Five crowns on the line cost 300: a foe at 900 hides, one at 700 shows.
    const far = [
      { x: 0, z: 0 },
      { x: 900, z: 0 },
    ];
    expect(canSpot(0, 1, far, HUNT_ENGAGE_RADIUS, sight, ["flash", "flash"])).toBe(false);
    const mid = [
      { x: 0, z: 0 },
      { x: 700, z: 0 },
    ];
    expect(canSpot(0, 1, mid, HUNT_ENGAGE_RADIUS, sight, ["flash", "flash"])).toBe(true);
    // Point-blank is heard through any wood.
    const dense = Array.from({ length: 20 }, (_, i) => tree(10 + i * 5, 0));
    const close = [
      { x: 0, z: 0 },
      { x: 150, z: 0 },
    ];
    expect(
      canSpot(0, 1, close, HUNT_ENGAGE_RADIUS, { groundY: flatGround, trees: dense }, [
        "flash",
        "flash",
      ]),
    ).toBe(true);
  });

  it("ignores felled wood", () => {
    const stumps = [tree(200, 0, false), tree(300, 0, false), tree(400, 0, false)];
    const sight: SightContext = { groundY: flatGround, trees: stumps };
    expect(canSpot(0, 1, positions, HUNT_ENGAGE_RADIUS, sight, ["flash", "flash"])).toBe(true);
  });

  it("refuses bad inputs", () => {
    expect(canSpot(0, 1, positions, 0, open)).toBe(false);
    expect(canSpot(0, 5, positions, HUNT_ENGAGE_RADIUS, open)).toBe(false);
    expect(
      canSpot(0, 1, [{ x: 0, z: 0 }, { x: Number.NaN, z: 0 }], HUNT_ENGAGE_RADIUS, open),
    ).toBe(false);
  });
});

describe("canSpotPoint", () => {
  it("spots a fort on open ground and loses it behind a ridge", () => {
    const positions = [{ x: 0, z: 0 }];
    const fortY = FLAT + STRUCTURE_SIGHT_LIFT;
    expect(canSpotPoint(0, positions, 900, 0, fortY, HUNT_ENGAGE_RADIUS, { groundY: flatGround })).toBe(
      true,
    );
    const ridge = (x: number, _z: number): number => (x > 300 && x < 600 ? 400 : FLAT);
    expect(canSpotPoint(0, positions, 900, 0, fortY, HUNT_ENGAGE_RADIUS, { groundY: ridge })).toBe(
      false,
    );
  });
});

describe("sight-gated acquisition", () => {
  const idle = (): { threat?: ThreatMemory } => ({});
  const teams = [0, 1, 1];
  const alive = [true, true, true];

  it("acquireHunt skips a nearer hidden foe for a farther spotted one", () => {
    const foes = [
      { x: 0, z: 0 },
      { x: 500, z: 0 },
      { x: 700, z: 500 },
    ];
    // A wall hides the near foe's lane only (the far lane runs clear of it).
    const wall = (x: number, z: number): number =>
      x > 200 && x < 400 && Math.abs(z) < 100 ? 400 : FLAT;
    const next = acquireHunt(idle(), 0, teams, foes, alive, null, { groundY: wall });
    expect(next.threat?.attacker).toBe(2);
  });

  it("acquireHunt keeps the legacy pick without sight", () => {
    const foes = [
      { x: 0, z: 0 },
      { x: 500, z: 0 },
      { x: 700, z: 500 },
    ];
    expect(acquireHunt(idle(), 0, teams, foes, alive, null).threat?.attacker).toBe(1);
  });

  it("chooseTarget admits high-ground quarries past the base gate", () => {
    const foes = [
      { x: 0, z: 0 },
      { x: HUNT_ENGAGE_RADIUS + 100, z: 0 },
    ];
    const hill = (x: number, _z: number): number => (x < 100 ? FLAT + 80 : FLAT);
    const sight: SightContext = { groundY: hill };
    expect(
      chooseTarget(0, foes, [0, 1], [true, true], { sight, kinds: ["flash", "flash"] }),
    ).toBe(1);
    // Same pair on the flat is beneath notice.
    expect(chooseTarget(0, foes, [0, 1], [true, true])).toBe(-1);
  });

  it("acquireStrategicHunt refuses a mountain-hidden column", () => {
    const foes = [
      { x: 0, z: 0 },
      { x: 600, z: 0 },
    ];
    const mountain = (x: number, _z: number): number => (x > 200 && x < 400 ? 400 : FLAT);
    const sight: SightContext = { groundY: mountain };
    const kinds = ["flash", "flash"] as const;
    const next = acquireStrategicHunt(
      idle(), 0, [0, 1], foes, [true, true], null, null, null, kinds, sight,
    );
    expect(next.threat).toBeUndefined();
    // Without sight the same pair acquires.
    const legacy = acquireStrategicHunt(idle(), 0, [0, 1], foes, [true, true], null, null, null, kinds);
    expect(legacy.threat?.attacker).toBe(1);
  });
});
