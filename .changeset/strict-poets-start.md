---
"@scorched-3d/web": patch
---

Use the Scorched 3D logo from the sibling redesign-stumpy-tank-model workshop in the game header. Port its original inline SVG hexagonal cube emblem, boxed 3D wordmark, colors, and “TACTICAL WARFARE. REFORGED.” tagline into a shared Brand component, replacing the placeholder symbol and heading. Inline SVG preserves crisp rendering and the standalone build without an external image request. Give the complete logo one accessible product name and keep a compact emblem visible on narrow screens. Rendering and shell integration tests cover the original logo geometry, wordmark, accessible name, header placement, and mobile visibility.
