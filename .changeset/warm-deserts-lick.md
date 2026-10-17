---
"@scorched-3d/web": patch
---

Align Battlefield navigation with the viewport UI.

Make the desktop header inherit the command shell's grid columns with CSS subgrid, placing the game-view tabs directly above the battlefield column. Match the first tab's text inset to the viewport heading, including the button padding, so the tab no longer depends on the logo's intrinsic width and an unrelated flex gap. Keep the existing compact flex header on mobile and reset desktop-only insets there.

Add layout regression coverage for shared desktop tracks, tab/viewport text alignment, and mobile spacing resets. Verified 18 focused layout, brand and folio tests, the web production build, and web TypeScript checks. This is a layout correction and does not introduce an architectural change.
