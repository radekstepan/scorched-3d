---
"@scorched-3d/web": patch
---

Fix minimap click-to-center destroying the view: clicking the minimap (e.g. an HQ marker) now transports the camera to the clicked point with the zoom level and viewing angle preserved and the clicked item in the middle of the screen. Previously the world-bounds camera clamp yanked the fresh teleport back inside its rectangle, collapsing zoom and swinging the angle on most mid/far-view jumps; jump-placed cameras are now exempt from that clamp until they drift back inside on their own.
