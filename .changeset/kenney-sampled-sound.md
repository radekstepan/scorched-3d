---
"@scorched-3d/web": minor
---

Kenney-sampled battle sound: the WebAudio synth (oscillators + filtered noise) is completely replaced by real samples from Kenney's Interface Sounds and Sci-Fi Sounds packs (CC0, licenses vendored in `apps/web/src/renderer/sfx/`)

## What changed

- New sample alias registry (`apps/web/src/renderer/samples.ts`, inspired by nanolathe's `internal/audio/registry.go` + `sample.go`): stable aliases decouple authored cue references from file paths, and pure `shotLayers` / `explosionLayers` / `deathLayers` / `spawnLayers` resolvers map every kind × attack × epic combination to one or two layers (alias + trim + delay). HUD cues use fixed aliases (`confirm`, `selectTick`).
- Curated subset vendored in `apps/web/src/renderer/sfx/`: 13 of ~180 pack files (~290 KB) — peewee/bolt/shell lasers, grenade metal thud, three explosion crunches, two low-frequency booms, metal tear, factory door clank, confirm + select UI blips. Vite inlines them as data URLs into the single-file bundle (+~390 KB). Both Kenney `License.txt` files ship next to the samples.
- `SoundFx` rewrite of the voicing layer only: samples fetch + decode once per device on `unlock()` into a session cache; each admitted cue voices its layers through gain (peak × trim × distance), stereo pan, playback-rate humanization, and a distance lowpass for blasts. Admission is byte-identical — throttle windows, voice cap, family peaks, pitch draws, dull curve, prefs — so all 31 existing `sound.test.ts` cases pass untouched.
- Small fix folded in: the old synth voices ignored camera distance in the actual audio (only the `played` log attenuated). Sample voices now apply `soundGainForDistance`, so zooming in really does make the battle louder, as the docs always claimed.
- 9 new tests in `samples.test.ts`: manifest shape, every alias vendored on disk with `OggS` magic, no unreferenced binaries (bundle-bloat guard), both licenses present and naming CC0/Kenney, full resolver coverage, and a synth-removal assertion (`sound.ts` has no oscillator/noise code anymore).

## Decisions

- Curated subset over whole packs: the full zips (~7 MB) would triple the single-file bundle for samples the mix never voices. Re-curate from `~/Downloads/kenney_*.zip` if the mix grows.
- Fixed sample per voice, no random variant draws: the pitch stream is pinned by tests (dropped cues must cost no draws), so humanization stays on playback rate only.
- Voice-slot durations kept staged (not real sample lengths): the 16-voice cap test depends on the 1.2/1.3 s epic/death slots; slots are admission accounting, not audio.
- `README.md` credits Kenney next to the sound paragraph.

## Verification

- `yarn test`: 1128 pass; 1 pre-existing failure in `deployPages.test.ts` ("pushes to the default branch" expects `branches: ["main"]`, workflow has `["master"]`) — fails on the untouched base too, out of scope for this task.
- `yarn typecheck`: 3 tasks successful. `yarn build`: single-file `dist/index.html` (1.5 MB) builds fine.
- Playwright not run (per task rules).
