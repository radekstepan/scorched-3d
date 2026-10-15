import { TEAM_DEFS, UNIT_DEFS, UNIT_KINDS, type TeamId, type UnitKind } from "@scorched-3d/core";

/**
 * Bottom selection-tray icons.
 *
 * Each tray box shows a small pre-rendered rendering of the unit kind. The
 * data URLs here are rendered once per kind and memoized in a module-level
 * cache, so N selected hulls of one kind share a single `<img>` source. In
 * the browser the icon is drawn once onto an offscreen 2D canvas (top-down
 * hull rect + turret disc + barrel line in the kind's body/accent paint);
 * under node/vitest (no DOM canvas) it falls back to a deterministic inline
 * SVG data URL in the same colors. Either way the value is cached by kind
 * and reused for every tray box.
 */

const ICON_SIZE = 44;

const cache = new Map<UnitKind, string>();

function hexCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function svgFallback(kind: UnitKind): string {
  const def = UNIT_DEFS[kind];
  const body = hexCss(def.color);
  const accent = hexCss(def.accent);
  const label = def.name.slice(0, 1).toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 44 44">` +
    `<rect width="44" height="44" rx="6" fill="#0b141c"/>` +
    (kind === "commander"
      ? `<circle cx="22" cy="18" r="9" fill="${body}"/><rect x="19" y="24" width="6" height="12" rx="2" fill="${accent}"/>`
      : `<rect x="10" y="12" width="24" height="20" rx="3" fill="${body}"/>` +
        `<circle cx="22" cy="22" r="6" fill="${body}" stroke="${accent}" stroke-width="2"/>` +
        `<rect x="21" y="2" width="2.5" height="14" fill="${accent}"/>`) +
    `<text x="22" y="40" text-anchor="middle" font-family="monospace" font-size="8" fill="#cbd5e1">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function canvasRender(kind: UnitKind): string | null {
  try {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const def = UNIT_DEFS[kind];
    ctx.fillStyle = "#0b141c";
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.fillStyle = hexCss(def.color);
    ctx.strokeStyle = hexCss(def.accent);
    if (kind === "commander") {
      ctx.beginPath();
      ctx.arc(22, 17, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexCss(def.accent);
      ctx.fillRect(19, 25, 6, 12);
    } else {
      // Top-down hull: body rect, turret disc, barrel line forward.
      const w = kind === "hammer" ? 20 : 24;
      const h = kind === "flash" ? 18 : 22;
      ctx.fillRect(22 - w / 2, 22 - h / 2 + 2, w, h);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(22, 24, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = hexCss(def.accent);
      ctx.lineWidth = kind === "hammer" ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(22, 24);
      ctx.lineTo(22, kind === "hammer" ? 2 : 6);
      ctx.stroke();
    }
    // Kind initial so boxes stay distinguishable at 44px.
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(def.name.slice(0, 1).toUpperCase(), 22, 41);
    return canvas.toDataURL();
  } catch {
    return null;
  }
}

/**
 * Pre-rendered (and memoized) icon data URL for a unit kind. The first call
 * per kind renders; every later call reuses the cached URL.
 */
export function getUnitIconDataUrl(kind: UnitKind): string {
  const hit = cache.get(kind);
  if (hit) return hit;
  const url = canvasRender(kind) ?? svgFallback(kind);
  cache.set(kind, url);
  return url;
}

/** Number of cached icon URLs (test hook). */
export function unitIconCacheSize(): number {
  return cache.size;
}

/** Drop the icon cache (tests / canvas teardown). */
export function clearUnitIconCache(): void {
  cache.clear();
}

export interface SelectionGroup {
  kind: UnitKind;
  team: TeamId;
  count: number;
  indices: number[];
}

/**
 * Group a selection into tray boxes: one box per (kind, team) pair with a
 * count badge. Deterministic order: `UNIT_KINDS` order, then team id.
 * Unknown indices are skipped; wrecks are the caller's decision (the tray
 * passes live selection only — kills already drop from selection).
 */
export function groupSelection(
  units: readonly { kind: UnitKind; team?: TeamId }[],
  selection: readonly number[],
): SelectionGroup[] {
  const byKey = new Map<string, SelectionGroup>();
  for (const i of selection) {
    const u = units[i];
    if (!u) continue;
    const team: TeamId = u.team ?? 0;
    const key = `${u.kind}:${team}`;
    const g = byKey.get(key);
    if (g) {
      g.count += 1;
      g.indices.push(i);
    } else {
      byKey.set(key, { kind: u.kind, team, count: 1, indices: [i] });
    }
  }
  const kindRank = new Map<UnitKind, number>(UNIT_KINDS.map((k, r) => [k, r]));
  return [...byKey.values()].sort((a, b) => {
    const rk = (kindRank.get(a.kind) ?? 99) - (kindRank.get(b.kind) ?? 99);
    if (rk !== 0) return rk;
    return a.team - b.team;
  });
}

/** Team color CSS for a tray box top border (same source as the Units box chips). */
export function selectionGroupColor(team: TeamId): string {
  return hexCss(TEAM_DEFS[team]?.color ?? 0xffffff);
}
