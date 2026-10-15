# Task 19 — Visible battle damage on units

Units used to shrug off everything: impacts exploded beside hulls that kept
their showroom paint forever. Blasts now splash nearby hulls with
accumulating damage, shown three ways — progressive charring (body colors
lerp toward burnt umber with damage, saturating at 0.8), grey smoke puffs
above scorched hulls (damage ≥ 0.2), and flickering orange embers plus
near-black smoke on gutted hulls (damage ≥ 0.55). Damage never heals and
units never die from it — the roster drives on, visibly battered.

- Core `units/unitDamage.ts` (new): per-unit 0..1 damage fractions plus
  `applyBlastToUnits` (point-blank hit per firing kind — hammer 0.16 down to
  flash 0.06 — with linear falloff to the kind's `BLAST_RADIUS` edge,
  clamped at 1). Pure apart from the in-place accumulation, no rng, so
  replays stay deterministic; smoke/heavy/char thresholds and `charMix`
  live here for tests.
- Renderer `unitDamageFx.ts` (new): `charredColor` pure color math plus
  `applyUnitDamageTint` (stashes each mesh's base color once in
  `userData.baseColor`, so re-tints are stable and never double-lerp; skips
  `noHighlight` selection markers whose Basic materials it never touches)
  and a `UnitDamageFx` view with two single instanced draws (smoke +
  embers, one instance per damaged hull, phase-hashed rise/flicker by unit
  index — no per-frame rng, rebuilt every tick from state).
- `combatFx.ts` owns the damage array (sized to the roster like aim pose,
  persistent like scorch — `clearTransients` and exaggeration re-snaps
  never reset it) and splashes hulls on every explosion; smoke/embers tick
  inside `update` from the internal elapsed clock.

Important decisions: damage is visual-only by design (hulls are never moved
or killed — matching how scorch never traps and blasts never shove, so
patrol/movement code is untouched and `TerrainCanvas` needed no changes);
charring rewrites existing Lambert colors in place on impact only, never
per frame; the two extra instanced draws hold the scene budget (existing
scene-size assertions still pass). No HP bars, no wrecks — out of scope
for "show damage".

Tests: `unitDamage.test.ts` pins zero-init, point-blank hits, linear
falloff to the radius edge, nearest-first ordering, accumulation, the
clamp at 1, and rng-free determinism; `unitDamageFx.test.ts` pins the
char endpoints, monotonic darkening with saturation pin, stable re-tints,
marker immunity, and smoke/ember gating with deterministic rebuild;
`combatFx.test.ts` asserts splashes accumulate into visible smoke on bare
groups and char real `buildUnits` hulls while surviving
`clearTransients`. `yarn typecheck` and `yarn test` pass (170 core +
118 web tests).
