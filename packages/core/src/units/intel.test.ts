import { describe, expect, it } from "vitest";
import {
  fortIntelKey,
  fortIntelTeam,
  hasIntel,
  INTEL_CONFIRM_RADIUS,
  INTEL_MEMORY_DURATION,
  isFortIntelKey,
  nearestIntel,
  rememberSighting,
  sweepIntel,
  type IntelBoard,
} from "./intel.js";

function locateLive(subjects: Map<number, { x: number; z: number } | null>) {
  return (_team: number, key: number) => subjects.get(key) ?? null;
}

describe("fort keys", () => {
  it("keys one fort per HQ team, disjoint from hull keys", () => {
    expect(fortIntelKey(0)).toBe(-1);
    expect(fortIntelKey(1)).toBe(-2);
    expect(isFortIntelKey(-1)).toBe(true);
    expect(isFortIntelKey(-2)).toBe(true);
    expect(isFortIntelKey(0)).toBe(false);
    expect(isFortIntelKey(7)).toBe(false);
    expect(isFortIntelKey(NaN)).toBe(false);
    expect(fortIntelTeam(-1)).toBe(0);
    expect(fortIntelTeam(-2)).toBe(1);
    expect(fortIntelTeam(3)).toBeNull();
  });

  it("refuses invalid teams and keys", () => {
    expect(fortIntelKey(-1)).toBeNull();
    expect(fortIntelKey(1.5)).toBeNull();
    expect(fortIntelKey(NaN)).toBeNull();
    expect(fortIntelTeam(NaN)).toBeNull();
  });
});

describe("rememberSighting / hasIntel", () => {
  it("records a sighting per enemy and refreshes it in place", () => {
    const board: IntelBoard = new Map();
    expect(hasIntel(board, 0)).toBe(false);
    rememberSighting(board, 0, 2, 500, 300, 10);
    rememberSighting(board, 0, 3, -400, 100, 10);
    expect(hasIntel(board, 0)).toBe(true);
    expect(hasIntel(board, 1)).toBe(false);
    expect(board.get(0)?.get(2)).toEqual({ x: 500, z: 300, seenAt: 10 });
    // Fresh information wins: the position and the clock move, the side
    // keeps one record per enemy instead of stacking.
    rememberSighting(board, 0, 2, 520, 320, 25);
    expect(board.get(0)?.size).toBe(2);
    expect(board.get(0)?.get(2)).toEqual({ x: 520, z: 320, seenAt: 25 });
  });

  it("marks fort records as structures", () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, fortIntelKey(1)!, 1300, 0, 10, true);
    expect(board.get(0)?.get(-2)).toEqual({ x: 1300, z: 0, seenAt: 10, structure: true });
  });

  it("refuses junk without touching the board", () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, 2, 500, 300, 10);
    const before = board.get(0)?.get(2);
    rememberSighting(board, -1, 2, 1, 1, 11);
    rememberSighting(board, 0, 1.5, 1, 1, 11);
    rememberSighting(board, 0, 2, NaN, 1, 11);
    rememberSighting(board, 0, 2, 1, Number.POSITIVE_INFINITY, 11);
    rememberSighting(board, 0, 2, 1, 1, NaN);
    rememberSighting(null as unknown as IntelBoard, 0, 2, 1, 1, 11);
    expect(board.get(0)?.get(2)).toEqual(before);
    expect(board.size).toBe(1);
    expect(hasIntel(null as unknown as IntelBoard, 0)).toBe(false);
    expect(hasIntel(board, -1)).toBe(false);
  });
});

describe("nearestIntel", () => {
  it("names the nearest remembered contact", () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, 2, 500, 0, 10);
    rememberSighting(board, 0, 3, -1500, 0, 10);
    expect(nearestIntel(board, 0, -2800, 0)).toEqual({ key: 3, x: -1500, z: 0 });
    expect(nearestIntel(board, 0, 1900, 0)).toEqual({ key: 2, x: 500, z: 0 });
  });

  it("gates contacts past the anchor leash", () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, 2, 3700, 0, 10);
    rememberSighting(board, 0, 3, 1000, 0, 10);
    expect(nearestIntel(board, 0, 0, 0, { anchor: { x: 0, z: 0 }, leash: 3500 })).toEqual({
      key: 3,
      x: 1000,
      z: 0,
    });
    expect(nearestIntel(board, 0, 3600, 0, { anchor: { x: 0, z: 0 }, leash: 3500 })).toEqual({
      key: 3,
      x: 1000,
      z: 0,
    });
  });

  it("breaks distance ties to the lowest key and skips corrupt records", () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, 5, 100, 0, 10);
    rememberSighting(board, 0, 2, -100, 0, 10);
    expect(nearestIntel(board, 0, 0, 0)).toEqual({ key: 2, x: -100, z: 0 });
    board.get(0)?.set(1, { x: NaN, z: 0, seenAt: 10 });
    expect(nearestIntel(board, 0, 0, 0)).toEqual({ key: 2, x: -100, z: 0 });
  });

  it("returns null when the side knows nothing usable", () => {
    const board: IntelBoard = new Map();
    expect(nearestIntel(board, 0, 0, 0)).toBeNull();
    rememberSighting(board, 1, 2, 500, 0, 10);
    expect(nearestIntel(board, 0, 0, 0)).toBeNull();
    expect(nearestIntel(board, 1, NaN, 0)).toBeNull();
    expect(nearestIntel(null as unknown as IntelBoard, 1, 0, 0)).toBeNull();
  });
});

describe("sweepIntel", () => {
  const teams = [0, 0, 1];
  const positions = [
    { x: 0, z: 0 },
    { x: -2000, z: 0 },
    { x: 500, z: 0 },
  ];
  const alive = [true, true, true];

  it(`expires mobiles unseen for ${INTEL_MEMORY_DURATION} s, keeps fresh ones`, () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, 2, 500, 0, 0);
    sweepIntel(board, INTEL_MEMORY_DURATION, teams, positions, alive, locateLive(new Map([[2, { x: 500, z: 0 }]])));
    expect(hasIntel(board, 0)).toBe(true);
    sweepIntel(
      board,
      INTEL_MEMORY_DURATION + 0.001,
      teams,
      positions,
      alive,
      locateLive(new Map([[2, { x: 500, z: 0 }]])),
    );
    expect(hasIntel(board, 0)).toBe(false);
    expect(board.has(0)).toBe(false);
  });

  it("never expires forts: a works does not move", () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, fortIntelKey(1)!, 1300, 0, 0, true);
    sweepIntel(
      board,
      INTEL_MEMORY_DURATION * 100,
      teams,
      positions,
      alive,
      locateLive(new Map([[-2, { x: 1300, z: 0 }]])),
    );
    expect(board.get(0)?.get(-2)).toEqual({ x: 1300, z: 0, seenAt: 0, structure: true });
  });

  it("drops records whose subject is gone (dead hulls, wrecked forts)", () => {
    const board: IntelBoard = new Map();
    rememberSighting(board, 0, 2, 500, 0, 50);
    rememberSighting(board, 0, fortIntelKey(1)!, 1300, 0, 50, true);
    sweepIntel(board, 51, teams, positions, alive, locateLive(new Map()));
    expect(hasIntel(board, 0)).toBe(false);
  });

  it("confirms gone: a mate at the spot finds the subject moved on", () => {
    const board: IntelBoard = new Map();
    // Stale firing position next to a teammate, live subject far away.
    rememberSighting(board, 0, 2, 10, 0, 50);
    sweepIntel(
      board,
      51,
      teams,
      positions,
      alive,
      locateLive(new Map([[2, { x: 2000, z: 0 }]])),
      INTEL_MEMORY_DURATION,
      INTEL_CONFIRM_RADIUS,
    );
    expect(hasIntel(board, 0)).toBe(false);
  });

  it("keeps the record while the subject holds its spot or nobody re-checks", () => {
    const subjects = new Map([[2, { x: 500, z: 0 }]]);
    // The subject still sits at the remembered spot: a neighbour at the
    // spot re-confirms it instead of forgetting it.
    const held: IntelBoard = new Map();
    rememberSighting(held, 0, 2, 500, 0, 50);
    sweepIntel(held, 51, [0, 1], [{ x: 510, z: 0 }, { x: 500, z: 0 }], [true, true], locateLive(subjects));
    expect(hasIntel(held, 0)).toBe(true);
    // The subject moved on but no teammate is near the old spot: the
    // memory stands until someone looks (or it ages out).
    const unvisited: IntelBoard = new Map();
    rememberSighting(unvisited, 0, 2, 10, 0, 50);
    sweepIntel(
      unvisited,
      51,
      [0, 1],
      [
        { x: -2000, z: 0 },
        { x: 2000, z: 0 },
      ],
      [true, true],
      locateLive(new Map([[2, { x: 2000, z: 0 }]])),
    );
    expect(hasIntel(unvisited, 0)).toBe(true);
  });

  it("drops corrupt records and refuses junk sweeps", () => {
    const board: IntelBoard = new Map();
    board.set(0, new Map([[2, { x: NaN, z: 0, seenAt: 50 }]]));
    sweepIntel(board, 51, teams, positions, alive, locateLive(new Map([[2, { x: 500, z: 0 }]])));
    expect(board.has(0)).toBe(false);
    const kept: IntelBoard = new Map();
    rememberSighting(kept, 0, 2, 500, 0, 50);
    sweepIntel(kept, NaN, teams, positions, alive, locateLive(new Map()));
    sweepIntel(null as unknown as IntelBoard, 51, teams, positions, alive, locateLive(new Map()));
    expect(hasIntel(kept, 0)).toBe(true);
  });
});
