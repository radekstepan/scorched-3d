---
"@scorched-3d/web": patch
---

Fix camera flipping backwards when panning into a map corner or edge. The orbit target clamp now carries the camera with it, so forward motion stops at the bound while the viewing angle is retained.
