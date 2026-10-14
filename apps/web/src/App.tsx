import { useMemo, useState } from "react";
import {
  APP_NAME,
  CELL_PIXELS,
  PRESET_META,
  TILE_PIXELS,
  composeMinimap,
  generateMap,
  type HoverInfo,
  type MapPreset,
  type ViewOptions,
} from "@scorched-3d/core";
import TerrainCanvas from "./renderer/TerrainCanvas";
import { cn } from "./utils/cn";

const PRESETS: MapPreset[] = ["greenreach", "archipelago", "highpass", "caldera"];

export default function App() {
  const [preset, setPreset] = useState<MapPreset>("greenreach");
  const [seed, setSeed] = useState(0xa11ce);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [options, setOptions] = useState<ViewOptions>({
    exaggeration: 3.6,
    showWater: true,
    showFeatures: true,
    showWire: false,
    showContours: false,
    pixelFilter: true,
  });

  const map = useMemo(() => generateMap(preset, seed), [preset, seed]);
  const miniUrl = useMemo(() => {
    const img = composeMinimap(map);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [map]);

  const patch = (partial: Partial<ViewOptions>) => setOptions((o) => ({ ...o, ...partial }));
  const meta = PRESET_META[preset];
  const tileW = map.width / 2;
  const tileH = map.height / 2;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#071018] text-slate-100">
      <TerrainCanvas map={map} options={options} onHover={setHover} />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(3,8,12,0.55)_100%)]" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 md:p-6">
        <div className="pointer-events-auto hud-panel px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[11px] font-semibold tracking-[0.42em] text-amber-300/90">
              {APP_NAME.toUpperCase()}
            </span>
            <span className="text-[10px] tracking-[0.28em] text-slate-400">TERRAIN POC</span>
          </div>
          <h1 className="font-display mt-1 text-2xl font-semibold leading-none tracking-wide text-white">
            {map.name}
          </h1>
          <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-slate-400">{meta.blurb}</p>
        </div>

        <div className="pointer-events-auto hud-panel hidden px-4 py-3 md:block">
          <Row k="TNT" v={`0x${map.version.toString(16)}`} />
          <Row k="tileset" v={map.world} />
          <Row k="grid" v={`${map.width} × ${map.height} cells`} />
          <Row k="world" v={`${map.width * CELL_PIXELS} × ${map.height * CELL_PIXELS} px`} />
          <Row k="tiles" v={`${tileW} × ${tileH} · ${TILE_PIXELS}px · ${map.tiles.length} unique`} />
          <Row k="sea" v={String(map.seaLevel)} />
        </div>
      </header>

      <aside className="pointer-events-auto absolute bottom-4 left-4 z-10 flex w-[250px] flex-col gap-3 md:bottom-6 md:left-6">
        <div className="hud-panel p-3">
          <Label>Worlds</Label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={cn(
                  "rounded-sm border px-2 py-1.5 text-left text-[11px] tracking-wide transition",
                  preset === p
                    ? "border-amber-400/70 bg-amber-400/15 text-amber-100"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25",
                )}
              >
                {PRESET_META[p].name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-slate-400">SEED {seed.toString(16).toUpperCase()}</span>
            <button
              onClick={() => setSeed((s) => (Math.imul(s, 1664525) + 1013904223) >>> 0)}
              className="rounded-sm border border-amber-400/40 px-2 py-1 text-[10px] tracking-[0.18em] text-amber-200 hover:bg-amber-400/10"
            >
              REGEN
            </button>
          </div>
        </div>

        <div className="hud-panel overflow-hidden p-2">
          <div className="relative">
            <img src={miniUrl} alt="Minimap" className="aspect-square w-full rounded-sm border border-white/10" />
            {hover && (
              <span
                className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_8px_#fbbf24]"
                style={{
                  left: `${(hover.cellX / (map.width - 1)) * 100}%`,
                  top: `${(hover.cellZ / (map.height - 1)) * 100}%`,
                }}
              />
            )}
          </div>
          <p className="mt-1 text-center font-mono text-[9px] tracking-[0.2em] text-slate-500">
            MINIMAP · 252×252
          </p>
        </div>
      </aside>

      <aside className="pointer-events-auto absolute right-4 top-24 z-10 w-[230px] md:right-6 md:top-28">
        <div className="hud-panel space-y-3 p-3">
          <Label>View</Label>
          <Slider
            label="Height scale"
            value={options.exaggeration}
            min={1}
            max={6}
            step={0.1}
            onChange={(v) => patch({ exaggeration: v })}
          />
          <Toggle label="Water" on={options.showWater} onClick={() => patch({ showWater: !options.showWater })} />
          <Toggle label="Features" on={options.showFeatures} onClick={() => patch({ showFeatures: !options.showFeatures })} />
          <Toggle label="Wireframe" on={options.showWire} onClick={() => patch({ showWire: !options.showWire })} />
          <Toggle label="Contours" on={options.showContours} onClick={() => patch({ showContours: !options.showContours })} />
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
            <p className="mt-2 text-[11px] text-slate-500">Hover the mesh to sample a plot cell.</p>
          )}
        </div>
      </aside>

      <footer className="pointer-events-none absolute inset-x-0 bottom-3 z-10 hidden justify-center md:flex">
        <p className="rounded-full border border-white/10 bg-black/40 px-4 py-1.5 font-mono text-[10px] tracking-[0.18em] text-slate-400">
          DRAG orbit · SCROLL zoom · RMB pan · cells 16px · tiles 32px · Y-up +Z south
        </p>
      </footer>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div className="font-display text-[10px] font-semibold tracking-[0.38em] text-amber-300/80">{children}</div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 font-mono text-[11px]">
      <span className="tracking-wider text-slate-500">{k}</span>
      <span className="text-slate-200">{v}</span>
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between text-[11px]">
      <span className="text-slate-300">{label}</span>
      <span
        className={cn(
          "h-4 w-8 rounded-full border transition",
          on ? "border-amber-300/70 bg-amber-400/30" : "border-white/15 bg-white/5",
        )}
      >
        <span
          className={cn(
            "block h-3 w-3 translate-y-[1px] rounded-full transition",
            on ? "translate-x-4 bg-amber-300" : "translate-x-0.5 bg-slate-500",
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
    <label className="block text-[11px] text-slate-300">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-amber-200">{value.toFixed(1)}×</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-amber-400"
      />
    </label>
  );
}
