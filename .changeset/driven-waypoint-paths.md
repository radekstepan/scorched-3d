---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

The Waypoints overlay now traces the line each unit will actually drive — a forward simulation through the same turn-rate caps, alignment grip, and terrain gating the movers use, so corners read as arcs and walls read as stops — instead of straight waypoint-to-waypoint chords.
