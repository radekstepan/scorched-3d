---
"@scorched-3d/web": patch
---

Fixed the camera leaving the world when panning, orbiting, or zooming at far zoom-out: the camera position is now held inside the same virtual rectangle around the map as the orbit target (25% past each edge), so the view can no longer move off the map.
