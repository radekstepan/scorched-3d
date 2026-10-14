import { describe, expect, it } from "vitest";
import {
  addScorchMark,
  BLAST_RADIUS,
  indicesInBlast,
  MAX_FELLED_PER_BLAST,
  MAX_SCORCH_MARKS,
  scorchForKind,
  type ScorchMark,
} from "./destruction";

describe("scorchForKind", () => {
  it("scars widest and darkest for artillery shells", () => {
    const shell = scorchForKind("hammer");
    for (const kind of ["flash", "stump", "commander"] as const) {
      const other = scorchForKind(kind);
      expect(shell.radius).toBeGreaterThan(other.radius);
      expect(shell.intensity).toBeGreaterThanOrEqual(other.intensity);
    }
  });

  it("stays in sane bounds for every kind", () => {
    for (const kind of ["flash", "stump", "hammer", "commander"] as const) {
      const s = scorchForKind(kind);
      expect(s.radius).toBeGreaterThan(0);
      expect(s.intensity).toBeGreaterThan(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });
});

describe("BLAST_RADIUS", () => {
  it("gives artillery the widest fell radius", () => {
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.stump);
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.flash);
    expect(BLAST_RADIUS.hammer).toBeGreaterThan(BLAST_RADIUS.commander);
  });
});

describe("addScorchMark", () => {
  const mark = (x: number): ScorchMark => ({ x, z: 0, radius: 24, intensity: 0.6 });

  it("appends without mutating the input", () => {
    const before: ScorchMark[] = [mark(1)];
    const after = addScorchMark(before, mark(2));
    expect(after).toHaveLength(2);
    expect(before).toHaveLength(1);
  });

  it("evicts the oldest mark at cap, keeping the newest", () => {
    let marks: ScorchMark[] = [];
    for (let i = 0; i < MAX_SCORCH_MARKS + 5; i++) marks = addScorchMark(marks, mark(i));
    expect(marks).toHaveLength(MAX_SCORCH_MARKS);
    // The first five (x = 0..4) were evicted; x = 5 is now oldest.
    expect(marks[0]!.x).toBe(5);
    expect(marks[marks.length - 1]!.x).toBe(MAX_SCORCH_MARKS + 4);
  });
});

describe("indicesInBlast", () => {
  const points = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 0, z: 30 },
    { x: 100, z: 100 },
  ];

  it("returns ascending indices inside the radius", () => {
    expect(indicesInBlast(points, 0, 0, 30)).toEqual([0, 1, 2]);
    expect(indicesInBlast(points, 0, 0, 5)).toEqual([0]);
  });

  it("returns empty for misses and degenerate inputs", () => {
    expect(indicesInBlast(points, 500, 500, 10)).toEqual([]);
    expect(indicesInBlast(points, 0, 0, 0)).toEqual([]);
    expect(indicesInBlast(points, 0, 0, -4)).toEqual([]);
    expect(indicesInBlast(points, 0, 0, 30, 0)).toEqual([]);
    expect(indicesInBlast([], 0, 0, 30)).toEqual([]);
  });

  it("caps at the nearest entries first", () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, z: 0 }));
    const got = indicesInBlast(line, 0, 0, 1000);
    expect(got).toHaveLength(MAX_FELLED_PER_BLAST);
    // Nearest-first: 0, 1, 2, ... up to the cap.
    expect(got).toEqual(Array.from({ length: MAX_FELLED_PER_BLAST }, (_, i) => i));
  });
});
