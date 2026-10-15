import { describe, expect, it, vi } from "vitest";
import { TEAM_DEFS, UNIT_KINDS } from "@scorched-3d/core";
import {
  clearUnitIconCache,
  getUnitIconDataUrl,
  groupSelection,
  preloadUnitIcons,
  scheduleUnitIconPreload,
  selectionGroupColor,
  unitIconCameraPos,
  unitIconCacheSize,
  unitIconFraming,
  UNIT_ICON_CAM_DIR,
} from "./selectionIcons";

describe("selection tray icons (pre-rendered once, reused)", () => {
  it("memoizes one data URL per kind", () => {
    clearUnitIconCache();
    expect(unitIconCacheSize()).toBe(0);
    const a = getUnitIconDataUrl("stump");
    const b = getUnitIconDataUrl("stump");
    expect(a).toBe(b);
    expect(a.startsWith("data:image/")).toBe(true);
    expect(unitIconCacheSize()).toBe(1);
    getUnitIconDataUrl("flash");
    expect(unitIconCacheSize()).toBe(2);
    clearUnitIconCache();
  });

  it("renders distinct icons per kind", () => {
    clearUnitIconCache();
    const urls = new Set(UNIT_KINDS.map((k) => getUnitIconDataUrl(k)));
    expect(urls.size).toBe(UNIT_KINDS.length);
    clearUnitIconCache();
  });

  it("renders side-view silhouettes (flank + wheels / walker legs, not top-down discs)", () => {
    clearUnitIconCache();
    // Headless fallback is the side-view SVG: flank rects + wheel circles
    // for tanks, leg rects for the walker — never the old top-down
    // turret-disc + forward barrel-line composition.
    for (const kind of UNIT_KINDS) {
      const raw = decodeURIComponent(getUnitIconDataUrl(kind));
      if (kind === "commander") {
        expect(raw).toContain('y="24" width="4" height="10"');
        expect(raw).not.toContain("<circle");
      } else if (kind === "peewee") {
        // Infantry scout flank: short leg rects + small torso, no wheels.
        expect(raw).toContain('y="27" width="3" height="7"');
        expect(raw).not.toContain("<circle");
      } else {
        // Tracked flank: hull side rect + three road-wheel circles +
        // a side-reading (horizontal / climbing) barrel line.
        expect(raw).toContain("<circle");
        expect(raw).toContain("<line");
      }
    }
    clearUnitIconCache();
  });

  it("frames thumbnails from the side and somewhat from above", () => {
    // Camera direction is side-dominant (+X), elevated (+Y), slight +Z.
    expect(UNIT_ICON_CAM_DIR.x).toBeGreaterThan(0.5);
    expect(UNIT_ICON_CAM_DIR.y).toBeGreaterThan(0.3);
    expect(UNIT_ICON_CAM_DIR.y).toBeLessThan(UNIT_ICON_CAM_DIR.x);
    for (const kind of UNIT_KINDS) {
      const framing = unitIconFraming(kind);
      expect(framing.distance).toBeGreaterThan(80);
      expect(framing.targetY).toBeGreaterThanOrEqual(8);
      const pos = unitIconCameraPos(framing);
      // Side view: |x| dominates; above: y sits over the hull top.
      expect(Math.abs(pos.x)).toBeGreaterThan(Math.abs(pos.z) * 2);
      expect(pos.y).toBeGreaterThan(framing.targetY + 20);
    }
    // Tall walker frames higher, long gun pulls back further.
    expect(unitIconFraming("commander").targetY).toBeGreaterThan(
      unitIconFraming("flash").targetY,
    );
    expect(unitIconFraming("hammer").distance).toBeGreaterThan(
      unitIconFraming("flash").distance,
    );
  });
});

describe("preloadUnitIcons (cache on load)", () => {
  it("caches every kind up front and returns the count", () => {
    clearUnitIconCache();
    expect(preloadUnitIcons()).toBe(UNIT_KINDS.length);
    expect(unitIconCacheSize()).toBe(UNIT_KINDS.length);
    // Second sweep is pure cache hits (same URLs, no re-render).
    const before = UNIT_KINDS.map((k) => getUnitIconDataUrl(k));
    expect(preloadUnitIcons()).toBe(UNIT_KINDS.length);
    expect(UNIT_KINDS.map((k) => getUnitIconDataUrl(k))).toEqual(before);
    clearUnitIconCache();
  });

  it("scheduleUnitIconPreload fills the cache without blocking (one per tick)", async () => {
    clearUnitIconCache();
    vi.useFakeTimers();
    try {
      scheduleUnitIconPreload();
      // Idle-chunked: nothing (or at most the first) renders synchronously.
      expect(unitIconCacheSize()).toBeLessThanOrEqual(1);
      // Drain the timeout chain (no requestIdleCallback under node).
      for (let n = 0; n < UNIT_KINDS.length + 1; n++) await vi.runAllTimersAsync();
      expect(unitIconCacheSize()).toBe(UNIT_KINDS.length);
      // A second schedule after a full cache is a no-op.
      scheduleUnitIconPreload();
      await vi.runAllTimersAsync();
      expect(unitIconCacheSize()).toBe(UNIT_KINDS.length);
    } finally {
      vi.useRealTimers();
      clearUnitIconCache();
    }
  });
});

describe("groupSelection (tray boxes)", () => {
  const units = [
    { kind: "stump" as const, team: 0 as const },
    { kind: "stump" as const, team: 0 as const },
    { kind: "flash" as const, team: 0 as const },
    { kind: "stump" as const, team: 1 as const },
  ];

  it("groups by kind+team with counts, deterministic order", () => {
    expect(groupSelection(units, [])).toEqual([]);
    const groups = groupSelection(units, [3, 0, 1, 2]);
    expect(groups.map((g) => [g.kind, g.team, g.count])).toEqual([
      ["stump", 0, 2],
      ["stump", 1, 1],
      ["flash", 0, 1],
    ]);
    expect(groups[0]!.indices).toEqual([0, 1]);
  });

  it("skips unknown indices and defaults missing teams to 0", () => {
    const mixed = [{ kind: "hammer" as const }, ...units];
    expect(groupSelection(mixed, [0, 99, -1])).toEqual([
      { kind: "hammer", team: 0, count: 1, indices: [0] },
    ]);
  });
});

describe("selectionGroupColor (tray border team colors)", () => {
  it("uses the TEAM_DEFS colors", () => {
    for (const t of [0, 1] as const) {
      expect(selectionGroupColor(t)).toBe(
        `#${TEAM_DEFS[t].color.toString(16).padStart(6, "0")}`,
      );
    }
  });
});
