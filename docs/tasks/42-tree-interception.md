# Task 42 — Tree interception: rounds get stuck, guns shoot higher

Projectiles used to fly through forests like the trees weren't there: the
firing solution ran muzzle → scattered impact with no wood in between, so
tracers lasered through crowns and shells never noticed the canopy. Flights
now cross live wood, and live wood sometimes catches them — with the guns
answering blocked lines of fire by going over the top.

## What changed

- Canopy model (`packages/core/src/units/combat.ts`): one conservative
  obstacle volume per tree covers both kinds (crown sphere, center +24,
  r=16; trunk cylinder, r=4, 0..20 — matching the `features.ts` posing for
  round crowns ~+24/r~14 and pine cones ~+28/r~11 on ~18-tall trunks). Only
  standing trees (intact/burning/smouldering) intercept — toppled, stump,
  snag, and gone wood has no crown left to catch a round.
- Interception (pure core + thin renderer driver):
  - `treesOnSegment` finds crossed standing-tree ids in ascending order:
    one XZ corridor reject per tree (canopy radius), then exact
    segment-sphere (crown) and slab + closest-approach (trunk) tests.
  - `rollTreeStick` rolls the per-kind stick chance per crossed tree in
    fid order (bolts 0.55, shells 0.35), consuming rng only for crossed
    trees — open-ground flights cost no entropy and replay identically.
  - `CombatFx.advanceShots` tests the flown segment (previous pose → new
    pose) each tick: shells detonate early with the full layered stack at
    the stick point (the blast itself topples/ignites the wood through the
    existing `blastFeatures` hook), while stuck bolts die as an ember
    caught in the branches (hot core + halo pop, pooled-light kick, no
    blast/scorch) and the canvas ignites the struck tree through the
    graduated damage field (`strikeTree` → `igniteTree` + pose + fire glow).
- Canopy-aware aiming (`solveShotClearing`, used for both the barrel-seed
  and the live-muzzle solutions in `tryFire`):
  - `solveBallisticHigh`: the plus-root `tanθ = (V² + √disc)/(g·R)` —
    same muzzle energy, same impact, steep mortar arc over the canopy.
  - Shells keep the flat low root on open ground, lob the high root when
    the flat line clips wood and the lob clears (and fits the hang-time
    safety net), else fire flat into the branches and accept the stick
    roll — the battle stays lively in dense forest instead of going silent.
  - Bolts fly flat by physics and cannot lob: they stay on the target line
    and accept the stick risk, which is what strands tracer embers in
    forests while artillery visibly shoots higher.
- Barrel mount: `ELEVATION_MAX` 1.1 → 1.45 rad so lob barrels can point
  near-vertical at the high solution (rest poses untouched); lobbed flights
  get their own `LOBBED_MAX_TIME` 8 s safety net (high roots hang ~7.4 s
  for the hammers's 520 u/s), flat rounds keep the 6 s reject.
- Canvas wiring (`TerrainCanvas.tsx`): `treeStands` builds fid-ordered
  stands from the damage field each call (ground seat from the live,
  crater-dented surface), `strikeTree` ignites/re-poses/glows the struck
  tree. Absent hooks read as open ground — legacy behavior bit-identical.

## Important decisions

- **Fallback is fire-through, not hold-fire.** An earlier draft held flat
  bolts when blocked, but stands only ever shrink mid-flight (felling
  removes interceptors; igniting doesn't), so a cleared-at-fire bolt could
  never meet new wood in flight — the stuck-ember visual would have been
  dead code. Firing through keeps interception alive for both projectile
  families; the lob is the avoidance, the stick roll is the risk.
- **Exact sub-segment tests, sampled chords.** `flightClearsTrees` tiles
  the analytic arc into ~16-unit chords tested exactly, so clearance can't
  tunnel; curvature sagitta over a chord (~1.6 units worst case) stays far
  below the crown radius. Per-tick interception reuses the same test on
  the single flown segment — ≤6 shots × a few hundred stands of AABB
  rejects per tick, negligible.
- **No new tree damage path.** Stuck rounds reuse the two existing ones:
  shell bursts scar/ignite through `blastFeatures` (a ground-zero tree
  topples, fringe ignites), bolt embers ignite through `igniteTree`
  (cap-aware, so ember ignitions still read under the flame budget).

## Verification

- `yarn test` — 295 core + 231 web, all pass, including new `combat.test.ts`
  interception cases (crown/trunk point tests, ascending crossing order,
  flat-clips/lob-clears, lob-vs-flat solution choice, wall-blocks-both
  fallback, ordered stick rolls) and new `combatFx.test.ts` cases (bolts
  strand embers with `strikeTree` fid parity, open ground never sticks,
  hammer barrels go near-vertical over blocked canopy vs flat low root
  without wood — same seed, contrasting mounts).
- `yarn typecheck` — 3 tasks successful. `yarn build` before web tests so
  the renderer picks up core changes.
- Playwright not run (per task rules).

## Files

- `packages/core/src/units/combat.ts` — canopy constants, `TreeStand`,
  `treeStickChance`, `pointInTree`, `treesOnSegment`, `flightClearsTrees`,
  `solveBallisticHigh`, `solveShotClearing`, `rollTreeStick`,
  `LOBBED_MAX_TIME`, `ELEVATION_MAX` 1.1 → 1.45.
- `packages/core/src/units/combat.test.ts` — 6 new interception cases.
- `apps/web/src/renderer/combatFx.ts` — `CombatEnv.treeStands`/
  `strikeTree`, clearing-aware `tryFire` (lob duration gate), per-segment
  interception in `advanceShots`, `stuckCount`.
- `apps/web/src/renderer/combatFx.test.ts` — 4 new interception/aim cases.
- `apps/web/src/renderer/TerrainCanvas.tsx` — stands + strike wiring.
- `.changeset/tree-interception.md` (patch), `README.md` one-liner.
