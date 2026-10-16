---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Peewee rapid-fire gun plus close-range grenade lob: walker guns (peewee, commander) cycle the ambient scheduler roughly twice as fast as tank guns for lighter per-hit damage, and peewees inside 220 units lob slow high-arc green grenades (harder splash than the peashooter bolt, still lighter than artillery) instead of firing flat bolts

## Task writeup (moved from docs/tasks/89-peewee-gun-grenades.md)

# 89 — Peewee rapid-fire gun + close-range grenade lob

The Peewee scout now fights like light infantry instead of a slow popgun:
a commander-quick rapid-fire peashooter (lighter hits, faster rate) plus a
close-range grenade lob on a steep mortar arc once it closes to knife-fight
range.

## Rapid fire (commander-like)

- Core `combat.ts`: new per-kind `SHOT_DELAY` table. Walker guns cycle
  roughly twice as fast as tank guns — peewee 0.18–0.55 s, commander
  0.22–0.65 s, tanks keep the legacy 0.35–1.1 s window exactly — with
  `shotDelayFor` / `nextShotDelayFor` helpers. The retail Peewee's `emg`
  slot authors a 0.4 s reload with 3-round bursts against much slower tank
  pieces (see nanolathe `peewee_cadence_test.go`); the demo reads the same
  split at the ambient scheduler.
- Renderer `combatFx.ts`: the shared ambient timer reloads from the kind
  that just fired (`lastKind`), so peewee/commander volleys quicken the
  cadence while tank volleys keep the legacy pace. Deliberate simplification:
  one ambient gun at a time, no per-unit cooldown state — the attacker's
  refire sets the next beat.
- Per-hit damage is untouched (peewee bolt stays the weakest on the field at
  0.045 hull / 0.025 HQ), so the faster rate buys back damage-per-second
  instead of stacking on top of it.

## Grenade lob (close up)

- Core `combat.ts`: `PEEWEE_GRENADE_RANGE = 220` (just past the 180
  knife-fight stand-off, well inside the 550 bolt reach — bolts on approach,
  lobs once closed), `PEEWEE_GRENADE_SPEED = 300`, green tint `0xb8f39b`.
  `peeweeAttackFor` / `isPeeweeGrenadeRange` gate the mode;
  `solvePeeweeGrenade` solves the HIGH-angle root (mortar lob hanging ~4 s
  over 200 units) where the hammer cannon prefers the flat low root at
  520 u/s — same gravity, same solver family, opposite root, so the arc
  never reads as artillery fire. `solveShotClearing` takes an optional
  `AttackMode` (`"round" | "grenade"`, new in `types.ts`) and routes grenade
  volleys straight to the lob.
- Splash: `PEEWEE_GRENADE_BLAST_RADIUS = 32` (over the bolt's 28, under the
  Flash's 36 — the "smallest splash" doctrine holds for primary guns),
  0.09 hull / 0.05 HQ (double the bolt, still well under the hammer's 0.16),
  scorch 16 / 0.42 (over the bolt's 14, under the Flash's 18). New
  `blastRadiusFor` / `scorchForAttack` / `unitHitDamage` / `hqHitDamage`
  helpers; `applyBlastToUnits` / `applyBlastToHqs` take an optional trailing
  `attack` defaulting to `"round"`, so every legacy call site is bit-identical.
- Renderer: `launchShot` picks grenade mode for peewees inside grenade range
  (shell mesh, green tint, gravity flight, lob damage/radius); grenades
  detonate as early bursts in wood like shells (`gravity > 0` replaces the
  `kind === "hammer"` check); `explode` / `scarGround` / `damageUnits` thread
  the attack through to scorch, craters, hull splash, and `damageStructures`
  → `hqFx.splash` (both gained an optional trailing `attack`).

## Tests

- Core `peewee.test.ts` (+5): walker cadence windows under tank ends with
  tank windows equal to the legacy global; refire draws inside the peewee
  window with ~2x the tank mean; grenade/bolt gating around 220 (and the
  50-unit muzzle gate); lob is slower, steeper-than-45°, longer-hang than a
  bolt, lands on its mark; grenade splash/scorch sit between bolt and tank.
- Renderer `combatFx.test.ts` (+3, `grenadeCount` getter): 150-duel lobs
  only grenades; 400-duel fires bolts only; a 60 s close duel carries hull
  damage from landed lobs.

## Verification

`yarn test` clean (core 456, web 416), `yarn typecheck` clean, `yarn build`
clean. No Playwright (per brief).
