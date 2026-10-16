---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Rebased height scale so slider 1x renders the previous 2x relief: raw heights map through a shared 2x base factor (`worldHeight`/`effectiveExaggeration`), the slider remaps 1–6 to 0.5–3, and the default 1.5x preserves the previous 3.0x opening view.
