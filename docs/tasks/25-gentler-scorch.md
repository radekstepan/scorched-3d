# Task 25 — Gentler environment destruction + cooler scorch

Blasts scarred too hard: big saturated-brown discs (hammer 46u at 0.8
intensity, rim `0.29/0.18/0.11` — a strong red-brown read), an 80u fell
radius flattening whole stands, and 1.0-deep dents. Everything now hits
softer while keeping session-persistent accumulation and every cap.

## What changed

- Smaller, dimmer blotches (core `destruction.ts` `scorchForKind`):
  hammer 46→34u / 0.8→0.62, commander 34→26u, stump 28→22u, flash
  24→18u; per-mark shade softened (`1−0.30·i` → `1−0.22·i`).
- Cooler palette: core `[0.09,0.066,0.047]` → `[0.08,0.078,0.086]`
  (cool charcoal, blue at/above red), rim `[0.29,0.18,0.11]` →
  `[0.20,0.185,0.175]` (desaturated grey, channel spread ≤0.025 vs
  0.18 before). Rim transition pushed later (`0.25→0.85`) so the grey
  band is narrower, and the fringe fades earlier (`0.42→0.9`) so edges
  read translucent, not painted. Shared layer opacity 0.92→0.62.
- Shallower dents: `MAX_CRATER_DEPTH` 1.0→0.6,
  `craterDepthForIntensity` `0.25+0.75·i` → `0.15+0.45·i`,
  overlap cap 2.0→1.2. Still mesh-only + `groundY` seating; core
  pathing/seating untouched, so bowls never trap.
- Narrower collateral: `BLAST_RADIUS` 44/52/80/60 → 36/44/64/48
  (hammer still widest), `TOPPLE_FRACTION` 0.45→0.32 (smaller
  instant-flatten core), spread 70u/0.15/s/2s → 45u/0.08/s/3s.
  Caps unchanged: scorch 48, fires 24, smoke 48, felled/blast 12.

## Important decisions

- **Cool grey, not warm brown.** The old `r>g>b` "burnt, not mud" rule
  still produced a saturated brown rim; the new policy pins low
  saturation (core spread <0.02, rim <0.04) with a cool center instead
  of a hue ordering.
- **Smaller cores, not fewer marks.** The 48-mark persistent
  accumulation + oldest-eviction stays — each blotch is just smaller,
  dimmer, and more translucent.
- **Trunk collision untouched.** Fell/blocking still keys off the
  static grid (task 23); only blast radii and damage severity changed,
  so deterministic pathing and replays hold. Damage-field determinism
  unchanged (caller rng, no map-stream perturbation).
- **Selection contrast holds.** White/cyan markers were checked
  against the new lighter scorch triple — still AA.

Tests: core `destruction.test.ts` (blotch size/alpha caps, fell-radius
caps, cool-grey desaturation + never-mud-bright rim, 0.6/1.2 dent caps,
core/spread/reach/rate/age caps, accumulation regression pin);
`craters.test.ts` (grey-center bytes, dim translucent rim);
`combatFx.test.ts` (dent ≤0.6, radius ≤34, layer opacity ≤0.7).
`yarn build`, `yarn typecheck`, `yarn test` pass (201 core + 139 web).
