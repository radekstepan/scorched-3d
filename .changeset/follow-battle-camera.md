---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Follow-battle camera: a View-menu toggle that glides the orbit camera toward the centroid of recent combat, so the action stays framed without manual hunting

## Task writeup

# Follow-battle camera

The battle runs itself across a 320×256-cell map, but the camera sat where the player left it — following the fighting meant chasing it by hand with pan keys and drags. A new `Follow battle` toggle in the View menu auto-tracks the centroid of recent impacts: every explosion stamps a 6-second ring, and the tick glides the orbit rig toward the live average while the toggle is on.

## What changed

- Core `terrain/types.ts`: new `ViewOptions.followBattle` flag (view-only, no sim — the §10 pattern).
- Web `followBattle.ts` (new, framework-free): `CombatEventTracker` (capped 64-impact ring, 6 s window, null centroid on a quiet field), `followBattleStep` (exponential approach that never overshoots, rests inside an 8u deadzone), and `followSuppressed` (gesture + resume-delay hold).
- Web `combatFx.ts`: new `onCombatEvent(x, z)` hook fired once per impact in `explode()` — hostile volleys, wreck cook-offs, and structure detonations all report, since all three are action worth watching.
- Web `TerrainCanvas.tsx`: assigns the hook into a canvas-owned tracker, ages the ring on battle dt every tick, and — only while the toggle is on and no manual input holds the camera — translates camera + target rigidly through the keyboard-pan path (same edge clamps incl. the pan-back wall and the minimap-jump exemption, so yaw/pitch/zoom survive). Manual input (keyboard pan, orbit/drag/zoom gestures via controls start/end, minimap jumps) pauses the glide; it resumes 3 s after the last input with the toggle still on. Mode off leaves the camera path untouched.
- Web `App.tsx`: `followBattle: false` default + `Follow battle` toggle next to Territory.
- Tests: `followBattle.test.ts` (ring windowing/cap/centroid, hold timing, glide convergence/overshoot/deadzone), `App.followBattle.test.ts` (source-level default/toggle/tick/hold wiring), one `combatFx.test.ts` case (hook fires per impact via `detonateStructure`, null-safe). The two clamp-site pin tests (`App.minimap`, `cameraPan`) now cover three carrying sites — the follow glide is the third rigid-translation path.
- `docs/architecture.md`: key-files row for the new module.

## Why

Unattended battles drift away from a static camera: mid-map contacts, deep HQ pushes, and reinforcement skirmishes all happen off-screen while the player pans blind. A centroid glide keeps the current fight centered automatically, and tracking impacts (not hulls) means the camera follows where rounds land — including fort bombardments and cook-offs — rather than where the roster happens to stand.

## Key decisions

- Manual input pauses, never exits: the toggle stays on, so the user borrows the camera (a glance at the HQ, a zoomed look at a duel) and follow resumes after 3 s. Exiting would force re-toggling after every glance; a canvas→App exit callback would also add state round-trips the hold avoids.
- Track impacts, not units: `explode()` is the single funnel every blast already flows through, so one hook covers volleys, kills, and HQ deaths with no per-unit polling and no sim coupling. A quiet field yields a null centroid and the camera rests — never drifts to a stale point.
- Glide through the keyboard-pan path: rigid camera+target translation + the existing clamps (target clamp, pan-back wall, jump exemption) preserves angle/zoom and reuses proven edge behavior instead of a second clamp system. The two pin tests legitimately grew from two sites to three.
- Exponential approach over fixed speed: `1 − exp(−2.5·dt)` of the remaining gap closes ~99% in 2 s from any distance, never overshoots, and settles into the deadzone without micro-jitter — no per-zoom speed tuning needed.
- Nanolathe sibling checked for precedent: retail TA's follow camera tracks one selected unit via the host-frame scroll pass (`07-interface-input-camera-and-front-end.md`, [R-CAM-01 §12]) — borrowed the shape (follow state is presentation-only, written once per frame, never read back by the sim) but tracked a combat centroid instead of a hull, since this battle has no player-selected unit to follow.
