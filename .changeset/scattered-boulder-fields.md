---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Scattered boulder fields: maps now grow rocks on open ground instead of scree-only slopes, posed with the sibling viewer's non-uniform stone bulk

## Task writeup

Rocks existed end to end (feature words 3/4, `buildRocks`, blast chipping) but almost never appeared: the only stamp was steep-slope scree (`slope > 16 && hash > 0.82`), which measured **zero rocks on five of six presets** across seeds 1/7/42 (only archipelago grew 17–31). Open plains, forests, and battle maps were barren. Maps now scatter deterministic boulder fields on dry, gentle ground, reusing the sibling tank viewer's rock construction.

## Sibling source (quoted)

`/Users/radekstepan/dev/redesign-stumpy-tank-model/src/viewer.ts:303-324`:

- `new THREE.DodecahedronGeometry(1, 0)` with `new THREE.MeshStandardMaterial({ color: 0x737867, roughness: 1, flatShading: true })`
- Per-instance bulk `rock.scale.set(1.8 + (i % 3), 1.4 + (i % 4), 2.5 + (i % 3))` and tumble `rock.rotation.set(i * 0.4, i * 0.7, i * 0.2)`, `castShadow = true`
- Golden-angle spiral placement (`a = i * 2.39996, r = 48 + (i % 7) * 12`), ground-conformed

## What changed

- Core (`packages/core/src/terrain/generate.ts`, `stampFeatures`): a third stamp branch places words 3/4 on open, dry, gentle ground — `slope < 9`, `hash2(x, z, seed + 75) > 0.94`, inside `fbm(x * 0.03, z * 0.03, seed + 78, 3) > 0.58` rockiness patches so stones cluster into fields rather than salting evenly. The cheap hash gates first so the fbm only runs on candidates. Tree and scree branches are untouched and ordered first, so tree counts are byte-identical before/after on every probed preset/seed.
- Counts (seeds 1/7/42): greenreach 278–641, archipelago 110–184, highpass 1134–1538, caldera 223–674, rivercross 740–1124, dustplains 998–1519 — proportional to open ground, ~10% of the ~15k-tree canopy at most, one instanced draw of a 36-triangle dodecahedron.
- Renderer (`apps/web/src/renderer/features.ts`): kept the established `DodecahedronGeometry(9, 0)` + `MeshLambertMaterial 0x6a5e50` (game palette; three r186 `PolyhedronGeometry` already computes flat normals, and Lambert matches the tree/HQ finish per `docs/art-direction.md` — the sibling's `0x737867` Standard material was quoted but not adopted). Adopted the sibling's non-uniform deterministic bulk: new shared `rockAxisScale(i, shrink)` (per-axis cycles around the old `0.7 + (i % 5) * 0.18` base) and `rockRotation(i)` helpers used by both `buildRocks` and `writeRockPose`, so the intact pose can never disagree between build, blast re-poses, and exaggeration re-snaps. Damage shrink factors (0.85/0.6/0.35) and tints are unchanged.

## Gameplay decision: rocks participate exactly as before

Scatter stones reuse words 3/4, so no gameplay system changes — only density:

- Movement: rocks never block (`isWalkable` ignores features); they add +2 `cellTraverseCost` and count for string-pull `legCrossesObstruction`. No crush: hull crush is trees-only, correct for low stones hulls ride over.
- Spawns/patrols: strict `tryDrop` requires `FEATURE_EMPTY` (avoids rocks); HQ pads + exit roads are cleared by `clearHqLanes` after stamping; patrol waypoints may cross rocks but cost-steering routes around fields and nothing pins.
- Sight/minimap: line-of-sight penalties are trees-only (`TreeStand` list — low stones sit below eye height); the minimap is tile-based and shows neither trees nor rocks.

## Tests

- Core `generate.test.ts` "scattered rocks": every preset grows 1–4000 rocks; every rock is dry (`h > sea + 4`) and on gentle (< 9) or scree (> 16) ground measured on the pre-construction field (HQ grading can reshape a lane neighbour's finished slope — one archipelago stone reads 11 after grading); HQ pads/roads hold no rocks; scatter is deterministic per seed and varies across seeds.
- Web `features.test.ts`: intact rock bulk is deterministically non-uniform per axis, and `writeRockPose(..., 0)` reproduces the build matrix exactly after damage.
- Full core suite 717/717 green; web 853/854 with the single failure (`deployPages.test.ts` expects workflow branch `main`, repo uses `master`) verified pre-existing on the untouched tree via `git stash`. Both typechecks clean.
