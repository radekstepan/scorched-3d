---
"@scorched-3d/web": patch
---

Fix minimap click-to-center: the minimap image is now block-level with a layout-neutral ring frame, so click/dot fractions measure against the image content box instead of stretching past it (baseline strut gap + border inset previously missed by up to ~100 units at the south corners). The hover chip also plots in world coords like the dots and click handler.
