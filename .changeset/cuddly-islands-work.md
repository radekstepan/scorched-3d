---
"@scorched-3d/web": minor
---

Bring the Unit Folio terrain study and inspection controls into parity with the sibling `redesign-stumpy-tank-model` Unit Workshop. The default Gameplay camera overlooks the same seeded Greenreach heightfield and albedo, level inspection pad, 28-rock scatter and distance fog, with terrain/studio and day/night lighting. Retain independent Motion and Shooting, selection ring, turntable, wireframe and camera reset; add olive/sand/arctic liveries, turret traverse, barrel elevation, battle-damage tint, destroyed pose, original Stumpy comparison and reset defaults.

Terrain geometry, UV sampling, rock placement and the original Stumpy comparison are adapted from the sibling `src/viewer.ts`; all terrain texture bytes are generated locally by the existing shared Greenreach pipeline. No external images or retail Nanolathe assets are embedded. Following Nanolathe's data-driven modeling principle, previews reuse production articulation and damage helpers instead of adding battle behavior.

Decisions: preserve the five-unit folio and its paused battlefield isolation. Original comparison is explicitly Stumpy-only because the reference supplies no originals for the other units. The static original disables motion, firing and barrel elevation; Commander disables elevation because it has no elevating pivot. Wreck mode suppresses movement, firing and selection. Preserve metal/rubber finishes when recoloring paint, capture original colors once, and restore paint/damage/pose without cumulative tint. Update materials and lights on settings changes only. Dispose generated albedo and shared rock allocations once on roster change/exit. README documents controls, limitations and resource ownership.

Verification: folio unit/integration contracts cover deterministic terrain, flattened pad, generated texture properties, rock scatter and deduplicated disposal; every roster model's reversible paint/damage/wreck/articulation and battlefield isolation; night/day/studio transitions; original comparison; Gameplay framing; and preview control wiring. No Playwright used.
