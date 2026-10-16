---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

River-ford pathfinding: smoothed order legs keep one arrival radius from water/steep corners instead of threading them, and ordered hulls beached on a shoreline edge around the water (smallest free heading first) instead of grinding nose-on forever. Patrol still skips water-pinned legs, steep walls still hold honestly, and unreachable over-water goals hold beached past patience rather than pacing the coast.
