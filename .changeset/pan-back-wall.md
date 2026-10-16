---
"@scorched-3d/web": patch
---

Stop pan-back at a wall behind the camera instead of warping the angle: the camera reaches its world bound first when panning backwards, and the target now stops with it (carried by the clamped delta, per axis) so the viewing angle is retained exactly — the target can no longer catch the pinned camera, collapse the ground-plane forward basis, and snap the view top-down. Orbiting and cursor-anchored zoom at the edge keep the old reel-in behavior so the focus point stays put.
