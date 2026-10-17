---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Fix units repeatedly reversing or getting pinned against isolated rocky terrain outcrops.

The drive previously retried a straight patrol/pursuit leg until its blocked timer skipped the waypoint; ordered units could wait indefinitely. Add a bounded 21×21-cell recovery search on the first dry-terrain block. Its smoothed route persists on the mover until consumed, keeping one side of the obstacle instead of choosing a new escape direction every frame. Patrol, pursuit, departure and ordered movement share this drive. Recovery uses tighter waypoint arrival and pivots before sharp corners so the normal forward-speed floor cannot orbit a nearby waypoint or cut back into the obstacle.

Decisions: reuse existing deterministic A* and terrain gates; retain the original destination and order cursor; tolerate two cells of live-target movement before discarding a detour; discard recovery immediately on new orders/holds. The search looks six cells ahead within its bounded neighbourhood, avoiding full-map searches each frame. Failed searches retain existing wall hold/patrol skip behavior, and shore sliding is unchanged. Rock feature words remain rough-ground drag: the reproduced hard obstruction comes from terrain walkability/grade, so no new rock collision model is introduced. Inspired by sibling nanolathe's persistent published routes and footprint-aware route smoothing. README documents recovery behavior.

Validation: first reproduced failures for all five unit kinds in both patrol and ordered travel around an outcrop. Regression simulations now cover all five kinds at 30/60/120 Hz, terrain-safe travel, a consistent side around the obstacle, arrival without skipping, moving-target pursuit with one published detour, determinism and order/hold cancellation. Existing movement, pathfinding, terrain and retaliation regressions pass, including impassable walls and shorelines. Core TypeScript checking passes. No Playwright used.
