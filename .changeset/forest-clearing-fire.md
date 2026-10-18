---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Sustained fire now clears forests instead of only setting them alight: projectiles striking trees knock them flat with a per-gun chance, and follow-up blasts topple burning or smouldering trees anywhere inside the blast — so a unit hiding in a forest can be dug out instead of staying shielded behind burning wood.

## Task writeup

# Task — Projectiles and explosions destroy trees

A unit parked in a forest was nearly unshootable: rounds stuck in crowns (55% per crossed tree for bolts) and only ever *ignited* the struck tree, while blasts flattened just the inner core (32% of the blast radius) and ignited the fringe. Burning and smouldering trees keep `standing: true` — they block projectiles and shrink sight for their full 36-second burn before resolving — so firing into a forest only started slow burns behind which the enemy sat safely.

## What changed

- Direct projectile strikes fell trees (`strikeTreeShot` in `packages/core/src/units/destruction.ts`): a round stuck in the wood knocks an intact, burning, or smouldering tree flat with a per-kind chance (hammer 0.6, commander 0.4, stump 0.35, flash 0.3, peewee rifle 0.15, peewee grenade lob 0.35); an intact tree that survives the roll ignites as before. Terminal, gone, and out-of-range trees refuse with `"none"` and cost no rng.
- Blasts clear burnt wood (`applyBlastToTrees`): fire-weakened (burning/smouldering) trees flatten anywhere inside a blast, not just the core — the first volley ignites the fringe, follow-up shells knock it flat. Core-flatten/ignite behavior for intact trees is unchanged, and terminal trees are still never re-touched.
- Renderer wiring: `CombatEnv.strikeTree` now receives the firing kind and attack mode (`combatFx.ts` passes `shot.kind`/`shot.attack`), and the canvas (`TerrainCanvas.tsx`) resolves the strike through `strikeTreeShot` — fells re-pose, join the decay set, and invalidate the stands snapshot (so interception, occlusion, and visibility agree the lane opened); ignitions glow as before.

## Decisions

- Progressive clearing over bigger cores: the instant-flatten core (`TOPPLE_FRACTION`) and the gentle-tuning caps stay untouched — forests fall to *sustained* fire (ignite, then topple the weakened wood), which keeps single stray shells from clear-cutting while still letting a duel open its own lanes. This also matches the nanolathe parallel (`internal/combat/feature_impact_test.go`: blasts accumulate damage on features until they are destroyed; projectiles collide with features).
- Fell chance scales with the gun (shells above bolts, grenades above bullets) so artillery still reads as the forest-clearing weapon without making rifles useless against wood.
- Rocks needed no change: blasts already chip them by proximity (core +2 levels, fringe +1, clamped at buried rubble).
