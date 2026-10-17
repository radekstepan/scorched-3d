---
"@scorched-3d/web": patch
---

Give HQ flags continuous wind flutter and a pale outline so the blue team's cloth remains readable against water. Interpret the requested flickering as cloth ripples rather than flashing opacity: the team color remains steady and readable. A segmented, double-sided cloth deforms from immutable rest coordinates with increasing movement toward its free edge; the pole seam stays fixed. A real pale ribbon follows the same deformation on the three exposed edges, retaining visible thickness from either side without relying on platform-dependent line widths.

Drive wind from the existing HQ update clock with a small phase offset between forts. Zero-duration updates hold the pose, wrecks freeze the cloth, and the standard wreck char pass darkens the ribbon along with the flag. Keep the existing sub-4000-triangle HQ budget through modest tessellation; the ribbon adds one draw. No simulation state or gameplay RNG changes.

Tests cover team materials, matching cloth/ribbon seams, fixed pole attachment, deterministic poses without accumulated drift, live update integration, pause, destruction/charring, and geometry/draw budgets. Verification: focused HQ unit/integration tests, web typecheck and production build. Nanolathe's marker/render separation informed keeping identity and animation entirely in the renderer; its retail simulation rules are not applicable to this visual change.
