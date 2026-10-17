---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Show the current game build version in the top-right header, including on narrow screens. The old badge read the last released `APP_VERSION` (still 0.1.0 despite the accumulated pending changes), so it did not identify the game being played.

Derive the build number from the official Changesets release plan when Vite starts or builds, falling back to the shared workspace version when nothing is pending. Existing minor changes make this build 0.2.0; multiple pending patch changes are one release, not an invented increment per commit. Preserve `APP_VERSION` as the released package identity and the explicit `yarn version-packages` release workflow. No changesets are consumed and no tracked source files are rewritten during startup. Following nanolathe's separation of engine build identity from content identity, this badge identifies the game build rather than map data or a network-fetched remote release.

Watch changesets and workspace manifests during development so changes restart Vite and refresh the badge. Include changesets in Turbo cache inputs so a production build cannot reuse a stale version. Unit and Vite integration tests cover released and planned versions, fixed groups, bump precedence, manifest drift, rendered badge accessibility and responsive visibility.
