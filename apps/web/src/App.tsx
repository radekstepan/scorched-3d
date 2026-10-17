import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  APP_NAME,
  APP_VERSION,
  CELL_PIXELS,
  DEFAULT_EXAGGERATION,
  MAX_EXAGGERATION,
  MIN_EXAGGERATION,
  PRESET_META,
  TEAM_DEFS,
  TILE_PIXELS,
  UNIT_DEFS,
  UNIT_KINDS,
  composeMinimap,
  generateMap,
  type HoverInfo,
  type MapPreset,
  type ViewOptions,
} from "@scorched-3d/core";
import TerrainCanvas from "./renderer/TerrainCanvas";
import type { HqStatus } from "./renderer/hqFx";
import {
  MINIMAP_SELECTED_GLOW,
  MINIMAP_SELECTED_OUTLINE,
} from "./renderer/selectionFx";
import {
  getUnitIconDataUrl,
  groupSelection,
  scheduleUnitIconPreload,
  selectionGroupColor,
} from "./renderer/selectionIcons";
import { cn } from "./utils/cn";
import { countLiveUnitsByKind } from "./utils/liveCounts";
import { minimapPointToWorld } from "./renderer/minimap";
import type { TerritoryMinimap } from "./renderer/territory";

const PRESETS: MapPreset[] = ["greenreach", "archipelago", "highpass", "caldera", "rivercross", "dustplains"];

export default function App() {
  const [mobilePanel, setMobilePanel] = useState<"worlds" | "inspector" | null>(null);
  const [preset, setPreset] = useState<MapPreset>("greenreach");
  const [seed, setSeed] = useState(0xa11ce);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [liveUnits, setLiveUnits] = useState<{ x: number; z: number; alive: boolean }[]>([]);
  const [hqs, setHqs] = useState<HqStatus[]>([]);
  // Territory paint for the minimap overlay (~4 Hz while the toggle is on,
  // null while off). Drawn into the overlay canvas by the effect below.
  const [territory, setTerritory] = useState<TerritoryMinimap | null>(null);
  const territoryCanvasRef = useRef<HTMLCanvasElement>(null);
  // Minimap click-to-move: world point + sequence so repeated clicks on the
  // same spot still retarget the camera. TerrainCanvas consumes it and
  // preserves yaw/pitch/zoom (only the orbit target translates).
  const [jump, setJump] = useState<{ x: number; z: number; seq: number } | null>(null);
  const [options, setOptions] = useState<ViewOptions>({
    exaggeration: DEFAULT_EXAGGERATION,
    showWater: true,
    showFeatures: true,
    showWire: false,
    showContours: false,
    pixelFilter: true,
    showWaypoints: false,
    showHealth: true,
    showTerritory: false,
    panSpeed: 1,
    zoomSpeed: 1,
    nightMode: false,
  });

  // Cache selection-tray thumbnails on load (one idle-chunked 3D render
  // per kind) so the first selection is pure cache hits, never mid-gesture
  // thumbnail cost on the main loop.
  useEffect(() => {
    scheduleUnitIconPreload();
  }, []);

  // Territory overlay canvas: each broadcast paints the coarse RGBA field
  // 1:1 and CSS upscales it over the minimap box (smoothing on, so the
  // cells read as soft blobs like the 3D texture). Cleared whenever the
  // toggle is off or no paint has arrived yet.
  useEffect(() => {
    const canvas = territoryCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!territory || !options.showTerritory) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (canvas.width !== territory.cols || canvas.height !== territory.rows) {
      canvas.width = territory.cols;
      canvas.height = territory.rows;
    }
    ctx.putImageData(new ImageData(territory.data, territory.cols, territory.rows), 0, 0);
  }, [territory, options.showTerritory]);

  const map = useMemo(() => generateMap(preset, seed), [preset, seed]);
  // Minimap bakes terrain only: unit markers are a live overlay from the
  // render loop (~4 Hz), so they track patrols and move orders instead of
  // going stale at their spawn cells.
  const miniUrl = useMemo(() => {
    const img = composeMinimap(map);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [map]);
  const worldW = map.width * CELL_PIXELS;
  const worldD = map.height * CELL_PIXELS;

  const patch = (partial: Partial<ViewOptions>) => setOptions((o) => ({ ...o, ...partial }));
  // Minimap click/drag-to-move: pointer fraction across the square box maps
  // linearly to world X/Z (same math as the overlay dots). Only the world
  // point crosses into the canvas — the camera keeps its yaw/pitch/zoom.
  const jumpFromMinimap = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const w = minimapPointToWorld(e.clientX, e.clientY, rect, worldW, worldD);
    setJump((j) => ({ x: w.x, z: w.z, seq: (j?.seq ?? 0) + 1 }));
  };
  // Bottom selection tray: one box per (kind, team) group with a
  // pre-rendered icon (memoized data URL, rendered once per kind and reused
  // for every box) and a count badge. The top border carries the team color
  // from TEAM_DEFS.
  const selectedGroups = useMemo(() => groupSelection(map.units, selected), [map.units, selected]);
  // Units box: live per-kind hull counts (commander … peewee). Roster slots
  // read alive before the first broadcast; wrecks drop out and HQ
  // reinforcements count once both arrays cover them.
  const liveCounts = useMemo(() => countLiveUnitsByKind(map.units, liveUnits), [map.units, liveUnits]);
  // Minimap overlays memoize on their own inputs (not `hover`): a probe
  // cell change re-renders App, but the unit/HQ dot elements keep referential
  // identity so React bails out of those subtrees instead of reconciling
  // dozens of spans per hover update.
  const minimapDots = useMemo(
    () =>
      liveUnits.map((p, i) => {
        // Dead hulls drop off the minimap immediately on death (both
        // teams) — no dimmed wreck dots, per the no-dead-units policy.
        if (p.alive === false) return null;
        const kind = map.units[i]?.kind;
        const color = kind ? `#${UNIT_DEFS[kind].color.toString(16).padStart(6, "0")}` : "#fff";
        const isSel = selected.includes(i);
        // Team identity rings the kind-colored dot: Blue west, Orange
        // east (same colors as the 3D ground rings).
        const team = map.units[i]?.team;
        const teamColor = team === undefined ? undefined : `#${TEAM_DEFS[team].color.toString(16).padStart(6, "0")}`;
        return (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-black/70"
            style={{
              left: `${(p.x / worldW + 0.5) * 100}%`,
              top: `${(p.z / worldD + 0.5) * 100}%`,
              width: 5,
              height: 5,
              background: color,
              opacity: 1,
              outline: isSel ? MINIMAP_SELECTED_OUTLINE : teamColor ? `2px solid ${teamColor}` : undefined,
              boxShadow: isSel ? MINIMAP_SELECTED_GLOW : undefined,
            }}
          />
        );
      }),
    [liveUnits, map.units, selected, worldW, worldD],
  );
  const minimapHq = useMemo(
    () =>
      hqs.map((h) => {
        // Fort markers: team-colored squares (grey when wrecked), so
        // the map-end forts read apart from the round hull dots.
        const teamColor = `#${TEAM_DEFS[h.team].color.toString(16).padStart(6, "0")}`;
        return (
          <span
            key={`hq-${h.team}`}
            title={`Team ${TEAM_DEFS[h.team].name} HQ${h.alive ? "" : " (destroyed)"}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 border border-black/70"
            style={{
              left: `${(h.x / worldW + 0.5) * 100}%`,
              top: `${(h.z / worldD + 0.5) * 100}%`,
              width: 9,
              height: 9,
              background: h.alive ? teamColor : "#57534e",
              opacity: h.alive ? 1 : 0.55,
            }}
          />
        );
      }),
    [hqs, worldW, worldD],
  );
  // Hover chip in world coords — the same mapping as the unit dots and the
  // click handler. The 3D hover pick is continuous, so cell-index math would
  // sit up to half a cell off the point a click on that spot would address.
  const minimapHoverChip = useMemo(
    () =>
      hover && (
        <span
          className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime-300 shadow-[0_0_8px_#fbbf24]"
          style={{
            left: `${(hover.worldX / worldW + 0.5) * 100}%`,
            top: `${(hover.worldZ / worldD + 0.5) * 100}%`,
          }}
        />
      ),
    [hover, worldW, worldD],
  );
  const meta = PRESET_META[preset];
  const tileW = map.width / 2;
  const tileH = map.height / 2;

  return (
    <div className="command-shell" data-mobile-panel={mobilePanel ?? "closed"}>
      <header className="command-header">
        <div className="command-brand"><span className="brand-mark" aria-hidden="true">✣</span>
          <div><strong>{APP_NAME.toUpperCase()}</strong><small>REAL-TIME TACTICAL COMMAND</small></div>
        </div>
        <nav className="command-nav" aria-label="Game views">
          <span className="active" aria-current="page">01 / BATTLEFIELD</span>
        </nav>
        <div className="command-status"><i aria-hidden="true" /> LIVE SIMULATION <span>v{APP_VERSION}</span></div>
      </header>
      <div className="mobile-panel-controls" aria-label="Battlefield panels">
        <button aria-expanded={mobilePanel === "worlds"} aria-controls="worlds-panel" onClick={() => setMobilePanel(mobilePanel === "worlds" ? null : "worlds")}>Worlds / radar</button>
        <button aria-expanded={mobilePanel === "inspector"} aria-controls="inspector-panel" onClick={() => setMobilePanel(mobilePanel === "inspector" ? null : "inspector")}>Inspector</button>
      </div>
      <main className="battlefield" aria-label="Battlefield">
        <TerrainCanvas
          map={map}
          options={options}
          onHover={setHover}
          onSelection={setSelected}
          onPositions={setLiveUnits}
          onHq={setHqs}
          onTerritory={setTerritory}
          jumpTo={jump}
        />
        <div className="viewport-heading"><span>TACTICAL VIEW / {map.name.toUpperCase()}</span><span>BLUE / ORANGE</span></div>
        <div className="viewport-reticle" aria-hidden="true" />

        {selectedGroups.length > 0 && (
          <div className="selection-tray" role="region" aria-label="Selected units">
            {selectedGroups.map((g) => (
              <div
                key={`${g.kind}-${g.team}`}
                className="hud-panel relative w-[68px] p-1.5"
                title={`${UNIT_DEFS[g.kind].name} · Team ${TEAM_DEFS[g.team]?.name ?? g.team} ×${g.count}`}
                style={{ borderTop: `3px solid ${selectionGroupColor(g.team)}` }}
              >
                <img
                  src={getUnitIconDataUrl(g.kind)}
                  alt={UNIT_DEFS[g.kind].name}
                  className="h-11 w-11 rounded-sm"
                  draggable={false}
                />
                <span className="absolute bottom-1 right-1 rounded-sm bg-black/70 px-1 font-mono text-[10px] text-white">
                  ×{g.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
      <aside id="worlds-panel" className="command-rail worlds-rail" aria-label="Worlds and radar">
        <section className="operation-brief hud-panel p-3"><Label>Operation / skirmish</Label>
          <h1 className="font-display mt-1 text-2xl font-semibold leading-none tracking-wide text-white">
            {map.name}
          </h1>
          <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-stone-400">{meta.blurb}</p>
        </section>
        <div className="hud-panel p-3">
          <Label>Worlds</Label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                aria-pressed={preset === p}
                onClick={() => setPreset(p)}
                className={cn(
                  "rounded-sm border px-2 py-1.5 text-left text-[11px] tracking-wide transition",
                  preset === p
                    ? "border-lime-400/70 bg-lime-400/15 text-lime-100"
                    : "border-white/10 bg-white/5 text-stone-300 hover:border-white/25",
                )}
              >
                {PRESET_META[p].name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-stone-400">SEED {seed.toString(16).toUpperCase()}</span>
            <button
              onClick={() => setSeed((s) => (Math.imul(s, 1664525) + 1013904223) >>> 0)}
              className="rounded-sm border border-lime-400/40 px-2 py-1 text-[10px] tracking-[0.18em] text-lime-200 hover:bg-lime-400/10"
            >
              REGEN
            </button>
          </div>
        </div>

        <div className="hud-panel overflow-hidden p-2">
          <div
            className="relative cursor-crosshair touch-none"
            title="Click to move the camera here"
            onPointerDown={jumpFromMinimap}
            onPointerMove={(e) => {
              // Drag across the minimap keeps retargeting while held.
              if ((e.buttons & 1) !== 0) jumpFromMinimap(e);
            }}
          >
            {/* block: an inline img leaves a baseline strut gap, so the
            wrapper would stand several px taller than the terrain image and
            every click/dot fraction would stretch past the map southward
            (worst at the south edge). ring (box-shadow) instead of border:
            the hairline frame adds no layout box, so the image content box
            stays exactly the box clicks and dots are measured against. */}
            <img
              src={miniUrl}
              alt="Minimap"
              className="block aspect-square w-full rounded-sm ring-1 ring-white/10"
              draggable={false}
            />
            {/* Territory tint under the dots/HQs: absolutely positioned, so
            it adds no layout box and clicks keep measuring against the image
            content box (same rule as the ring frame above). */}
            <canvas
              ref={territoryCanvasRef}
              className="absolute inset-0 h-full w-full"
              style={{ imageRendering: "auto" }}
              hidden={!options.showTerritory}
            />
            {minimapDots}
            {minimapHoverChip}
            {minimapHq}
          </div>
          <p className="mt-1 text-center font-mono text-[9px] tracking-[0.2em] text-stone-400">
            TACTICAL RADAR · LIVE
          </p>
        </div>
      </aside>

      <aside id="inspector-panel" className="command-rail inspector-rail" aria-label="Battlefield inspector">
        <div className="hud-panel space-y-3 p-3">
          <Label>View</Label>
          <Slider
            label="Height scale"
            value={options.exaggeration}
            min={MIN_EXAGGERATION}
            max={MAX_EXAGGERATION}
            step={0.05}
            onChange={(v) => patch({ exaggeration: v })}
          />
          <Slider
            label="Pan speed"
            value={options.panSpeed}
            min={0.2}
            max={3}
            step={0.1}
            onChange={(v) => patch({ panSpeed: v })}
          />
          <Slider
            label="Zoom speed"
            value={options.zoomSpeed}
            min={0.2}
            max={3}
            step={0.1}
            onChange={(v) => patch({ zoomSpeed: v })}
          />
          <Toggle label="Water" on={options.showWater} onClick={() => patch({ showWater: !options.showWater })} />
          <Toggle label="Night" on={options.nightMode} onClick={() => patch({ nightMode: !options.nightMode })} />
          <Toggle label="Features" on={options.showFeatures} onClick={() => patch({ showFeatures: !options.showFeatures })} />
          <Toggle label="Wireframe" on={options.showWire} onClick={() => patch({ showWire: !options.showWire })} />
          <Toggle label="Contours" on={options.showContours} onClick={() => patch({ showContours: !options.showContours })} />
          <Toggle label="Waypoints" on={options.showWaypoints} onClick={() => patch({ showWaypoints: !options.showWaypoints })} />
          <Toggle label="Health" on={options.showHealth} onClick={() => patch({ showHealth: !options.showHealth })} />
          <Toggle label="Territory" on={options.showTerritory} onClick={() => patch({ showTerritory: !options.showTerritory })} />
          <Toggle label="Indexed filter" on={options.pixelFilter} onClick={() => patch({ pixelFilter: !options.pixelFilter })} />
        </div>

        <div className="hud-panel mt-3 p-3">
          <Label>Probe</Label>
          {hover ? (
            <div className="mt-2 space-y-0.5">
              <Row k="cell" v={`${hover.cellX}, ${hover.cellZ}`} />
              <Row k="height" v={`${hover.height}${hover.underwater ? "  submerged" : ""}`} />
              <Row k="slope" v={String(hover.slope)} />
              <Row k="tile" v={`#${hover.tileIndex} ${hover.tileKind}`} />
              <Row k="feature" v={hover.feature ?? "empty"} />
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-stone-400">Hover the mesh to sample a plot cell.</p>
          )}
        </div>

        <div className="hud-panel mt-3 p-3">
          <Label>Units</Label>
          <div className="mt-2 space-y-1.5">
            {UNIT_KINDS.map((k) => {
              const def = UNIT_DEFS[k];
              return (
                <div key={k} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[2px] border border-black/60"
                    style={{ background: `#${def.color.toString(16).padStart(6, "0")}` }}
                  />
                  <span className="text-stone-200">{def.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-stone-400">×{liveCounts[k]}</span>
                </div>
              );
            })}
          </div>
        </div>
        <details className="hud-panel p-3 terrain-diagnostics"><summary>Terrain diagnostics</summary><div className="mt-3 space-y-1">
          <Row k="TNT" v={`0x${map.version.toString(16)}`} />
          <Row k="tileset" v={map.world} />
          <Row k="grid" v={`${map.width} × ${map.height} cells`} />
          <Row k="world" v={`${map.width * CELL_PIXELS} × ${map.height * CELL_PIXELS} px`} />
          <Row k="tiles" v={`${tileW} × ${tileH} · ${TILE_PIXELS}px · ${map.tiles.length} unique`} />
          <Row k="sea" v={String(map.seaLevel)} />
        </div></details>
      </aside>

      <footer className="command-footer"><span><i aria-hidden="true" /> COMMAND LINK ACTIVE</span>
        <p>CLICK select · SHIFT+DRAG box · RIGHT-CLICK move · ESC clear · DRAG orbit · SCROLL zoom · WASD pan</p>
        <span>{map.width} × {map.height} GRID</span>
      </footer>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div className="font-display text-[10px] font-semibold tracking-[0.38em] text-lime-300/80">{children}</div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 font-mono text-[11px]">
      <span className="tracking-wider text-stone-400">{k}</span>
      <span className="text-stone-200">{v}</span>
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} className="flex w-full items-center justify-between text-[11px]">
      <span className="text-stone-300">{label}</span>
      <span
        className={cn(
          "h-4 w-8 rounded-full border transition",
          on ? "border-lime-300/70 bg-lime-400/30" : "border-white/15 bg-white/5",
        )}
      >
        <span
          className={cn(
            "block h-3 w-3 translate-y-[1px] rounded-full transition",
            on ? "translate-x-4 bg-lime-300" : "translate-x-0.5 bg-slate-500",
          )}
        />
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-[11px] text-stone-300">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-lime-200">{value.toFixed(1)}×</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-lime-400"
      />
    </label>
  );
}
