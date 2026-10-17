---
"@scorched-3d/web": minor
---

Add a second command-bar tab for a browsable unit folio, inspired by the sibling Stumpy workshop's studio studies and Nanolathe's catalog-driven unit viewer. All five current unit definitions drive the roster; previews reuse the actual battlefield geometry instead of maintaining duplicate models or made-up gameplay statistics. A close-up lit grid studio offers orbit, zoom, front/rear/top/three-quarter studies, turntable, wireframe and camera reset, with responsive roster and tools.

Keep the battlefield mounted while browsing so map, damage, orders, selection and camera survive. Suspend the entire battle frame before simulation, rendering and effects; clear held keys and pending selection gestures synchronously; block hidden battlefield input and make hidden controls inert. Consume wall time while suspended but advance only active battle time, preventing both simulation catch-up and time-based effect jumps. Add an independent battlefield pause button and compose its pause state with folio suspension, preserving a user pause on return.

The studio owns and deduplicates its resources. Copy camouflage textures rather than disposing shared battlefield cache entries; release owned geometry/materials/textures on each roster change. Cancel animation frames, disconnect ResizeObserver, dispose OrbitControls, release WebGLRenderer and explicitly lose its context on exit. Frame models from actual bounds and viewport aspect so every roster silhouette fits both portrait and landscape.

Document the feature/lifecycle in README. Cover every unit's resource disposal and shared-texture survival, all view/viewport framing combinations, paused clocks and independent pause state, and integration contracts for hidden input and lifecycle cleanup. No Playwright was used.
