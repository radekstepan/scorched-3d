---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Let outnumbered tanks finish a forest firing-lane escape and return fire.

The remaining forest stall was a movement/fire-admission deadlock, not just gun target indecision. Weapons correctly refused trajectories through standing wood and requested a lateral firing seat, but the pursuit odds check froze a one-versus-two defender before it could walk that seat. Incoming damage replaced the escape memory, while frequent obstruction retries could keep relocating its destination.

Mark only obstruction-triggered lateral steps as bounded escapes. Preserve their point through same-target retries and incoming hits, and allow them to finish before the outnumbered hold takes effect again. New explicit seeks to another target discard the old escape; target expiry, disengagement, orders, and hold behavior retain their existing authority. Ordinary orbit and opportunistic flank steps still obey the outnumbered hold. Tree and terrain launch admission remain intact. README now documents this exception.

The state-retention decision follows the sibling nanolathe weapon-slot pipeline (`internal/combat/service.go`): a refused shot retains target/aim progress. Here the equivalent recovery progress is the short movement destination; repeated failure reports should not restart it.

Verification: a CombatFx + UnitMovement integration regression with standing canopy, a lone defender, two enemies, and alternating threats every 0.1 seconds fails against the prior implementation (zero lateral displacement) and passes after the fix, observing both escape movement and an actual return projectile. Added core coverage for same-target refresh/retry retention, alternate-hit interruption, explicit retarget/disengage release, and unchanged ordinary-orbit interruption. All 169 focused core retaliation/movement tests, 188 web retaliation/combat tests, and yarn typecheck pass. No Playwright was run.
