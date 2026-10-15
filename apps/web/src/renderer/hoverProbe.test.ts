// Hover-probe gate: pins the anti-hot-loop contract (no per-frame raycast,
// no per-frame setState) plus the TerrainCanvas/App wiring that enforces it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HoverInfo } from "@scorched-3d/core";
import { createHoverGate, hoverInfoKey } from "./hoverProbe";

function infoAt(cellX: number, cellZ: number): HoverInfo {
  return {
    cellX,
    cellZ,
    height: 10,
    slope: 1,
    underwater: false,
    tileKind: "grass",
    tileIndex: 3,
    feature: null,
    worldX: cellX * 32,
    worldZ: cellZ * 32,
  };
}

/** Mirror of the tick's emit block: dedupe on the cell key. */
function createEmitter() {
  const emitted: (HoverInfo | null)[] = [];
  let lastKey = hoverInfoKey(null);
  return {
    emitted,
    emit(info: HoverInfo | null): void {
      const key = hoverInfoKey(info);
      if (key !== lastKey) {
        lastKey = key;
        emitted.push(info);
      }
    },
  };
}

describe("hover gate coalescing", () => {
  it("starts idle: no probe pending, pointer outside", () => {
    const gate = createHoverGate();
    expect(gate.inside()).toBe(false);
    expect(gate.takeProbe()).toBeNull();
  });

  it("coalesces rapid moves into one probe, last position wins", () => {
    const gate = createHoverGate();
    gate.move(10, 20);
    gate.move(30, 40);
    gate.move(50, 60);
    expect(gate.takeProbe()).toEqual({ x: 50, y: 60 });
    // Consumed: the next tick probes nothing until the pointer moves again.
    expect(gate.takeProbe()).toBeNull();
  });

  it("a parked cursor probes nothing across many ticks", () => {
    const gate = createHoverGate();
    gate.move(100, 200);
    expect(gate.takeProbe()).not.toBeNull();
    for (let i = 0; i < 120; i++) {
      expect(gate.takeProbe()).toBeNull();
    }
  });

  it("leave drops the pending probe and marks the pointer outside", () => {
    const gate = createHoverGate();
    gate.move(10, 20);
    gate.leave();
    expect(gate.inside()).toBe(false);
    expect(gate.takeProbe()).toBeNull();
  });

  it("re-arms after leave", () => {
    const gate = createHoverGate();
    gate.move(1, 2);
    gate.leave();
    gate.move(3, 4);
    expect(gate.inside()).toBe(true);
    expect(gate.takeProbe()).toEqual({ x: 3, y: 4 });
  });

  it("ignores non-finite pointer positions", () => {
    const gate = createHoverGate();
    gate.move(NaN, 20);
    gate.move(10, Infinity);
    expect(gate.inside()).toBe(false);
    expect(gate.takeProbe()).toBeNull();
  });
});

describe("hover gate camera motion", () => {
  it("cameraMoved with no pointer does not schedule a phantom probe", () => {
    const gate = createHoverGate();
    gate.cameraMoved();
    expect(gate.takeProbe()).toBeNull();
  });

  it("cameraMoved re-probes a parked cursor at its stored position", () => {
    const gate = createHoverGate();
    gate.move(70, 80);
    expect(gate.takeProbe()).toEqual({ x: 70, y: 80 });
    gate.cameraMoved();
    expect(gate.takeProbe()).toEqual({ x: 70, y: 80 });
    expect(gate.takeProbe()).toBeNull();
  });

  it("cameraMoved after leave stays silent", () => {
    const gate = createHoverGate();
    gate.move(70, 80);
    gate.leave();
    gate.cameraMoved();
    expect(gate.takeProbe()).toBeNull();
  });
});

describe("hoverInfoKey emission dedupe", () => {
  it("null keys distinctly from any cell", () => {
    expect(hoverInfoKey(null)).toBe("null");
    expect(hoverInfoKey(infoAt(0, 0))).not.toBe("null");
  });

  it("same cell keys equal regardless of sub-cell position", () => {
    const a = { ...infoAt(5, 9), worldX: 1.5, worldZ: 2.5 };
    const b = { ...infoAt(5, 9), worldX: 900.1, worldZ: 800.2, height: 99 };
    expect(hoverInfoKey(a)).toBe(hoverInfoKey(b));
  });

  it("different cells key differently", () => {
    expect(hoverInfoKey(infoAt(5, 9))).not.toBe(hoverInfoKey(infoAt(6, 9)));
    expect(hoverInfoKey(infoAt(5, 9))).not.toBe(hoverInfoKey(infoAt(5, 10)));
  });

  it("repeated same-cell frames emit once; cell changes and clears emit", () => {
    const emitter = createEmitter();
    // 120 parked frames on one cell: a single emission.
    for (let i = 0; i < 120; i++) emitter.emit(infoAt(5, 9));
    expect(emitter.emitted).toHaveLength(1);
    // Sweep across cells: one emission per new cell.
    emitter.emit(infoAt(6, 9));
    emitter.emit(infoAt(6, 9));
    emitter.emit(infoAt(7, 9));
    expect(emitter.emitted).toHaveLength(3);
    // Miss then repeated miss: one null emission total.
    emitter.emit(null);
    emitter.emit(null);
    emitter.emit(null);
    expect(emitter.emitted).toHaveLength(4);
    expect(emitter.emitted[3]).toBeNull();
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = readFileSync(join(here, "TerrainCanvas.tsx"), "utf8");
const appSource = readFileSync(join(here, "..", "App.tsx"), "utf8");

describe("hover hot-loop wiring", () => {
  it("probes through the gate, at most once per tick and only when dirty", () => {
    expect(canvasSource).toContain("createHoverGate");
    expect(canvasSource).toContain("takeProbe()");
    expect(canvasSource).toContain("hoverInfoKey");
    expect(canvasSource).not.toMatch(/let hovering ?= ?false/);
    expect(canvasSource).not.toMatch(/if \(hovering\)/);
  });

  it("the pointermove handler records coords without a hover layout read", () => {
    const handler = canvasSource.match(/const onPointerMove[\s\S]*?^    \};/m)?.[0] ?? "";
    expect(handler).toContain("hoverGate.move");
    // The drag-box overlay may still measure its own wrap rect mid-gesture,
    // but the hover path must not read the canvas rect per pointermove (the
    // tick does one read per consumed probe instead).
    expect(handler).not.toContain("renderer.domElement.getBoundingClientRect");
  });

  it("re-dirties the probe on camera motion and cleans up the listener", () => {
    expect(canvasSource).toContain('controls.addEventListener("change", markHoverDirty)');
    expect(canvasSource).toContain('controls.removeEventListener("change", markHoverDirty)');
    expect(canvasSource).toContain("markHoverDirty();");
  });

  it("pointer-leave clears without a redundant null emission", () => {
    const leave = canvasSource.match(/const onLeave[\s\S]*?^    \};/m)?.[0] ?? "";
    expect(leave).toContain("hoverGate.leave()");
    expect(leave).toContain("lastHoverKey");
  });

  it("minimap overlays memoize off hover so probe updates skip their subtrees", () => {
    expect(appSource).toContain("minimapDots");
    expect(appSource).toContain("minimapHq");
    expect(appSource).toContain("minimapHoverChip");
    expect(appSource).toMatch(/minimapDots = useMemo/);
  });
});
