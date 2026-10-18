---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Destroying the enemy HQ ends the war: the surviving factory stands down and stops producing units

## Task writeup

The report: "When enemy HQ is destroyed, stop producing units!"

Investigation showed the destroyed HQ already goes silent — `HqFx.update` skips wrecked forts and `tickHqSpawn` gates on `hqAlive` (covered by the existing "wrecks once under fire and stops spawning" test). The audible gap was the *surviving* HQ: after its enemy fell it kept reinforcing forever against nothing, since the endless-production change made a live HQ produce indefinitely while it stands. So this is a behavior change, not a bug fix: the first wreck now ends the war for both sides.

## What changed

- Web (`apps/web/src/renderer/hqFx.ts`): `update` computes `warOver` from the wreck flags once per tick and passes `!warOver` as the `hqAlive` gate to `tickHqSpawn`. The dead gate freezes the survivor's countdown (no decrement, no draw, no release) while beacons, flags, and doors keep animating.
- Core (`packages/core/src/units/hq.ts`): comment-only — the module header, `tickHqSpawn`, and `HqSpawnState.timer` now document that production runs while *both* works stand and callers gate on any-HQ-falls. No signature or pacing change.
- Tests (`apps/web/src/renderer/hqFx.test.ts`): "stands the surviving factory down once the enemy HQ falls" (both forts release once, east flattened, long ticks + door drains produce nothing more, `spawned` frozen at 1/1) and "walks an in-flight release out after the enemy HQ falls" (a door already sliding when the war ends still delivers, then silence). Both fail on the pre-fix line and pass with it.
- Docs: README factory paragraph gains the stand-down sentence; `docs/architecture.md` HQ row now reads "indefinite production while both works stand".

## Important decisions

- **Freeze the clock, don't just block the release.** Gating the `tickHqSpawn` call (rather than suppressing `onSpawn`) leaves the countdown frozen via the existing dead gate — no timer drift, no consumed rng draws, deterministic replays.
- **In-flight doors walk out.** A release mid-slide when the other HQ falls still delivers instead of freezing mid-door; only *new* clocks stay frozen. Cancelling would need a door-shut path for a fort that was never wrecked, and one straggler exiting reads naturally.
- **No HUD change.** The surviving fort still stands, so its minimap marker stays team-colored and its pace readout keeps showing hypothetical build pace; only production halts. Nanolathe parallel: TA-style commander-death rules where killing the key structure decides the battle.

## Verification

- `yarn workspace @scorched-3d/core build`, then core tests: 826/826 pass.
- Web `hqFx.test.ts`: 18/18 pass; full web suite 1119/1120 with the single failure in `deployPages.test.ts` (workflow-yaml assertion, files untouched by this change — pre-existing, also documented as such in the earlier endless-production changeset). Playwright not run (per task rules).
- `yarn typecheck` green across all workspaces.
