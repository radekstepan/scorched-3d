---
"@scorched-3d/web": patch
---

Fix the remaining hover FPS dip while sweeping the cursor (120 → ~80): the probe no longer raycasts the full terrain mesh per motion frame — it marches the heightfield analytically (~400 taps vs ~163k triangle tests) and reads NDC from a cached canvas rect, so moving the cursor costs no mesh sweep and no layout reflow.
