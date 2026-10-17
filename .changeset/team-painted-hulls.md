---
"@scorched-3d/web": minor
---

Team-painted unit hulls: every battlefield unit now wears its side's livery — commander blue for Blue, a hue-matched orange for Orange — so team identity reads from the hulls themselves at gameplay distance, not just from ground rings.

## Task writeup

Units previously wore neutral kind finishes on the battlefield (olive Stumpy, blue-grey Flash, grey Hammer, sand Peewee, blue Commander) with side identity carried only by ground rings, HUD chips, minimap dots, and HQ trim/flags. All five builders (`commander`, `stump`, `flash`, `hammer`, `peewee`) now take an optional `TeamLivery` and remap their paint-family finishes — dominant paint plus the light secondary armor — onto the team colors at attach time. `buildUnits`/`buildSpawnedUnit` pass the side's livery; tray thumbnails (`buildUnitIconBody`) stay team-neutral since the tray carries team color on its own border.

## Decisions

- Blue is the commander's exact hull blue `0x3d719b` (H 206.8°, S 43.5%, L 42.4%), so blue commanders look unchanged and the side matches its leader. Orange is that blue hue-rotated 180° to `0x9b673d` (H 26.8°, S 43.5%, L 42.4%) — identical saturation/lightness, and hue 26.8° vs the `TEAM_DEFS` orange 27.0°, i.e. the team's established orange family muted to commander-blue vibrancy so both sides pop equally. Reused the orange family rather than inventing a divergent red per the brief. Panels are each paint lightened 35% toward white (`0x81a3be` / `0xbe9c81`), preserving the two-tone armor breaks in the team hue.
- Bright `TEAM_DEFS` colors (`0x38bdf8`/`0xfb923c`) stay on UI layers (rings, flags, HUD, minimap) where small bright marks punch through fog; the muted pair is the hull albedo, which reads correctly under Lambert shading + camo multiply + valley fog.
- Remap-at-attach (not design-time): the baked `[color, geometry]` templates stay shared across teams — only per-instance material colors change — so geometry caching, disposal, and per-unit material independence are untouched. Camo eligibility still keys off the original kind finishes, and the grayscale camo multiply preserves the team hue exactly.
- Tank lower strakes (the `UNIT_DEFS.<kind>.color` band) join the main paint under a livery but keep their kind color in neutral builds (pinned by test — an early cut collapsed them unconditionally and broke the neutral-thumbnail contract).
- Bare metal, recesses, optics, wheels/tracks, and small functional accents (commander gold, flash marks, hammer breech orange) keep kind finishes. Damage charring and wreck char key off stashed base colors, so team paint chars readably while live and dies to near-black — wrecks never read as team paint. Selection/hover/health-bar layers untouched.
- This explicitly retires the no-hull-tint policy: updated the stale sentences in `docs/art-direction.md`, `camo.ts`, and `units.ts` (team rings now reinforce hull identity rather than carrying it alone). `docs/learnings.md` history left as a record.

## Files

- `apps/web/src/renderer/teamPaint.ts` (new) — `TEAM_HULL_PAINT`/`TEAM_HULL_PANEL`, `TeamLivery`, `teamLivery(team)`.
- `apps/web/src/renderer/{commander,stumpy,flash,hammer,peewee}.ts` — optional `livery` param + attach-time remap; geometry templates shared.
- `apps/web/src/renderer/units.ts` — `buildBody` threads team through; `buildUnits`/`buildSpawnedUnit` pass it; icon bodies unchanged.
- `apps/web/src/renderer/teamPaint.test.ts` (new) — 5 cases: exact hexes, panel-lighter-than-paint, every kind × team wears its livery with no cross-team paint, icon bodies neutral (incl. strake colors), live char readable + wreck char kills team paint.
- `apps/web/src/renderer/unitDamageFx.test.ts` — contract update: pristine battlefield hull wears the team livery, kind def colors describe the icon body (asserts both now).
- `apps/web/src/renderer/camo.ts`, `docs/art-direction.md` — stale no-tint sentences updated.

## Verification

- `yarn workspace @scorched-3d/web test` — 858/859 pass; the single failure (`deployPages.test.ts` branch assertion) reproduces on the untouched tree via `git stash`, so it is pre-existing and unrelated.
- `yarn workspace @scorched-3d/web typecheck` — clean.
- No core changes, so no core rebuild needed. Playwright not run (per task rules).
