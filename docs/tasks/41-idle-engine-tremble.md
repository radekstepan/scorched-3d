# Task — Idle engine tremble: live units shiver faintly at rest

Hulls at rest used to sit dead still between exchanges: engine running,
body frozen, so a held position read as a paused simulation rather than an
idling machine. Every live hull now trembles faintly while it holds — a tiny
position jitter plus a pitch/roll judder (averaged sine pairs on a
deterministic clock, phased per unit) — that pauses while the hull drives
and never touches a wreck. Visual only: movers never move, so drive,
pathing, separation, selection, and ballistics never see it.

## What changed

- Renderer `units.ts` (no core change — the tremble is pure presentation):
  - `IDLE_POS = 0.35` / `IDLE_TILT = 0.005` bounds (sub-cell, ~0.3° judder —
    an order below the 5 u recoil kick and the 7 u / 0.16 rad
    hit-reaction clamps).
  - `idleTremble(elapsed, index)` pure shaper (no rng, deterministic given
    the same tick sequence; shared scratch return, no per-frame allocation).
  - `applyIdleTremble` / `clearIdleTremble`: pose the jitter on the body;
    only the tilt judder is recorded (in `userData`, next to the locomotion
    spin/gait) — position needs no bookkeeping because the seat
    absolute-sets X/Z every pose.
- Renderer `movement.ts` (owns the tremble, next to locomotion):
  - New deterministic `elapsed` clock (advanced by `update` only).
  - `pose` always sheds last tick's judder first, then seats, then trembles
    only live hulls with zero travel this tick (`dx === 0 && dz === 0` —
    driving hulls already read as alive, wrecks hold still). Re-snaps seat
    exactly without trembling.
- Tests: new `idleTremble.test.ts` (7 cases — shaper bounds/determinism/
  phasing, apply/clear exactness, held-hull bounds with a frozen mover,
  driving-hull exactness, wreck stillness, additive stacking with a live
  hit-reaction rock plus post-rock healing, exact re-seat);
  `movement.test.ts` (2 assertions updated — arrival-hold now asserts a
  frozen mover plus bounded shiver; the tree-belt re-seat now asserts the
  exact mover seat). No combat test needed changes (combat is untouched).
- `README.md`: one-phrase splice in the patrol clause.
- `.changeset/idle-engine-tremble.md` (new) — **patch** for web.

## Important decisions

- **Movement owns it, not combat.** The first cut put the tremble in
  `CombatFx` next to the nudge map — wrong home, found empirically: the
  nudge writes position absolutely every active tick (plus once on
  expiry), which wiped the previous idle offset and turned the idle
  un-apply into a ghost subtract, leaving a permanent ~0.15 u bias after
  every rock expired in headless tests. Movement already re-seats position
  absolutely (no ghost class can exist), already knows rest (travelled
  distance) and death (wreck flags) natively with no hook flags, and its
  absolute seat heals any combat displacement the next tick. Combat needed
  zero changes.
- **Tilt stacks, position yields — never fights.** Combat only ever
  un-applies its own tilt, so the idle judder rides under a rock exactly
  (asserted bit-exact in the stacking test); the rock's absolute position
  write displaces the idle jitter during its ~1 s envelope (7 u vs 0.35 u —
  invisible), and the next movement pose re-seats from the mover. No
  residue, no oscillation, `impactAt` stays pure rock.
- **Rest means zero travel, including spacing holds.** Hulls pinned by
  separation or slope clamps (`dx === 0 && dz === 0`) tremble — an engine
  idling in traffic — while anything actually rolling holds its exact seat.
- **No HUD change.** Sub-cell, sub-degree, mover-exact: nothing
  player-operable changed, so no panel/legend update — the README phrase
  documents it.
- **Caught while testing: resnap must not tremble.** The first movement
  cut trembled through re-seats, which broke the tree-belt test's exact
  X/Z seating assertion — re-snaps now pose with tremble off (still
  shedding the old judder), so exaggeration changes land bit-exactly.

## Verification

- `yarn test` — all pass (web 227 incl. 7 new idle cases; core untouched,
  suite green).
- `yarn typecheck` — 3 tasks successful.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
