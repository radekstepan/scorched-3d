---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Give Peewee grenades a shallow ballistic throw and carry its rifle horizontally between engagements.

The grenade previously selected the high ballistic root at 300 world units/second, producing a near-vertical mortar launch and roughly four seconds of hang time. Select the existing low root at the same speed and gravity instead: level-ground throws stay below 30 degrees, peak below 12 units above the muzzle, and arrive within one second across grenade range. Keep grenade range, damage, splash, cadence and rifle behavior unchanged. Tree admission still checks the actual trajectory; a tall crown blocks the shallow throw instead of forcing the unwanted mortar pose.

Set the scout model and shared rest elevation to zero so battlefield spawns and folio walking/shooting show the same forward rifle pose. Restore that pitch at the existing slew rate when its pending hull or HQ target disappears or leaves admitted range, clearing stale aiming state. Clear transient elevation goals alongside pending targets. Preserve active targeting and wreck poses.

Reference review: nanolathe/internal/combat/peewee_muzzle_test.go confirms firing from composed barrel flares, and the sibling redesign-stumpy-tank-model scout tests establish the shared muzzle/gait contract. Preserve those transforms and live-muzzle launch checks rather than introducing a separate grenade launch point.

Validation: core Peewee trajectory tests cover the grenade range, elevated/depressed targets and unreachable shots; real-model combat tests verify shallow launched velocity, pitch and smooth disengagement recovery; tree tests cover clear and blocked shallow lanes; folio tests pin horizontal walking/shooting. The 140 targeted web tests and monorepo typecheck pass. Full core testing passes 726/727 tests; the existing branding test still expects APP_NAME directly inside App.tsx after the earlier task moved it into Brand.tsx, unrelated to this change.
