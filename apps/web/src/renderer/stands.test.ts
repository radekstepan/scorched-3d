import { describe, expect, it } from "vitest";
import { createDamageField, crushTree } from "@scorched-3d/core";
import { StandsCache } from "./stands";

const points = [
  { x: -100, z: -100 },
  { x: 0, z: 0 },
  { x: 100, z: 50 },
];

describe("StandsCache", () => {
  it("builds lazily once and shares the array while clean", () => {
    const field = createDamageField(points.length, 0);
    let probes = 0;
    const cache = new StandsCache(points, field, (x, z) => {
      probes++;
      return x + z;
    });
    // Lazy: nothing built until the first read.
    expect(probes).toBe(0);
    const first = cache.get();
    expect(probes).toBe(points.length);
    expect(first).toHaveLength(points.length);
    expect(first[1]).toEqual({ x: 0, z: 0, groundY: 0, standing: true });
    // Clean re-reads share the identical array with zero new probes.
    expect(cache.get()).toBe(first);
    expect(cache.get()).toBe(first);
    expect(probes).toBe(points.length);
  });

  it("marks burning/smouldering standing and felled/gone fallen", () => {
    const field = createDamageField(4, 0);
    field.trees[1] = "burning";
    field.trees[2] = "smouldering";
    field.trees[3] = "toppled";
    const cache = new StandsCache(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 20, z: 0 },
        { x: 30, z: 0 },
      ],
      field,
      () => 100,
    );
    expect(cache.get().map((s) => s.standing)).toEqual([true, true, true, false]);
  });

  it("rebuilds on dirty: fells, crater heights, and resnaps all surface", () => {
    const field = createDamageField(points.length, 0);
    let lift = 0;
    const cache = new StandsCache(points, field, (x, z) => x + z + lift);
    const before = cache.get();
    expect(before[0]).toMatchObject({ groundY: -200, standing: true });
    // Fell + crater-dent under the first tree, then dirty once.
    crushTree(field, 0);
    lift = 25;
    cache.dirty();
    const after = cache.get();
    expect(after).not.toBe(before);
    expect(after[0]).toMatchObject({ groundY: -175, standing: false });
    expect(after[1]).toMatchObject({ groundY: 25, standing: true });
    // Clean again: shares until the next dirty.
    expect(cache.get()).toBe(after);
  });

  it("reflects nothing while dirty is skipped (callers own invalidation)", () => {
    // The cache cannot see damage-field writes by itself — this pins that a
    // fell without dirty() keeps serving the pre-fell snapshot, so a future
    // caller that forgets to dirty fails loudly here by analogy, not silently
    // in the field. (All production mutation sites dirty; see the canvas.)
    const field = createDamageField(points.length, 0);
    const cache = new StandsCache(points, field, () => 100);
    const snap = cache.get();
    crushTree(field, 0);
    expect(cache.get()).toBe(snap);
    expect(cache.get()[0]!.standing).toBe(true);
    cache.dirty();
    expect(cache.get()[0]!.standing).toBe(false);
  });

  it("handles an empty forest", () => {
    const field = createDamageField(0, 0);
    const cache = new StandsCache([], field, () => 100);
    expect(cache.get()).toEqual([]);
  });
});
