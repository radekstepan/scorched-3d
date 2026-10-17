---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Move the Commander pulse cannon and live firing muzzle from its chest into the left claw.

The old model deliberately placed an emitter and its `tip` at the chest. Replace that emitter with a compact pulse cannon gripped by the left claw: armored breech, light top sleeve, bare metal tube and a recessed dark bore. Its tip is attached to the weapon assembly under the existing yawing torso, so terrain tilt, traverse, firing brace, damage and wreck transforms carry the visible gun and firing origin together. Battlefield and folio both build this model and read that marker.

Move the shared muzzle dimensions to the hand and add a lateral offset to the fallback launch calculation, rotated by gun yaw. Changing only the visible marker would leave range/scatter/trajectory seeding at the chest, especially on models without a live marker. Preserve the fixed mount and existing torso brace instead of introducing an independently elevating weapon or changing weapon profiles, footprint, hit behavior or locomotion. Keep geometry batched by finish and instance-owned materials for camouflage, team paint, damage and disposal. Update the art-direction contract for the new attachment.

Nanolathe's fire-time muzzle-piece query (`internal/combat/service.go`) reinforces using the actual gun piece rather than an aim-origin/body anchor; the sibling model study similarly keeps weapon geometry on its own moving assembly. Reuse those principles within the existing renderer hierarchy.

Validation: unit/integration regressions cover the bore envelope, fallback/live muzzle agreement through several yaws, hull pitch and torso transforms, actual battlefield bolt creation, folio flash/tracer placement after traverse, model budget and occlusion pose mirroring. Core: 727 tests pass. Web: 927 tests pass; the sole failure remains the pre-existing Pages test expecting `main` while the workflow uses `master`. Production build and typechecks pass. Native Chrome folio review confirms the complete model fits over terrain, the claw cannon is visible, and the chest emitter is absent; no Playwright used.
