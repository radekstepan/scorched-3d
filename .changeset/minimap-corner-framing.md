---
"@scorched-3d/web": patch
---

Fix minimap clicks landing the clicked item in the bottom-right corner instead of the screen center: the WebGL canvas kept its pixel-ratio backing store as its CSS box (2x the viewport on retina), overflowed its wrapper, and the app root clipped it to the top-left quadrant — so the correctly centered orbit target rendered at the visible corner. The renderer now styles the canvas to the viewport size, so the full frame is visible and clicked items land in the middle of the screen on every display.
