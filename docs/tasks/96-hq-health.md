# Task — Show health over HQ (if toggled)

Units already float billboarded health bars while the View menu `Health`
toggle is on (see `docs/tasks/34-overhead-health.md`, on by default since
`docs/tasks/76-health-on-by-default.md`), but the two team HQ forts showed
nothing — shelling a works gave no at-a-glance readout. Each live HQ now
draws its own overhead bar behind the same toggle.

## What changed

- Renderer (`apps/web/src/renderer/healthBars.ts`): `HealthBars` gains an
  HQ roster alongside the unit roster —
  - new `HQ_HEALTH_BAR_WIDTH` (72), `HQ_HEALTH_BAR_HEIGHT` (5), and
    `HQ_HEALTH_BAR_LIFT` (64): wider than a hull bar so the readout holds
    against the 96-wide works, seated above the monitor roof + chimney
    caps, same near-black frame / left-draining fill / depth-off policy;
  - new `HqHealthSource` (`damageAt` + `isDestroyedAt`, which `HqFx`
    already satisfies structurally) plus `setHqCount` / `updateHq` /
    `hqFraction` / `isHqShown` mirroring the unit API — same
    `healthFraction` + `healthColorFor` ramp, same billboard-via-camera
    copy, wrecks hidden, toggle-off hides up front with no re-seat churn;
  - HQ bars live in the same `healthbars` scene group (named
    `hq-healthbar`) under the one visibility flag, so `setVisible` and
    `dispose` cover both rosters with no second group to wire.
- Renderer (`apps/web/src/renderer/hqFx.ts`): new `groupAt(index)` anchor
  accessor (null past the roster) so the canvas can seat bars on the live
  fort groups.
- Canvas (`apps/web/src/renderer/TerrainCanvas.tsx`): sizes the HQ roster
  from `hq.count` at build and ticks `updateHq(hq, groups, camera)` behind
  `setVisible(opt.showHealth)` right after the unit-bar update — one flag,
  both rosters, no re-snap hook (bars re-seat from live anchors per tick).
- Tests: 5 new `healthBars.test.ts` cases driving the real class headless
  (full bars over both real `buildHq(0/1)` works, roofline seating +
  width + billboarding, drain/recolor, wreck + toggle-off hiding with
  opt-back-in, HQ roster resize); 1 new `hqFx.test.ts` case pinning
  `groupAt` (distinct groups, null past roster) plus the live feed —
  pristine forts full, one hammer splash drains, forty wreck and hide only
  the dead fort; 2 new `App.health.test.ts` source-level cases pinning the
  canvas wiring (`setHqCount(`, `updateHq(` + `groupAt(`).
- `.changeset/hq-health.md` (new) — **patch** for web (view-only
  addition, no sim change).

## Important decisions

- **Wider fort bar, same toggle and ramp.** A hull-width bar would vanish
  over the 96-wide factory; 72 wide × 5 tall at lift 64 (roof furniture
  tops out ~44) reads at map-end distances while staying the same visual
  language as unit bars.
- **One HealthBars instance, two rosters.** A second instance would double
  the `healthbars` scene-group name and the per-tick visibility calls; the
  HQ roster rides the existing group/flag/dispose for free.
- **No core change.** HQ damage is already a 0..1 fraction with
  `isHqDestroyed`, so the renderer reuses `healthFraction` directly.
- **No README change.** Small view-toggle extension like the health
  default flip; the View panel is self-documenting.

## Verification

- Targeted: `healthBars` + `hqFx` + `App.health` — 25 passed.
- `yarn workspace @scorched-3d/core test` — 486 passed.
- Web full suite: 438 passed, 1 failed in `combatFx.test.ts` ("dead hulls
  stop firing and stop drawing fire") — pre-existing on clean main
  (reproduced with changes stashed), unrelated to this task.
- `yarn typecheck` — 3 tasks successful.
- Playwright not run (per task rules).
