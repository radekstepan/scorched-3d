---
"@scorched-3d/web": patch
---

Camera terrain collision: the orbit camera can no longer zoom or swoop through the ground or under the water. The render tick now holds the eye above the local surface (terrain, or the water sheet when shown and higher) with a 6-unit clearance, so close-up zooming into slopes and low orbits over rises glide along the surface instead of clipping through it.

## Task writeup

Task: "don't zoom in so close to fly through actual ground/water etc."

### Root cause

All of OrbitControls' guardrails are target-relative, and the camera in this app rarely sits over the target's own ground column:

- Cursor-anchored zoom (`zoomToCursor`) moves the camera down the pointer ray toward the ground point under the cursor, stopping only at `minDistance` from the orbit target — which itself migrates. Near the surface the ray aims at dirt, so zooming into a slope (or over water toward a submerged target) drives the eye into the hillside / under the sheet.
- `maxPolarAngle` (0.49π) only holds the eye above the target's horizontal plane: at the 15-unit zoom floor that plane is ~0.5 units below the camera, so orbiting low with the target in a valley buries the camera in any neighboring rise.

Reproduced headless through a real OrbitControls instance: a low close-up zoomed 60 wheel ticks ends ~25 units inside a gentle hill and ~11 units underwater, while still satisfying min/max distance.

### What changed (`apps/web` view only — no core change)

- `cameraPan.ts`: new `CAMERA_SURFACE_CLEARANCE = 6` and pure helper `clampCameraAboveSurface(position, surfaceY, clearance?)`, alongside the other camera clamps. 6 units clears the 2-unit near plane, rides above the ~2-unit water swell crests, and absorbs bilinear-vs-mesh height mismatch — while staying well under the 15-unit zoom floor so steep close-ups never touch it. Non-finite surfaces are ignored defensively.
- `TerrainCanvas.tsx`: the tick now clamps the camera Y after the XZ world-rectangle clamps (so it reads the final column), against `max(groundY, water.position.y)` when water is shown on a wet map, else `groundY`. It runs unconditionally — no minimap-jump exemption, because an underground eye is never a valid request and a legitimate pose never touches the floor. The orbit target is untouched, so the focus stays put and the view only pitches up slightly at the floor (same philosophy as the existing `clampCameraToWorld` reel-in).

### Decisions

- Camera-only clamp, not target: lifting the orbit pivot would fight cursor-anchored zoom's target migration and change its feel; the reported symptom is the eye flying through, and recovery (zoom out, pan, jump) naturally un-buries the target.
- Water side keys off the same `showWater && seaLevel > 0` condition as the water mesh: with water hidden there is no sheet to stay out of, so lakebed close-ups still work.
- Checked the sibling `nanolathe` repo for inspiration, but its zoom model is 2D (zoom stops/locks over a flat battlefield) with no terrain-height concept — the 3D orbit case needed its own per-tick collision floor instead.

### Tests

- `cameraPan.test.ts`: unit tests for the helper (lifts buried eyes, leaves high eyes alone, exact-floor hold, clearance override, non-finite guard, clearance sizing vs near plane and zoom floor).
- `cameraZoom.test.ts`: integration tests driving a real OrbitControls through the wheel path — unclamped flights dive into a hillside and under a lake (documenting the bug), clamped flights ride 6 units above both; plus a low-orbit-over-a-rise case proving OrbitControls alone keeps the buried pose, and a TerrainCanvas wiring assertion for the new tick clamp.
