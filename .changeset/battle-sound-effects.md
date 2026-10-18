---
"@scorched-3d/core": patch
"@scorched-3d/web": minor
---

Battle sound: synthesized gunshots, blasts, deaths, HQ releases, and order acks with camera-distance volume — zoom in and the battle gets louder. Mute + volume live in a new Sound panel.

## Task writeup

There was no sound system (learnings: "No sound — visuals only"). Combat now voices every shot, blast, and death through a WebAudio synth with zero binary assets, so the single-file bundle stays sample-free.

## What changed

- Web (`apps/web/src/renderer/sound.ts`, new): `SoundFx` synth + pure `soundGainForDistance` / `stereoPan` helpers. Bolt cracks (square blip + click), shell thumps (low sine + swept noise), grenade lobs, peewee pops, explosions (noise burst + sub drop, epics longer with a second thump), death cues (blast + tearing-metal fall), HQ release clanks, and UI order acks — all through a master gain + compressor with per-voice stereo panning.
- Web (`apps/web/src/renderer/combatFx.ts`): two view-only hooks — `onShotFired` (muzzle position + kind + weapon mode, fired in `launchShot`) and `onExplosion` (impact position + kind + epic + mode, fired at the top of `explode` so evicted-pool blasts still thump). Null in headless tests; nothing reads back.
- Web (`apps/web/src/renderer/TerrainCanvas.tsx`): wires the hooks with per-event camera distance + camera-relative pan, unlocks the device on first pointer/key gesture (autoplay policy), re-syncs mute/volume from options every tick, voices deaths in `onUnitKilled`, releases in HQ `onSpawn`, acks on move/attack orders, and disposes the device on teardown.
- Core (`packages/core/src/terrain/types.ts`): `ViewOptions` gains `muted` / `volume` (view-only flags, same lane as the other toggles).
- Web (`apps/web/src/App.tsx`): new Sound panel — Mute toggle + Volume slider (defaults on at 0.8).
- Tests: `sound.test.ts` (19: attenuation, pan, peaks, throttle, voice cap, mute/volume, log cap, dispose), `combatSound.test.ts` (4: one report per round, impact + epic-structure reports, null-hook safety), `App.sound.test.ts` (2: panel defaults + canvas wiring source pins).
- Docs (`docs/architecture.md`): sound row. README gains one sound line.

## Important decisions

- **Positional by camera distance, not screen presence.** Gain is inverse falloff (`600/(600+d)`): full up close, half at 600u, a distant rumble across the map — so zooming in makes the battle louder by construction, with no extra zoom plumbing. Pan is the event offset on the camera-right axis (widened, clamped).
- **Throttle per family, cap voices globally.** Same-family repeats inside 45–200 ms drop (a volley tick cracks instead of clipping), families never mute each other, and past 16 concurrent voices new cues drop rather than steal — with sub-audible far-field cues dropped before voicing at all.
- **Headless-safe by construction.** The `AudioContext` builds lazily behind a `window.AudioContext` guard (node has none), every synth call is try/caught, and every admitted cue lands in a capped `played` log either way — so attenuation, throttle, and cap behavior are unit-tested with a manual clock and no audio hardware.
- **Nanolathe: presentation-only + positional precedent applied.** Sibling `internal/audio/doc.go` ("presentation-only… never from the simulation stream") and `positional.go` (positional attenuation, viewport-relative pan) shaped the hook→canvas→synth one-way flow and the distance/pan model; the synth voices themselves are local (nanolathe ships PCM samples, this demo synthesizes).

## Verification

- `yarn build` green; `yarn typecheck` (3 tasks) green.
- New suites: 25/25 pass (`sound` 19, `combatSound` 4, `App.sound` 2).
- `yarn workspace @scorched-3d/web test`: 1026 pass; the single failure (`deployPages.test.ts` workflow-yaml assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated. `yarn workspace @scorched-3d/core test`: 781 pass. Playwright not run (per task rules).
