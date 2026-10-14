# Scorched 3D

A browser remake of the classic Scorched Earth artillery game — currently a playable terrain demo: seeded TNT-style islands rendered in 3D with water, trees, rocks, a hover probe, a static Total Annihilation unit roster (Commander, Stumpy, Flash, Hammer) re-placed on every regen, and ambient skirmish fire (tracer bolts, arcing shells, muzzle flashes, and impact explosions) traded between units whose hulls turn to face their targets while turrets traverse within clamped limits, scarring the terrain with persistent scorch decals and felling nearby trees and rocks into stumps and rubble, while every unit patrols a seeded looping route with its hull facing travel and its turret tracking targets independently — and clickable, box-selectable units (amber rings, live minimap markers) that leave patrol on right-click move orders, driving deterministic A* paths with string-pulled smoothing and formation fan-out before holding where they were sent.

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
