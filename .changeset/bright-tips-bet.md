---
"@scorched-3d/web": patch
---

Restore responsive close-up camera navigation and keep the selected angle during zoom.

Diagnosis: keyboard pan used the simulation's 50 ms frame cap, so at 10 FPS it travelled only half the intended distance per real second. There is no unit-count camera setting; extra simulation/render work can indirectly trigger the slowdown by reducing FPS. Both keyboard and right-drag motion also scaled all the way down to tiny orbit distances. Finally, independent camera-eye and target terrain floors changed the viewing offset, so slopes and water could steepen close-up zoom despite the existing flat-ground regressions.

Camera movement now uses a separate wall-time delta (250 ms maximum for long stalls/tab returns), with equal travel at 4, 10, 20, 60 and 144 FPS. Keyboard and drag share a 150-world-unit minimum distance reference for useful close-up panning; wider views retain their existing speeds and sliders. Back the nearest zoom from 30 to 60 units: the 48-degree camera now frames about 53 units vertically, leaving room for a complete tank and surrounding ground. Keep the far zoom ceiling unchanged. Resolve terrain/water collisions by lifting eye and target together, preserving pitch, yaw and distance exactly; a focus may float above the surface to clear a neighboring ridge. Cursor anchoring remains enabled.

Reference review: nanolathe's camera separates live presentation zoom/scroll from simulation; its orthographic integer projection has no transferable 3D terrain-collision math. The sibling Stumpy viewer's RTS angle remains the opening reference; preserve its adopted elevation rather than imposing a fresh angle during zoom. README documents timing, close-up limits and the floating-focus decision.

Verification: 143 headless camera tests pass, including real OrbitControls wheel flights over multiple eye/focus heights and cursor positions with exact angle/distance preservation, and wall-time pan parity across frame rates. Production build and typecheck pass. Full tests retain only the existing unrelated deployPages.test.ts main/master mismatch (918 web tests pass). Historical eye-only collision fixtures retain their original 15-unit floor so they still reproduce that earlier bug independently of the new limit. No Playwright was run.
