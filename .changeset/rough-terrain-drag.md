---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Rough terrain now resists movement: cost-weighted A* prefers open ground over slopes, woods, and rocks, string-pulled smoothing refuses shortcuts back through trees and rocks, and hulls drive slower on grades and near vegetation while scorch stays a visual decal that never traps units.
