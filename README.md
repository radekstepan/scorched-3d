# Scorched 3D

A browser remake of the classic Scorched Earth artillery game — currently a playable terrain demo: seeded TNT-style islands rendered in 3D with water, trees, rocks, a hover probe, a static Total Annihilation unit roster (Commander, Stumpy, Flash, Hammer) re-placed on every regen, and ambient skirmish fire (flat tracer bolts at muzzle velocity, ballistic shells arcing from elevating barrels under gravity, muzzle flashes, and impact explosions) traded between units whose hulls turn to face their targets while turrets traverse within clamped limits, scarring the terrain with persistent scorch decals while blasts flatten nearby trees to toppled trunks, stumps, and charred snags, ignite fringe fires that burn down through smoke to smouldering wrecks and spread to neighbours, and chip rocks toward buried rubble, while every unit patrols a seeded looping route with its hull facing travel, pitched and rolled to the terrain grade and refusing too-steep climbs, and its turret tracking targets independently — and clickable, box-selectable units (white/cyan double rings + beacon, live minimap markers) that leave patrol on right-click move orders, driving deterministic cost-weighted A* paths that prefer open easy ground (with string-pulled smoothing that refuses shortcuts back through woods and walkable, separated formation fan-out) at slope- and vegetation-dragged speed before holding where they were sent, while lateral separation steering keeps adjacent hulls from deadlocking inside each other's spacing stop (explosion scorch is a visual decal only — it never traps units).

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
