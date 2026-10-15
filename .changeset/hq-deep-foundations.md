---
"@scorched-3d/core": patch
---

HQ factory works now sit on deep concrete foundations: a pure `hqFoundationDrop` helper samples the slab plus hall-corridor footprint cells and returns the world-space drop to the lowest corner plus a burial margin, and the renderer hangs matching `hq-foundation` / `hq-hall-foundation` footings under the slab and hall that `HqFx` sizes per site (and re-measures on exaggeration re-snaps), so forts on hilly terrain show concrete set into the slope instead of floating over a downhill air gap.
