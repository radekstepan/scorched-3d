# Task 135: Peewee automatic rifle

The peewee's gun read like a pocket cannon: full-size bolts and a full
layered explosion stack per hit. It now fires like an automatic rifle —
small fast bullets at a rapid beat that chip lightly and crack instead of
booming.

## Changes

Core (`packages/core`):
- `WEAPON_PROFILES.peewee`: muzzle velocity 1150 → 1300 (tied fastest on
  the field), flash time 0.10 → 0.08 s.
- `SHOT_DELAY.peewee`: {0.18, 0.55} → {0.09, 0.28} — mean refire ~0.19 s,
  roughly 4x the tank mean (~0.72 s).
- `UNIT_HIT_DAMAGE.peewee`: 0.045 → 0.03; `PEEWEE_GRENADE_UNIT_DAMAGE`
  0.09 → 0.06 (keeps the 2x close-range doubling, still well under the
  hammer's 0.16).
- `HQ_HIT_DAMAGE.peewee`: 0.025 → 0.015; `PEEWEE_GRENADE_HQ_DAMAGE`
  0.05 → 0.03 (2x doubling kept; at most a light-tank chip now).
- `BLAST_RADIUS.peewee`: 28 → 20; `PEEWEE_GRENADE_BLAST_RADIUS` 32 → 24
  (still bolt < lob < Flash 36).
- Peewee scorch 14 → 10 radius, grenade scorch 16 → 12 (still under the
  Flash's 18).

Renderer (`apps/web/src/renderer/combatFx.ts`):
- `PEEWEE_BULLET_SCALE` (0.55): peewee-fired bolt heads and grenade balls
  shrink; warp tails ride along as children so the streak shrinks too.
  Muzzle core/halo and the muzzle light kick scale down to match.
- `PEEWEE_BLAST_SCALE` (0.55) + `PEEWEE_EXPLOSION_MAX_AGE` (0.7 s):
  peewee-fired impacts stage a scaled-down flash/fireball/smoke/spark
  stack with a softer light kick and a shorter staging. The ground
  ring/glow already size from the core scorch radius, so they shrank via
  the core change. Epic death bursts always stage full-size.
- New test accessors: `shotScaleAt`, `explosionScaleAt`,
  `explosionMaxAgeAt`.

## Decisions

- Rate-of-fire carries the automatic-rifle read, not just velocity: the
  shared ambient scheduler sets its next beat from the attacker's window,
  so the tighter peewee window makes rifle volleys audibly/visibly quicker
  in the mix without per-unit cooldown state.
- Per-hit damage dropped ~1/3 while rate roughly doubled, so peewee DPS
  rises modestly while each individual pop is much smaller — the "less
  dramatic" ask is about per-hit read, not total threat.
- Spawn weights derive from `UNIT_HIT_DAMAGE × BLAST_RADIUS`, so the
  weaker rifle shifts the HQ roster mix toward more peewees (1 / 0.28 /
  0.15 / 0.06, bands [.672 / .859 / .961]); the pinned-bands test and the
  weight/interval doc comments were updated to the new derived values.
  Doctrine ("weaker units more often") is unchanged.

## Tests

- Core `peewee.test.ts`: new "automatic-rifle beat" test pins the window,
  the ~4x mean, fastest muzzle velocity, and the exact damage/splash
  values plus the 2x grenade doublings.
- `hq.test.ts`: roster-band stubs updated to the new derived weights.
- Renderer `combatFx.test.ts`: peewee duel asserts shrunken heads +
  scaled-down short blasts; tank duel asserts scale 1 everywhere.
- Full suites: core 574/574, web 618/618, `typecheck` clean.
