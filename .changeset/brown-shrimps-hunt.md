---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Fix team battles where many aimed units stood silent while only one gun fired.

The battle used a single random attacker draw and one global reload timer, so an entire army shared one weapon's firing cadence. A gun still traversing or unable to find a firing solution could also delay its peers. Team rosters now service each weapon independently: a randomized initial delay staggers opening shots, actual launches start the unit kind's reload, movement doubles that gun's reload, and failed aim/terrain/range admission retries only that gun. Shared targeting snapshots keep the service quadratic rather than rebuilding a roster for every attacker. Existing sticky target choice, aim limits, range and terrain gates remain authoritative. Unteamed ambient demo fixtures retain their previous scheduler for compatibility.

Raise the globally bounded projectile budget from six to 128, since six in-flight rounds still suppressed army fire even with independent clocks. Expensive explosion, flash and dynamic-light pools retain their existing separate caps. Saturated guns wait ready without consuming a reload, and a rotating service cursor prevents the end of the roster from starving. Newly added reinforcements receive their own clock and destroyed guns are skipped. The independent reload design follows the per-slot weapon pipeline described in sibling Nanolathe's DESIGN_WEAPONS_PROJECTILES section 2.1; the existing movement slowdown is retained as this game's intentional rule.

Regression tests cover all ten facing guns firing with a constant random source, an untraversable gun alongside working peers, independent movement penalties, full-pool backpressure and eventual service of all 141 guns, and reinforcement/destruction lifecycle. Cadence comparisons now finish before the faster stationary guns kill their targets; post-kill silence cannot measure reload speed. README documents weapon servicing and effect budgets.
