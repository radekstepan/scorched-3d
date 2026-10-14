# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed in docs/tasks. Record any important decisions in that writeup.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over (in `docs/learnings.md`).
9. Each subagent must add a changeset (`yarn changeset`) describing its change and include it in the same commit, so versions keep moving. See `.changeset/README.md` and the "Versioning" section in `docs/development.md` for the workflow.

Use sibling `nanolathe` repo for inspiration.

## List

Tanks are driving sideaways...

It should be harder driving through rough terrain, trees etc.

Show damage to models, like charring, smoke here and there etc.

Improve the trees on fire, the fire looks like little cones...

The brown blotches on the ground are weird. Is that from projectiles exploding? Make them more "believable. And you can "flatten the terrain a tiny bit. Right now it looks like mud.

Some of the units are scaling too high of a terrain, make the physics look more believable. And start with a smaller height scale.

## Writeups

### Task 1 — Tanks driving sideways (fixed)

Root cause was not the steering code: core `driveToward` already turns the
hull toward the target at the kind's turn rate and then displaces the mover
along the hull forward vector `(sin(hull), cos(hull))` — travel always equals
hull yaw (locked by `movement.test.ts` "never snaps the hull"). The sideways
read came from the meshes and their seating footprints:

- Tank hull boxes in `apps/web/src/renderer/units.ts` were wider (X) than
  deep (Z, the travel axis): flash 18×13, stump 26×18, hammer 24×16. A hull
  wider than long reads as strafing even with a correct yaw.
- `HULL_FOOTPRINT` in `packages/core/src/units/terrain.ts` matched the
  sideways boxes (`halfWid > halfLen` for all three tanks), so grade
  pitch/roll leaned across the hull instead of nose/tail along it.

Fix: swapped tank hull/trim/turret boxes lengthwise (flash 13×18, stump
18×26 + 19×27 trim + 12×14 turret, hammer 16×24; turret Z offsets and barrel
pivots unchanged — they still sit inside the longer hulls with the muzzle
overhanging the nose) and swapped the footprints to `halfLen > halfWid`
(flash 10/8, stump 14/10, hammer 13/9). Commander untouched — a biped is
correctly shoulder-wide. Muzzle forward throws already cleared the new noses,
so no weapon math changed.

Tests: `terrain.test.ts` asserts tank footprints run long along travel;
`units.test.ts` asserts tank hull bounding boxes are deeper (Z) than wide
(commander asserted opposite) and that every muzzle tip throws ahead of its
hull nose in the model frame. `yarn typecheck` and `yarn test` pass
(152 core + 109 web tests).
