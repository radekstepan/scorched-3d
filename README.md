# Scorched 3D

A browser remake of the classic Scorched Earth artillery game — currently a playable terrain demo: seeded TNT-style islands rendered in 3D at a gentle default height scale with water, trees, rocks, a hover probe, a static Total Annihilation unit roster (Commander, Stumpy, Flash, Hammer) re-placed on every regen, and ambient skirmish fire (flat tracer bolts at muzzle velocity, ballistic shells arcing from elevating barrels under gravity, layered core-plus-halo muzzle flashes, and layered impact explosions with fireball, smoke, shockwave ring, and lingering glow that wash downhill on graded ground instead of stamping flat circles) traded between units whose hulls turn to face their targets while turrets traverse within clamped limits, scarring the terrain with persistent scorch decals (charred centers fading to scorched rims with irregular edges, draped to the terrain normal and stretched down the fall line on slopes, each blast denting a tiny visual crater bowl deeper downhill than uphill) while blasts flatten nearby trees to toppled trunks, stumps, and charred snags that sink and decay away, ignite layered fringe fires (outer/core flames, embers, smoke columns, ground glow) that burn down through smoke to smouldering wrecks and spread to neighbours, and chip rocks toward buried rubble, while near-misses splash the hulls themselves with accumulating damage (charring paint, smoke, then embers — and exhausted hulls die epicly in a scaled-up layered burst, lingering as smouldering husks that slowly sink, gutter out, and vanish while no longer firing, driving, selecting, or drawing fire), while every unit patrols a seeded looping route with its hull facing travel, pitched and rolled to the terrain grade through slew-limited tilt and refusing climbs past retail-tank slope limits, tracked hulls rolling on spinning road wheels while the walker strides an alternating leg gait that settles to neutral at rest, and its turret tracking targets independently with a weightier, slower traverse — and clickable, box-selectable units (white/cyan double rings + beacon, live minimap markers) that leave patrol on right-click move orders, driving deterministic cost-weighted A* paths that prefer open easy ground (with string-pulled smoothing that refuses shortcuts back through woods, trunk-keepout steering that routes legs around standing trunks while hulls crush through wood they must cross, felling trees at a crawl, and walkable, separated formation fan-out) at slope- and vegetation-dragged speed before holding where they were sent, while lateral separation steering keeps adjacent hulls from deadlocking inside each other's spacing stop (explosion scorch and crater bowls are visual decals/mesh dents only — they never alter heights or walkability or trap units).

## Start the app

1. Install the Node version from `.nvmrc`.
2. Run `yarn install`.
3. Run `yarn build` one time (builds `@scorched-3d/core` so the web app can resolve it).
4. Run `yarn dev`.
5. Open the printed URL in your browser (usually `http://localhost:5173`).

More commands:

- Run `yarn typecheck` to check types.
- Run `yarn test` to run tests.
- Run `yarn build` to produce the single-file production bundle (`apps/web/dist/index.html`).

For more steps, read [Development](docs/development.md).

## More information

- [Architecture](docs/architecture.md) shows workspaces, files, and build notes.
- [Development](docs/development.md) shows how to extend and verify the app.
