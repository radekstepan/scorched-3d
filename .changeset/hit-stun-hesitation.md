---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Splashed hulls now hesitate their drive for a brief damage-scaled beat (up to 0.8 s for a direct heavy hit, down to a 0.25 s floor for fringe chips) while the existing impact rock plays the visible jerk back away from the blast. Re-hits refresh under the cap instead of parking the hull, and wrecks never stun. Renderer plus core shaping only — no API break.
