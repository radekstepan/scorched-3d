# Scorched 3D

A browser remake of the classic Scorched Earth artillery game — currently a playable terrain demo: seeded TNT-style islands rendered in 3D with water, trees, rocks, and a hover probe.

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
