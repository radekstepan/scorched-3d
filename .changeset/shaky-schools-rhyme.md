---
"@scorched-3d/web": patch
---

Hold fire and seek a clear firing position when standing trees obstruct the actual launched trajectory.

The launch path previously fired direct bolts and mount-limited flat shells into known standing wood, relying on probabilistic interception and three consecutive stuck shots before requesting movement. Check the final trajectory from the resolved live muzzle, after barrel lay and any terrain-driven arc change, against the existing crown/trunk geometry. Reject blocked shots before spawning a projectile and immediately use the existing obstruction pursuit callback, retaining the target and retrying as geometry changes. The shared hull/HQ launch path gets the same gate.

Keep mount limits, valid canopy-clearing shell/grenade arcs, shots above crowns, and ordinary open-ground fire. Felled trees cease blocking through their existing standing mask. Preserve in-flight interception and its consecutive-stick reposition/reset safety net for wood that enters a lane after launch; do not alter forest spotting, weapon damage, tree geometry or random interception odds. This follows Nanolathe's distinction between noticing a target and admitting its actual feature-obstructed firing trajectory, using this game's existing movement and collision contracts.

Update the README's combat description. Renderer integration regressions cover direct weapons refusing blocked lanes, immediate obstruction reports, firing after felling, shots above crowns, grenade arcs over crowns, mount-limited blocked artillery, and late in-flight interception with reposition/reset behavior. Validate with the CombatFx unit/integration suite, workspace typechecking and production build; no Playwright.
