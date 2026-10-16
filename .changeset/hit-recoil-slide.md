---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Splashed hulls now recoil away from the blast instead of freezing in place: the hit's directional shove (flank-weighted, damage-scaled, capped) slides the unit over the existing stun beat while the impact rock plays, then the drive resumes from the new spot. Re-hits stack under the shared shove cap, wall- and water-blocked slides absorb through the beat, directionless hits still hold, and wrecks never recoil. Renderer plus core shaping only — no API break.
