---
"@scorched-3d/core": patch
"@scorched-3d/web": minor
---

Sound toggle + fidelity: M mutes the battle without opening the panel, the Sound panel mix persists between visits, every cue gets per-shot pitch humanization, distant blasts muffle into rumbles, and selecting hulls ticks.

## Task writeup

The task asked for a sound on/off toggle and better sound effects. A synth already existed (shots/blasts/deaths/releases/acks with a Sound panel), so this change keeps that foundation and improves control and fidelity instead of rebuilding it.

## What changed

- Web (`apps/web/src/renderer/TerrainCanvas.tsx`): new optional `onToggleMute` prop fired from the canvas `keydown` handler on `KeyM` (behind the same focus guard as pan keys, so typing never mutes); `applySelection` voices the new selection tick, but only when the box gains hulls — clears, deselects, and death-drops stay silent.
- Web (`apps/web/src/App.tsx`): Mute toggle relabeled "Mute (M)" and wired to `onToggleMute`; options state seeds mute/volume from `loadSoundPrefs(localStorage)` and saves every change back via an effect (both guarded for headless renders).
- Web (`apps/web/src/renderer/sound.ts`): `SoundFx` takes an injected random stream and every admitted cue draws ±6% pitch (recorded in the `played` log, applied to oscillator and filter frequencies); new pure `soundDullForDistance` melts the noise-crackle top off explosions/deaths with distance while the sub drops keep their weight; new `select` family (soft triangle tick, 80 ms throttle); new `loadSoundPrefs`/`saveSoundPrefs` with field-by-field healing of corrupt entries and silent hostile storage.
- Tests: `sound.test.ts` (+10: pitch range/determinism, draw-only-on-admit, select family, dull curve + recording, prefs defaults/round-trip/healing/hostile storage), `App.sound.test.ts` (+2: M-key wiring, prefs seeding pins; panel-defaults pin moved to the loader).
- Docs: README sound line (M + remembered mix), `docs/architecture.md` sound row.

## Important decisions

- **Dropped cues draw no pitch.** The humanization draw happens inside the admission gate after the mute/throttle/cap/audibility checks, so a muted or throttled volley never advances the stream — a seeded run stays deterministic regardless of what gets dropped (same ordering discipline as nanolathe's variant draws).
- **Muffle the crackle, never the sub.** Distance dull scales only the noise-burst lowpass top (down to 15% far away); the sine drops are untouched, matching how lows travel — near booms crack, far barrages rumble.
- **Tick on gain, not on change.** The selection cue fires only when the selection grows, so death-drops (shrinks, already carrying the death cue) and Escape clears stay silent; RTS-standard "fresh selection" feel with no extra state.
- **Prefs heal field-by-field.** A corrupt JSON blob or a hand-edited garbage volume falls back per-field to on-at-0.8 instead of discarding a valid mute next to it, and all storage access is try/caught — prefs can never break the battle.

## Verification

- `yarn typecheck` green; new/updated suites: 37/37 pass (`sound` 29, `App.sound` 4, `combatSound` 4).
- `yarn workspace @scorched-3d/web test`: 1060 pass; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated. `yarn build` green. Playwright not run (per task rules).
