import { describe, expect, it } from "vitest";
import { UNIT_KINDS } from "@scorched-3d/core";
import { countLiveUnitsByKind, liveCountsOrdered } from "./liveCounts";

describe("countLiveUnitsByKind", () => {
  it("counts every roster slot alive before the first broadcast", () => {
    const placed = [
      { kind: "commander" },
      { kind: "stump" },
      { kind: "flash" },
      { kind: "hammer" },
      { kind: "flash" },
    ] as const;
    const counts = countLiveUnitsByKind([...placed], []);
    expect(counts).toEqual({ commander: 1, stump: 1, flash: 2, hammer: 1 });
  });

  it("drops wrecks (alive === false) from the counts", () => {
    const placed = [{ kind: "commander" }, { kind: "stump" }, { kind: "hammer" }] as const;
    const counts = countLiveUnitsByKind(
      [...placed],
      [{ alive: true }, { alive: false }, { alive: true }],
    );
    expect(counts).toEqual({ commander: 1, stump: 0, flash: 0, hammer: 1 });
  });

  it("counts spawned reinforcements appended past the roster", () => {
    const placed = [{ kind: "flash" }, { kind: "flash" }] as const;
    const counts = countLiveUnitsByKind(
      [...placed],
      [{ alive: true }, { alive: true }],
    );
    expect(counts.flash).toBe(2);
  });

  it("orders kinds commander … hammer", () => {
    const placed = [{ kind: "hammer" }, { kind: "commander" }] as const;
    const ordered = liveCountsOrdered([...placed], [{ alive: true }, { alive: true }]);
    expect(ordered.map(([k]) => k)).toEqual([...UNIT_KINDS]);
    expect(ordered[0]).toEqual(["commander", 1]);
    expect(ordered[ordered.length - 1]).toEqual(["hammer", 1]);
  });
});
