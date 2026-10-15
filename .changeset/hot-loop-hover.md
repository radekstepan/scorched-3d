---
"@scorched-3d/web": patch
---

Fix the hover hot loop that cost ~50 fps while the cursor was over the canvas: the hover probe now raycasts at most once per tick and only when the pointer or camera moved, and only re-fires the probe readout when the sampled cell actually changes.
