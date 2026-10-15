# Task 64 — 3D side-view selection icons, cached on load

The selection-tray icons were flat top-down 2D glyphs (hull rect + turret
disc + barrel line) that matched no in-game silhouette. They now render as
3D thumbnails of the actual unit meshes viewed from the side and somewhat
from above, pre-rendered once per kind and reused for every tray box.

## Decisions

- Thumbnail source is the real hull construction: new
  `buildUnitIconBody(kind)` in `units.ts` runs the same `buildBody` + camo
  path the battlefield uses, minus team rings / selection markers (tray
  chrome owns team color on its own top border). Thumbnails can never drift
  from field silhouettes.
- Camera pose is side-dominant and elevated (~30°): `UNIT_ICON_CAM_DIR`
  (0.82, 0.52, 0.26) — mostly +X flank, above, slight +Z so noses/barrels
  read in depth. Per-kind framing (`unitIconFraming` / `unitIconCameraPos`,
  both pure): walker frames taller (targetY 20), long gun pulls back
  (distance 132), light tank tightest (104).
- Render chain per kind: offscreen WebGL thumbnail (shared singleton
  renderer, hemi + key + fill lights, 88px, `#0b141c` box-matched
  background) → 2D side-silhouette canvas fallback → deterministic side-view
  SVG fallback (node/vitest has no DOM/WebGL). `getUnitIconDataUrl` keeps
  the same memoize-by-kind contract.
- Cache on load without blocking: `preloadUnitIcons()` (sync, 4 tiny
  renders) plus `scheduleUnitIconPreload()` (one kind per idle callback /
  ~0 ms timeout). `App` fires the scheduler in a mount effect, so the first
  selection is pure cache hits and the main loop never stalls on load.

## Files

- `apps/web/src/renderer/units.ts` — new `buildUnitIconBody(kind)` export.
- `apps/web/src/renderer/selectionIcons.ts` — 3D thumbnail chain, pure
  framing/pose helpers, `preloadUnitIcons` + `scheduleUnitIconPreload`,
  side-view canvas/SVG fallbacks.
- `apps/web/src/App.tsx` — mount-effect `scheduleUnitIconPreload()`.
- `apps/web/src/renderer/selectionIcons.test.ts` — side-view silhouette,
  camera-pose, preload/schedule cache tests.
- `apps/web/src/renderer/units.test.ts` — icon bodies reuse real hull gear
  without markers.
- `.changeset/unit-icons-3d.md` (patch), `docs/tasks/64-unit-icons-3d.md` (this writeup).

## Verification

- `yarn typecheck` — clean.
- `yarn workspace @scorched-3d/web test` — 28 files, 351 tests pass.
- `yarn build` — turborepo build succeeds (web single-file bundle).
- Playwright not run (per task rules).
