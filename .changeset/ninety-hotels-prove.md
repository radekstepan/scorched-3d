---
"@scorched-3d/web": minor
---

Show every unit in the folio on a seeded Greenreach terrain study, with independent Terrain, Motion, Shooting and Selection ring controls alongside the existing camera studies, turntable and wireframe. Turning Terrain off restores the workshop grid. Narrow-screen toolbars scroll so all inspection controls remain accessible.

Inspired by the sibling redesign-stumpy-tank-model workshop, the preview uses the production models, locomotion helpers and muzzle hierarchy for all five unit kinds. Motion runs in place to preserve inspection framing; shooting repeats with barrel recoil, muzzle flash and a short tracer. Turning shooting off clears effects and restores the barrel, while stopped walkers settle to neutral. These visual-only controls never touch battlefield simulation, orders or damage.

The compact terrain reuses the shared seeded heightfield and bilinear height sampling, levels the pad under the model, and uses vertex colors rather than allocating a full battlefield and full-map albedo texture. Model, terrain, effects, selection ring and shadow resources belong to the folio lifecycle and are disposed on roster change or exit. README documents the controls and ownership boundary.

Validation: folio unit/integration contracts cover deterministic terrain, a level pad, all five locomotion/muzzle hierarchies, firing cadence, stop/reset behavior, resource disposal and battlefield suspension. Type checking and the production build pass. No Playwright was run.
