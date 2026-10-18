---
"@scorched-3d/web": patch
---

Sound is now muted by default. First visit (and any visit with no saved Sound prefs) opens with the Mute toggle on; unmuting once persists via the existing prefs, and the M key still toggles.

## Task writeup

Fresh visits auto-played battle audio at 0.8 volume with no prior consent — browsers gate the device behind a first gesture, but the first click then unleashed the full mix. The factory default is now muted at 0.8: silence until the player opts in, one click (or M) to enable, and the choice persists across reloads.

## What changed

- Web (`apps/web/src/renderer/sound.ts`): `SOUND_DEFAULT_PREFS` flips to `{ muted: true, volume: 0.8 }`. The raw `SoundFx` synth keeps its unmuted constructor default — muting is a product pref, and `TerrainCanvas` re-syncs mute/volume from options every tick, so the prefs default fully governs what the player hears.
- Web (`apps/web/src/renderer/sound.ts`): prefs key versioned to `scorched-3d:sound:v2`. The v1 key auto-saved the old unmuted default on every visit, so a stored v1 `muted:false` was never an explicit choice and must not override the new default; v1 entries are now ignored (one re-unmute for players who had explicitly enabled sound).
- Web (`apps/web/src/App.tsx`): seeding comment updated (missing/corrupt entries fall back to muted at 0.8).
- Tests: `sound.test.ts` prefs block updated to the muted default, plus two new cases — an explicit stored `muted:false` still wins over the default, and a legacy v1-only entry is ignored; `App.sound.test.ts` factory-mix pin updated.

## Important decisions

- **Version the storage key, not just the default.** Without the `:v2` bump, every returning visitor's auto-saved v1 `muted:false` would have kept them unmuted and the task would have had no visible effect for exactly the people who asked for it.
- **No `SoundFx` constructor change.** The synth is pref-driven plumbing synced every frame; flipping its internal default would churn ~15 voice tests for zero behavioral difference. The user-facing contract (prefs default → App seed → per-tick sync) is what changed and what the tests pin.

## Verification

- New/updated suites: 39/39 pass (`sound` 31, `App.sound` 4, `combatSound` 4).
- `yarn workspace @scorched-3d/web test`: 1073 pass; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated (also noted in an earlier changeset). Typecheck clean. Playwright not run (per task rules).
