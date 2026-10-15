---
"@scorched-3d/core": minor
"@scorched-3d/web": minor
---

Shots now scatter around the aim point with distance: new core `scatterRadius` / `disperseAim` helpers grow the impact disc linearly past a 150-unit deadzone (close-range gunnery stays dead-on), with artillery spreading roughly 3x faster than bolts and per-kind caps (24–60 units) so strays stay near the mark. The renderer feeds muzzle-to-target distance into every hull and structure volley, so long-range duels visibly bracket their targets while point-blank shots still land on the hull.
