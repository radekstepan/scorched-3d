import { describe, expect, it } from "vitest";
import { TEAM_DEFS, UNIT_KINDS } from "@scorched-3d/core";
import {
  clearUnitIconCache,
  getUnitIconDataUrl,
  groupSelection,
  selectionGroupColor,
  unitIconCacheSize,
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

describe("selectionGroupColor (tray border matches Units-box team chips)", () => {
  it("uses the same TEAM_DEFS colors as the Units box", () => {
    for (const t of [0, 1] as const) {
      expect(selectionGroupColor(t)).toBe(
        `#${TEAM_DEFS[t].color.toString(16).padStart(6, "0")}`,
      );
    }
  });
});
