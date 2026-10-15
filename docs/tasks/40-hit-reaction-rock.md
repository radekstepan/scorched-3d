# Task — Units react to hits: directional impact rock with side bias

Hulls used to take splashes with total composure: paint charred, smoke
trailed, but the body never flinched, so near-misses read as cosmetic.
Every splash now rocks the hull — a short positional shove away from the
blast plus a hull-frame pitch/roll rock — scaled by the damage the blast
actually dealt and biased so flank hits shove and heel harder than
frontal ones. The rock decays back to the grade seat in about a second;
re-hits refresh and stack under hard caps instead of launching the hull.

## What changed

- Core `units/impact.ts` (new, exported from `index.ts`): pure kick
  shaping, no rng, no clocks.
  - `impactKick(blast, unit, hullYaw, damageAdd)` decomposes the
    blast→hull direction into hull-frame forward/lateral shares. Shove
    points away from the blast; pitch tips the nose up for blasts ahead
    (negative `rotation.x` under `YXZ`) and down for blasts astern; roll
    lifts the struck flank (positive `rotation.z` for a right-flank hit).
    Magnitude scales with `1 + IMPACT_SIDE_BIAS * |lateral|` (0.6), so a
    pure flank hit lands 1.6× the rock of a pure frontal one at equal
    damage — then clamps absolutely (`IMPACT_MAX_SHOVE = 7` world units,
    `IMPACT_MAX_TILT = 0.16` rad, well under `MAX_HULL_TILT = 0.5`).
    Scaling by dealt damage reuses kind weight + linear falloff for free:
    a hammer point-blank shoves ~3.5 u / ~0.09 rad, a fringe flash-chip
    barely trembles. Coincident blasts and non-positive damage return
    zeros (an overhead hit has no flank to favour).
  - `accumulateImpact` stacks re-hits component-wise under the same caps;
    `IMPACT_DURATION = 1.1` s paces the envelope.
- Renderer `combatFx.ts`:
  - The old recoil-only map is now a unified per-unit nudge map (one
    entry per rocked hull: seated `base`, full-strength shove/tilt,
    `age`/`dur` envelope, last-applied tilt). Recoil kicks and hit rocks
    share entries, so a hull is only ever posed from a single base — no
    fighting between systems — and every entry restores exactly on
    expiry/clear. Position rides the base absolutely (shifted by patrol
    motion through the existing `shiftRecoilBase` hook); tilt applies
    relatively on top of the grade pose movement just seated.
  - `damageUnits` shapes a kick per touched live hull from the blast
    position against the hull yaw and stacks it (re-hits refresh the
    envelope). Wrecks never rock: already-dead hulls are skipped, and the
    kill transition settles the entry first — the epic burst centers on
    the seated hull and the husk sinks from there. `advanceNudges` also
    settles entries on destroyed hulls as belt-and-braces.
  - New `impactAt(i)` getter (full-strength kick, zeros when unrocked).
  - `RECOIL_KICK = 5` / `RECOIL_DURATION = 0.28` extracted as named
    consts; recoil timing and shape are byte-identical.
- `TerrainCanvas.tsx` + `combatFx.ts` module docs: the "hulls are never
  moved by blasts" invariant is now "movers never move — hulls only rock
  renderer-side". `README.md`: one-phrase splice in the damage clause.
- Tests: core `impact.test.ts` (13 cases — signs per quadrant, side-bias
  ratio, linear scaling, absolute clamps, yaw invariance, determinism,
  stack/clamp/cancellation, pacing bounds); web `combatImpact.test.ts`
  (6 cases — frontal signs + posed body, side-bias ratio through the
  public splash path, decay-to-exact-restore, clearTransients settle,
  stacked-cap bounds on entries and rendered offsets, wreck stillness
  including post-death barrages). One stale comment in `combatFx.test.ts`
  updated; no existing assertions needed changes.
- `.changeset/hit-reaction-rock.md` (new) — **patch** for core + web
  (visible but subtle battle feel; no API break).

## Important decisions

- **Renderer-side only, movers never move.** A gameplay knockback (mover
  displacement) would fight separation, spacing stops, and slope gating —
  the exact systems tasks 11/13/18/22 stabilized. The nudge restores
  exactly, so drive, pathing, and patrol never see it; only the eye does.
- **One nudge map instead of two kick systems.** Separate recoil/impact
  entries would each capture seated bases containing the other's live
  offset and restore over each other, leaking bounded residue into the
  exact-restore tests. Sharing entries keeps every restore bit-exact
  (all pre-existing recoil tests pass untouched) at the cost of one
  semantic: a hull rocked by a fresh hit doesn't add a separate recoil
  kick on its next shot — it is already displaced, which reads fine.
- **Tilt is relative, position is absolute.** Movement re-poses position
  absolutely every tick (so impact position must ride a shifted base like
  recoil anchors or the kick would render as its frame-to-frame delta),
  but slews rotation (so tilt must apply on top of the live grade pose —
  it adds to, never replaces, terrain pitch/roll). The un-apply-first
  tilt step leaves a bounded ±1-frame wobble against the slew; it decays
  with the envelope and reads as suspension oscillation.
- **No HUD change.** The rock is deliberately subtle (max 7 u on a
  ~2000 u map, max 0.16 rad tilt); nothing player-operable changed, so
  no panel/legend update — the README phrase documents it.
- **Caught while testing: coincident-blast NaN guard.** A blast at the
  exact hull center has no direction; normalizing would NaN the kick, so
  sub-epsilon distances return zeros (also covers the kill-test splash
  landing dead-center). And: the first wreck-test draft asserted the dead
  body exactly on its seat after a tick — husk sink had (correctly) moved
  Y, so the test asserts X/Z stillness plus sink instead.

## Verification

- `yarn test` — all pass (core 289 incl. 13 new impact cases; web 220
  incl. 6 new hit-reaction cases).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
