---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Hot-loop sweep with no visual or gameplay change: crater dents reject far bowls by squared distance before the sqrt/warp, tree segment tests gain an allocation-free boolean probe, the canvas shares one tree-stands snapshot per tick between occlusion and combat, waypoint live lines rewrite reused buffers instead of rebuilding geometry per tick, combat shots orient via scratch vectors with an early-out when no rounds fly, and hidden health bars skip their per-tick re-seat. Deterministic perf-guard tests pin the equivalence and the simulation bounds.
