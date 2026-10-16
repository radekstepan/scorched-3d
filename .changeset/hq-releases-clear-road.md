---
"@scorched-3d/web": patch
---

HQ reinforcements no longer patrol the exit road or block the entrance: each release walks the hall straight out of the mouth, then turns onto a staging loop beside the lane that never returns to the door — with successive releases alternating sides so stagings spread instead of stacking.

## Task writeup

Releases used to get a two-point patrol route of door-spawn ↔ on-road staging (320 past the mouth on the centerline), so every reinforcement drove the full road back into the hall mouth and onto the door spawn every cycle — head-on into the next release. The loop now reads `[near, far]` from the new pure `hqStagingRoute(exit, facing, side)` helper (`apps/web/src/renderer/hq.ts`): the mover still seeds at the door with leg 1, so the first leg runs door → far, and far sits ON the anchor row at the legacy 320 (the cleared lane's far end) while near sits halfway back and 96 off the lane — clear of the graded road (2.5 cells ≈ 40) plus a full spacing stop (48), so staged hulls never pin an exiting hull.

Important decisions:

- Far stays on the centerline deliberately: a straight patrol leg from inside the hall to an off-road point would grind through the hall curb wall (a ~21-wide hull crossing the curb line mid-hall), so the veer must happen past the mouth. The first leg therefore stays dead straight down the hall; only the loop turns off the lane.
- Releases stay on patrol (no hold/order): the hunt sweep refuses ordered/holding hulls, so a drive-and-hold rally would make reinforcements passive. The free-hull loop keeps same-tick hunt acquisition.
- Successive releases alternate staging sides via a per-team counter in the canvas `onSpawn` closure (deterministic — no rng, replay-safe). Both sides share the far lane-end point; the existing spacing-stop + separation steering already resolves that shared-waypoint circulation, and it sits 320 past the mouth, far from the entrance.
- No core change: core movement already drives arbitrary loops; this is route construction in the renderer plus tests.
