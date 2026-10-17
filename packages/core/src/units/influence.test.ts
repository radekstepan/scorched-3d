import { describe, expect, it } from "vitest";
import {
  createInfluenceField,
  factionColorBytes,
  influenceFreshness,
  INFLUENCE_CELL_WORLD,
  INFLUENCE_FRESH_SECONDS,
  INFLUENCE_RADIUS_WORLD,
  INFLUENCE_STALE_SECONDS,
  paintInfluence,
  stampInfluence,
  stampRoster,
  TERRITORY_MAX_ALPHA,
  type InfluenceUnit,
} from "./influence.js";

const WORLD_W = 5088;
const WORLD_D = 4064;
const BLUE = { r: 56, g: 189, b: 248 };
const ORANGE = { r: 251, g: 146, b: 60 };

function cellOf(field: ReturnType<typeof createInfluenceField>, x: number, z: number): number {
  const col = Math.floor(((x + field.worldW / 2) / field.worldW) * field.cols);
  const row = Math.floor(((z + field.worldD / 2) / field.worldD) * field.rows);
  return row * field.cols + col;
}

describe("influence field", () => {
  it("sizes a coarse grid off the world extent (tens of cells, not hundreds)", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    expect(field.cols).toBe(Math.round(WORLD_W / INFLUENCE_CELL_WORLD));
    expect(field.rows).toBe(Math.round(WORLD_D / INFLUENCE_CELL_WORLD));
    // Perf budget: the whole field stays a few thousand cells, so a full
    // repaint is microseconds and the texture upload is ~5 KB.
    expect(field.cols * field.rows).toBeLessThanOrEqual(4096);
  });

  it("stamps a disc around a unit for its team only", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    stampInfluence(field, 0, 0, 0, 10);
    const at = cellOf(field, 0, 0);
    expect(field.seen[0]![at]).toBe(10);
    expect(field.seen[1]![at]).toBeLessThan(0);
    // Well outside the radius stays unstamped.
    const far = cellOf(field, WORLD_W / 2 - 1, WORLD_D / 2 - 1);
    expect(field.seen[0]![far]).toBeLessThan(0);
  });

  it("ignores dead, missing, and off-map units when stamping a roster", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    const units: InfluenceUnit[] = [
      { x: 0, z: 0, team: 1, alive: true },
      { x: 0, z: 0, team: 0, alive: false },
      { x: Number.NaN, z: 0, team: 0, alive: true },
      { x: WORLD_W, z: WORLD_D, team: 0, alive: true },
    ];
    stampRoster(field, units, 5);
    const at = cellOf(field, 0, 0);
    expect(field.seen[1]![at]).toBe(5);
    expect(field.seen[0]![at]).toBeLessThan(0);
    // The off-map stamp lands nowhere (no throw, no wrap to cell 0).
    expect(field.seen[0]![0]).toBeLessThan(0);
  });

  it("restamps refresh the timestamp so presence never decays underfoot", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    stampInfluence(field, 0, 100, -50, 10);
    stampInfluence(field, 0, 100, -50, 70);
    expect(field.seen[0]![cellOf(field, 100, -50)]).toBe(70);
  });
});

describe("influence freshness", () => {
  it("holds full strength through the fresh window, then fades to zero at stale", () => {
    expect(influenceFreshness(100, 100)).toBe(1);
    expect(influenceFreshness(100, 100 + INFLUENCE_FRESH_SECONDS)).toBe(1);
    expect(influenceFreshness(100, 100 + INFLUENCE_STALE_SECONDS)).toBe(0);
    expect(influenceFreshness(100, 100 + INFLUENCE_STALE_SECONDS + 100)).toBe(0);
    expect(influenceFreshness(-1, 100)).toBe(0);
    // The -1 "never" sentinel must read stale even when `now` is small
    // (age = now + 1 would otherwise land inside the fade window).
    expect(influenceFreshness(-1, 0)).toBe(0);
    expect(influenceFreshness(-1, 5)).toBe(0);
    const mid = influenceFreshness(100, 100 + (INFLUENCE_FRESH_SECONDS + INFLUENCE_STALE_SECONDS) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it("never returns NaN for hostile inputs", () => {
    expect(influenceFreshness(Number.NaN, 10)).toBe(0);
    expect(influenceFreshness(10, Number.NaN)).toBe(0);
  });
});

describe("paintInfluence", () => {
  function paintAt(
    field: ReturnType<typeof createInfluenceField>,
    now: number,
    x: number,
    z: number,
  ): [number, number, number, number] {
    const out = new Uint8ClampedArray(field.cols * field.rows * 4);
    paintInfluence(field, now, out, [BLUE, ORANGE]);
    const col = Math.floor(((x + field.worldW / 2) / field.worldW) * field.cols);
    // Row 0 is north (top of the minimap) in both the field and the paint.
    const row = Math.floor(((z + field.worldD / 2) / field.worldD) * field.rows);
    const o = (row * field.cols + col) * 4;
    return [out[o]!, out[o + 1]!, out[o + 2]!, out[o + 3]!];
  }

  it("paints fresh single-team ground in the faction color at full alpha", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    stampInfluence(field, 0, 0, 0, 10);
    const [r, g, b, a] = paintAt(field, 10, 0, 0);
    expect([r, g, b]).toEqual([BLUE.r, BLUE.g, BLUE.b]);
    expect(a).toBe(Math.round(255 * TERRITORY_MAX_ALPHA));
  });

  it("blends the two faction colors on contested ground", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    stampInfluence(field, 0, 0, 0, 10);
    stampInfluence(field, 1, 0, 0, 10);
    const [r, g, b, a] = paintAt(field, 10, 0, 0);
    // Even strengths meet halfway between the factions.
    expect(r).toBe(Math.round((BLUE.r + ORANGE.r) / 2));
    expect(g).toBe(Math.round((BLUE.g + ORANGE.g) / 2));
    expect(b).toBe(Math.round((BLUE.b + ORANGE.b) / 2));
    expect(a).toBe(Math.round(255 * TERRITORY_MAX_ALPHA));
  });

  it("weights the contested blend toward the fresher side", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    stampInfluence(field, 0, 0, 0, 0);
    stampInfluence(field, 1, 0, 0, (INFLUENCE_FRESH_SECONDS + INFLUENCE_STALE_SECONDS) / 2);
    // Team 0 is half-faded, team 1 is fresh: the blend leans orange.
    const [r, , ,] = paintAt(field, (INFLUENCE_FRESH_SECONDS + INFLUENCE_STALE_SECONDS) / 2, 0, 0);
    expect(r).toBeGreaterThan((BLUE.r + ORANGE.r) / 2);
  });

  it("fades stale ground toward transparent instead of flipping it off", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    stampInfluence(field, 0, 0, 0, 0);
    const fresh = paintAt(field, 0, 0, 0)[3]!;
    const mid = paintAt(field, (INFLUENCE_FRESH_SECONDS + INFLUENCE_STALE_SECONDS) / 2, 0, 0)[3]!;
    const gone = paintAt(field, INFLUENCE_STALE_SECONDS + 1, 0, 0)[3]!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(fresh);
    expect(gone).toBe(0);
  });

  it("leaves never-visited ground fully transparent", () => {
    const field = createInfluenceField(WORLD_W, WORLD_D);
    const [, , , a] = paintAt(field, 100, 0, 0);
    expect(a).toBe(0);
  });

  it("pins the radius below the disengage bound so discs read local", () => {
    // A territory disc must read as "around a unit", not half the map.
    expect(INFLUENCE_RADIUS_WORLD).toBeLessThanOrEqual(512);
  });
});

describe("factionColorBytes", () => {
  it("matches the team def colors", () => {
    expect(factionColorBytes(0)).toEqual(BLUE);
    expect(factionColorBytes(1)).toEqual(ORANGE);
  });
});
