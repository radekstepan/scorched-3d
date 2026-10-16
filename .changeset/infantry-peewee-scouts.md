---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Add Peewee infantry scouts: small fast fragile bipeds fielded by both teams, mustered in the opening roster and released first by live HQs

## Task writeup (moved from docs/tasks/77-infantry-peewee-scouts.md)

# 77 — Peewee infantry scouts

Add smaller "infantry"-like units fitting the Scorched / Total Annihilation theme.

## Choice

**Peewee (ARMPW)** — the Arm level-1 light infantry kbot from Total Annihilation:
a small biped scout with a peashooter. It is the canonical TA answer to
"infantry", keeps the all-Arm roster coherent (Commander/Stumpy/Flash/Hammer
are all Arm units with retail catalog names already), and its retail identity
(fast, fragile, short-ranged) maps directly onto a distinct battlefield role.

## Doctrine (balance)

| Axis | Peewee | Next nearest |
|---|---|---|
| Speed | 64 — fastest on the field | Flash 58 |
| Gun reach | 550 — must close to brawl | Commander 800 |
| Damage/hit | 0.045 hull / 0.025 HQ — weakest | Flash 0.06 / 0.03 |
| Blast radius | 28 — smallest splash/scorch | Flash 36 |
| Footprint | 6×5 half-extents — smallest | Flash 10×8 |
| Height | ~12.5 u torso-top — lowest | Flash ~12 turret-top, much wider |
| Turn / slew | 2.6 / 2.8 rad/s — nimblest | Flash 2.0 / 2.4 |
| Stand-off | 180 — closes to knife-fight range | Flash 220 |

Scatter stays under artillery (rate 0.02, cap 20 vs hammer 0.06/60), so the
existing "hammer scatters most" invariant holds. Max range 550 sits well under
half the 5120-unit battle-map width, so HQs stay lob-proof.

## Wiring (everything keys off `UnitKind`, so most systems picked it up)

- Core: `types` (def + `UNIT_KINDS`), `combat` (bolt profile, range, scatter,
  muzzle, barrel mount `(0,8,2)+10`), `destruction` (blast + scorch),
  `unitDamage`, `facing`, `retaliation` (stand-off), `movement` (speed),
  `terrain` (footprint), `locomotion` (no wheels, stride 10), `hq` (chip damage
  + spawn cycle `["peewee","flash","stump","hammer"]`).
- Opening roster unchanged at 6 slots: first five cover all kinds, so every
  regen fields a Peewee; `teamOf` keeps 3v3 even teams.
- Renderer: small two-leg walker mesh with hand-cannon in `units.ts`
  (legs named `leg`, so the commander gait + wreck-settle code strides it
  with no changes), alternating footsteps via a now-generic walker check in
  `tracks.ts` (keyed off `WHEEL_RADIUS`, not a kind list), camo seed,
  ghost height 14, tray/canvas/SVG scout icons, wreck breach collar + turret
  pop (shares the tank wreck path — its torso detaches).
- HUD/minimap/Units-box/tray all derive from `UNIT_KINDS`/`UNIT_DEFS` — no
  changes needed beyond the kind table; README roster line updated.

## Tests

- New `packages/core/src/units/peewee.test.ts`: catalog entry, roster
  presence + even teams, range gates, scatter < hammer, mount values,
  smallest splash/chip, fastest speed + smallest footprint, walker drive,
  stand-off inside own reach, HQ cycle order + wrap.
- New `apps/web/src/renderer/peewee.test.ts`: body shape (turret, barrel,
  tip, 2 legs, 0 wheels), smaller bbox than Flash, muzzle ahead of nose,
  antiphase stride + rest settle, spawn/icon bodies, footsteps, icon framing,
  ghost height.
- Updated: `hq.test.ts` (cycle-length-generic assertions),
  `hqFx.test.ts` (first release is now Peewee), `units.test.ts` + 
  `selectionIcons.test.ts` + `liveCounts.test.ts` (Peewee-is-a-walker branches).

## Verification

`yarn typecheck` clean, `yarn test` clean (all suites), `yarn build` clean.
