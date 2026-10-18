---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Follow battle keeps gliding through zoom and rotate gestures

## Task writeup

Follow battle used to pause for 3s every time the player zoomed or rotated: the hold bracketed OrbitControls' `start`/`end` events, which carry no gesture type and fire once per wheel tick, so any zoom or orbit borrowed the camera. The hold now tracks raw pointer buttons instead (`FollowHoldTracker` in `followBattle.ts`): only right-drag pans and multi-touch pans (two or more contacts) pause the glide, while rotate and zoom compose with the rigid follow translation and never interrupt it. Keyboard pans and minimap jumps still borrow the camera as before.

Decisions worth recording:

- Right-button *clicks* (unit orders) do not stamp the resume delay — only releases past the shared `CLICK_DRAG_PX` click/drag threshold do — so ordering units mid-battle never freezes the glide. The during-press suppression for a click lasts milliseconds and is imperceptible.
- `pointercancel` releases contacts like `pointerup` (mirroring OrbitControls' own balancing), and the suspend path resets the tracker, so a missed release can never hold follow off forever.
- No per-tick rigid-pan backstop was added: gesture classification plus the release stamp already covers drag pans, damping tails (inside the 3s window), touch pans, keyboard pans, and jumps, and a backstop would reintroduce holds on click jitter.
- Nanolathe inspiration (`DESIGN_INTERFACE_HUD_INPUT.md`, `R-CAM-01 §12` follow camera): tracking stays presentation-only and host camera writers compose with the follow pass rather than breaking it — zoom/rotate are now non-breaking writers here too.
