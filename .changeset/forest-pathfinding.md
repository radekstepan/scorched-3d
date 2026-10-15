---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Forest pathfinding audit plus a projectile-cover number: new pure `flightStickChance` quoting whole-flight stick odds over crossed trees, with tests locking the around-when-faster / through-when-necessary routing on both cell and driven levels. No behavior change — the audit confirmed the existing wood price already matches measured crush-through drive time.
