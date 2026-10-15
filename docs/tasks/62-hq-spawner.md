# Task 62 — HQ forts that send reinforcements (and can fall)

Each side now fields a fortified HQ bunker at its map end — Blue west,
Orange east, doors facing the map center. Every 40 s a live HQ slides its
door up, releases one reinforcement from its hall mouth (cycling
Flash → Stumpy → Hammer, up to 4 per side), and slides shut; the newcomer
drives out of the hall straight into the hunt pipeline. HQs take honest
splash from every nearby blast and deliberately draw aimed volleys from
guns that push inside admitted range — and since weapon ranges are now
capped under half a battle-map width, forts only take aimed fire from deep
push-ins, never cross-map lobs. A wrecked HQ stops its clock and stays as
a charred breached fort; nearby defenders rally to its attacker.

## Decision: doctrine caps, not new physics

The ballistic solver is untouched (shells still fly the low-angle root
under `GRAVITY = 140`). What changed is admission: core
`WEAPON_MAX_RANGE` (flash 900, stump 850, hammer 1000, commander 800) caps
`maxRangeFor` below every physical limit (hammer ballistics reach
V²/g ≈ 1931, bolts rode the 3 s flight-time net to 2700–3900). All caps sit
under half the 160-cell battle map (2560 wide), so mid-map duels, the
1100-unit hunt eyes, and the 220–480 stand-offs all still work, but no gun
answers a target across the map. The task-14 writeup stays historical; the
`GRAVITY` comment now notes the admitted-vs-ballistic split.

## Decision: HQs are splashable structures with aimed volleys on top

- Core `units/hq.ts` (pure + vitest-covered): `placeHqs` sites one fort per
  team at its map-end column on dry gentle ground near the middle row
  (deterministic scan, seed-offset start — terrain snapshots untouched);
  `hqAnchor` maps sites to world space like `unitAnchor`; `applyBlastToHqs`
  splashes with the same linear falloff honesty as hulls (no rng);
  `tickHqSpawn`/`spawnKindFor` own the 40 s clock, the 4-per-side cap, and
  the kind cycle.
- Renderer `hq.ts` builds the bunker (slab, walls, roof, team trim, scaled
  team ring, open hall with guide curbs toward center, `hq-door` shutter)
  plus `setDoorLift`/`poseHqWreck` (char + slammed crooked door + dropped
  roof, idempotent). `hqFx.ts` owns damage, clocks, and the
  open → hold → release → shut slide (`doorLiftAt` pure for tests).
- `CombatFx` answers structures on ~1 volley in 4 (`HQ_TARGET_CHANCE`):
  a live enemy hull inside admitted range traverses onto the fort through
  the same aim/range/solve path (own `pendingHq` goals, `-1` target —
  downstream only the shooter is ever read back). Every blast, aimed or
  collateral, also routes through the new `damageStructures` hook into HQ
  health; HQ death detonates the shared epic stack non-hostile via the new
  public `detonateStructure` (survivors hesitate, nobody is blamed).
- The canvas rallies the garrison: `onDamaged` points live same-team hulls
  near the shelled fort at the shooter through retaliation (ordered hulls
  still refuse). Reinforcements arrive via `movement.addUnit` (hall-mouth
  seat, hall→staging patrol — the hunt sweep acquires same-tick) plus
  placement push, selection marker, `HealthBars.setCount`,
  `OcclusionFx.setKinds`, and `waypoints.setRoutes`; combat's per-unit
  arrays grow on their own. HQs are shown, not selectable: square
  team-colored minimap markers (grey wrecked) + Units-box
  standing/destroyed + sent-count rows.

## Nanolathe inspiration

- `research/retail-executable-spec/04-units-orders-scripts-and-movement.md`:
  factory mobile products are allocated with a heading and delivered at the
  factory exit (`QueryBuildInfo` supplies the position). Mirrored by fixed
  hall-mouth exits where reinforcements appear facing the map center, then
  drive out through the normal movement pipeline. Deliberate
  simplifications: fixed interval + per-side cap instead of build queues and
  energy costs, cycling roster instead of player choice, no nanoframes.

## Files

- `packages/core/src/units/hq.ts` (+ `hq.test.ts`, exported from
  `index.ts`) — siting, anchors, splash, spawn clock/cap/cycle.
- `packages/core/src/units/combat.ts` (+ tests) — `WEAPON_MAX_RANGE` caps
  under half-map; admitted-vs-ballistic comment.
- `apps/web/src/renderer/hq.ts` (+ `hq.test.ts`) — bunker/hall/door view,
  wreck pose.
- `apps/web/src/renderer/hqFx.ts` (+ `hqFx.test.ts`) — damage, clocks,
  door slide, release/kill/damage hooks.
- `apps/web/src/renderer/combatFx.ts` (+ tests) — `hqTargets` /
  `damageStructures` env, `pickHqShot` / `fireAtHq` / `launchShot` split,
  `detonateStructure`.
- `apps/web/src/renderer/movement.ts` (+ test) — `addUnit`.
- `apps/web/src/renderer/units.ts` (+ test) — `buildSpawnedUnit`.
- `apps/web/src/renderer/occlusionFx.ts` (+ test) — `setKinds` growth.
- `apps/web/src/renderer/TerrainCanvas.tsx` — HQ build/wire/tick/
  resnap/dispose + `onHq` broadcast.
- `apps/web/src/App.tsx` (+ layout tests) — HQ minimap squares, Units-box
  HQ rows, explainer copy.
- `.changeset/hq-forts.md` (new) — **minor** for core + web.
- `README.md`, `docs/architecture.md` — HQ + range-cap one-liners.

## Tests

- Core `hq.test.ts` (9): end siting/determinism/anchors, splash
  falloff/clamp/once-only wreck, clock fire/cap/silence, roster cycle.
- Core `combat.test.ts` (ranges rewritten): admitted caps pinned,
  gates inside `[MIN_RANGE, maxRange]`.
- Web `hq.test.ts` (3): bunker/door/hall/ring build, slide clamp,
  idempotent wreck. `hqFx.test.ts` (4): slide curve, release at full-open
  through the hall mouth, cap + cycle, wreck-once + spawn stop + resnap.
- Web `combatFx.test.ts` (+3): aimed HQ volleys inside range (shooter
  threaded, impacts at the fort), cross-map silence, `detonateStructure`
  epic stack + hook.
- Web `movement`/`units`/`occlusion` (+1 each): mid-battle registration
  that drives its patrol, seated reinforcement bodies, ghost growth.
- Web `App.layout.test.ts` (+2): HQ minimap/Units-box copy, canvas HQ
  wiring pinned at source level.
- Existing suites untouched and green (hull-duel streams replay
  identically without HQs — `pickHqShot` draws rng only when it proceeds).

## Verification

- `yarn test` — all pass (core 375 + web 344).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
