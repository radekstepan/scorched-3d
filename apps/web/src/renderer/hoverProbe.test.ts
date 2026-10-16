// Hover-probe gate + math terrain pick: pins the anti-hot-loop contract
// (no per-frame raycast, no per-frame setState, no mesh sweep while moving)
// plus the TerrainCanvas/App wiring that enforces it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CELL_PIXELS, worldHeight, type HoverInfo } from "@scorched-3d/core";
import { createHoverGate, HOVER_MAX_SAMPLES, hoverInfoKey, pickTerrainPoint, type PickField, type PickStats } from "./hoverProbe";

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

function flatField(w: number, h: number, raw: number): PickField {
  return { width: w, height: h, heights: new Uint8Array(w * h).fill(raw) };
}

function rampField(w: number, h: number): PickField {
  const heights = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) heights[z * w + x] = x;
  return { width: w, height: h, heights };
}

/** Same world→cell mapping as TerrainCanvas hitToInfo. */
function cellOf(field: PickField, x: number, z: number): [number, number] {
  const cx = Math.min(Math.max(Math.round(x / CELL_PIXELS + (field.width - 1) / 2), 0), field.width - 1);
  const cz = Math.min(Math.max(Math.round(z / CELL_PIXELS + (field.height - 1) / 2), 0), field.height - 1);
  return [cx, cz];
}

/** Dense reference march: 4000 coarse taps + bisection, same surface math. */
function referencePick(
  field: PickField,
  exag: number,
  o: number[],
  d: number[],
): { x: number; z: number } | null {
  const halfW = ((field.width - 1) / 2) * CELL_PIXELS;
  const halfD = ((field.height - 1) / 2) * CELL_PIXELS;
  // Brute-force sign scan over the same box-clipped interval: an
  // independent implementation of the same surface crossing.
  const gy = (x: number, z: number): number => {
    const w = field.width;
    const h = field.height;
    const fx = x / CELL_PIXELS + (w - 1) / 2;
    const fz = z / CELL_PIXELS + (h - 1) / 2;
    const x0 = Math.min(Math.max(Math.floor(fx), 0), w - 2);
    const z0 = Math.min(Math.max(Math.floor(fz), 0), h - 2);
    const tx = Math.min(Math.max(fx - x0, 0), 1);
    const tz = Math.min(Math.max(fz - z0, 0), 1);
    const h00 = field.heights[z0 * w + x0] ?? 0;
    const h10 = field.heights[z0 * w + x0 + 1] ?? 0;
    const h01 = field.heights[(z0 + 1) * w + x0] ?? 0;
    const h11 = field.heights[(z0 + 1) * w + x0 + 1] ?? 0;
    return worldHeight(h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz, exag);
  };
  // Box-clip (same slabs as production).
  let enter = 0;
  let exit = Infinity;
  const spans: [number, number, number][] = [
    [o[0]!, d[0]!, halfW],
    [o[2]!, d[2]!, halfD],
  ];
  for (const [oo, dd, half] of spans) {
    if (dd === 0) {
      if (oo < -half || oo > half) return null;
      continue;
    }
    let t0 = (-half - oo) / dd;
    let t1 = (half - oo) / dd;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0);
    exit = Math.min(exit, t1);
    if (enter > exit) return null;
  }
  const yHi = worldHeight(255, exag) + 64;
  const yLo = -256;
  if (d[1] === 0) {
    if (o[1]! < yLo || o[1]! > yHi) return null;
  } else {
    let t0 = (yLo - o[1]!) / d[1]!;
    let t1 = (yHi - o[1]!) / d[1]!;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0);
    exit = Math.min(exit, t1);
    if (enter > exit) return null;
  }
  const N = 4000;
  let prevT = enter;
  const firstAbove = o[1]! + d[1]! * enter > gy(o[0]! + d[0]! * enter, o[2]! + d[2]! * enter);
  if (!firstAbove) return null;
  for (let i = 1; i <= N; i++) {
    const t = enter + ((exit - enter) * i) / N;
    const above = o[1]! + d[1]! * t > gy(o[0]! + d[0]! * t, o[2]! + d[2]! * t);
    if (!above) {
      let lo = prevT;
      let hi = t;
      for (let r = 0; r < 24; r++) {
        const mid = (lo + hi) / 2;
        if (o[1]! + d[1]! * mid <= gy(o[0]! + d[0]! * mid, o[2]! + d[2]! * mid)) hi = mid;
        else lo = mid;
      }
      const ht = (lo + hi) / 2;
      return { x: o[0]! + d[0]! * ht, z: o[2]! + d[2]! * ht };
    }
    prevT = t;
  }
  return null;
}

describe("math terrain pick", () => {
  it("overhead ray hits the flat surface at the ray's ground point", () => {
    const field = flatField(8, 8, 10);
    const stats: PickStats = { samples: 0 };
    const hit = pickTerrainPoint(field, 1, 0, 500, 0, 0, -1, 0, stats);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(0, 6);
    expect(hit!.z).toBeCloseTo(0, 6);
    expect(hit!.y).toBeCloseTo(worldHeight(10, 1), 3);
    expect(stats.samples).toBeLessThanOrEqual(HOVER_MAX_SAMPLES);
  });

  it("upward and sideways rays miss", () => {
    const field = flatField(8, 8, 10);
    expect(pickTerrainPoint(field, 1, 0, 500, 0, 0, 1, 0)).toBeNull();
    expect(pickTerrainPoint(field, 1, 0, 500, 0, 1, 0, 0)).toBeNull();
  });

  it("a ray pointing away from the map costs zero height taps", () => {
    const field = flatField(32, 32, 10);
    const stats: PickStats = { samples: 0 };
    expect(pickTerrainPoint(field, 1, 10000, 500, 0, 1, 0, 0, stats)).toBeNull();
    expect(stats.samples).toBe(0);
  });

  it("a ray starting below the surface hits nothing (front-face parity)", () => {
    const field = flatField(8, 8, 10);
    expect(pickTerrainPoint(field, 1, 0, 5, 0, 0, 1, 0)).toBeNull();
  });

  it("ramp field: overhead ray lands on the expected column", () => {
    const field = rampField(16, 16);
    const wx = (10 - (16 - 1) / 2) * CELL_PIXELS;
    const stats: PickStats = { samples: 0 };
    const hit = pickTerrainPoint(field, 1, wx, 2000, 0, 0, -1, 0, stats);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(wx, 6);
    expect(hit!.y).toBeCloseTo(worldHeight(10, 1), 2);
    expect(cellOf(field, hit!.x, hit!.z)).toEqual([10, 8]);
    expect(stats.samples).toBeLessThanOrEqual(HOVER_MAX_SAMPLES);
  });

  it("glancing ray still hits within budget", () => {
    const field = flatField(64, 64, 10);
    const stats: PickStats = { samples: 0 };
    const hit = pickTerrainPoint(field, 1, -3000, 700, 0, 1, -0.25, 0, stats);
    expect(hit).not.toBeNull();
    // Descending 0.25 per unit from 700 to surface 20: t = 2720.
    expect(hit!.x).toBeCloseTo(-3000 + 2720, 0);
    expect(stats.samples).toBeLessThanOrEqual(HOVER_MAX_SAMPLES);
  });

  it("agrees with the dense reference march on steep and angled rays", () => {
    const fields: PickField[] = [flatField(32, 32, 40), rampField(32, 32)];
    const rays: { o: number[]; d: number[] }[] = [
      { o: [120, 1500, -80], d: [0, -1, 0] },
      { o: [120, 800, -80], d: [-0.3, -1, 0.2] },
      { o: [-600, 900, 200], d: [0.5, -1, -0.2] },
    ];
    for (const field of fields) {
      for (const { o, d } of rays) {
        const fast = pickTerrainPoint(field, 1.5, o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!);
        const ref = referencePick(field, 1.5, o, d);
        expect(ref).not.toBeNull();
        expect(fast).not.toBeNull();
        expect(cellOf(field, fast!.x, fast!.z)).toEqual(cellOf(field, ref!.x, ref!.z));
      }
    }
  });

  it("bound: worst-case taps stay far below a full-mesh triangle sweep", () => {
    // Old path tested every triangle (~163k on 320×256); the march is
    // capped at HOVER_MAX_SAMPLES bilinear taps (~400).
    expect(HOVER_MAX_SAMPLES).toBeLessThanOrEqual(512);
    expect(HOVER_MAX_SAMPLES).toBeLessThan(163000);
  });
});

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
    // tick probes from a cached rect instead).
    expect(handler).not.toContain("renderer.domElement.getBoundingClientRect");
  });

  it("the tick marches the heightfield: no mesh raycast, no layout read", () => {
    const block =
      canvasSource.slice(
        canvasSource.indexOf("Hover probe: at most one math pick"),
        canvasSource.indexOf("renderer.render(scene, camera);"),
      );
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("pickTerrainPoint");
    // The 163k-triangle mesh raycast is gone from the hover path (click
    // picking keeps its own raycaster), and NDC comes from the cached rect
    // refreshed in resize() — zero forced reflows while sweeping.
    expect(block).not.toContain("intersectObject");
    expect(block).not.toContain("getBoundingClientRect");
    expect(block).toContain("cachedCanvasRect");
    expect(canvasSource).toContain("cachedCanvasRect = renderer.domElement.getBoundingClientRect()");
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
