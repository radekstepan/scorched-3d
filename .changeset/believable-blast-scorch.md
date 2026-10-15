---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Believable blast scorch: yes, the brown blotches were projectile impact decals (one flat brown disc per explosion). Each scorch is now a charred near-black center fading to a dark burnt-brown rim with an irregular feathered edge (shared baked texture, one instanced draw), an elliptical squash + rotation per impact so no two blotches share a silhouette, and a tiny visual crater bowl dented into the terrain mesh (≤1 height unit per blast, capped accumulation, purely visual — pathing and unit seating still read the static heightfield, so bowls never trap units).
