---
"@scorched-3d/web": patch
---

Redesign Stumpy, Flash, Hammer, Peewee, Commander and the HQ together with cohesive low-poly sci-fi armor, custom geometry and layered mechanical details. Preserve movement, aiming, firing, camouflage, team markers, damage, destruction and HQ production behavior, with batched geometry and model regression coverage.

## Design intent and decisions

The roster follows a cohesive retro-futuristic military-miniature theme, inspired by Total Annihilation, Supreme Commander and Beyond All Reason. The priority is recognizable silhouettes at RTS distance, then convincing mechanical depth in close-up. Large sloped armor faces and clipped corners catch the existing lighting; recessed joints, mantlets and track openings separate the machinery without requiring extra shadow passes. Custom polygonal lofts establish the main forms rather than relying on stacks of decorative boxes.

Each unit expresses its role through different proportions within that shared language:

- **Stumpy:** a broad, protected medium-tank stance, sloped glacis, layered armor and a compact turret with a reinforced cannon establish the roster's armored baseline.
- **Flash:** a lower tapered chassis, swept track guards and arrowhead turret communicate speed without simply shrinking Stumpy. Exposed running gear keeps the silhouette light.
- **Hammer:** the long barrel and split armored cradle make the weapon the dominant mass. Visible breech/support parts and space around the elevating gun distinguish mobile artillery from a battle tank.
- **Peewee:** the narrow waist, compact torso, visible joints and shaped feet communicate an agile scout. Limb armor follows plausible joint centers instead of reading as a turret on sticks.
- **Commander:** broad shoulders/chest, heavier legs, substantial feet, mast and selective pale-blue/gold armor communicate command presence through mass and posture rather than extra decorative clutter.
- **HQ:** sloped wall bastions and a framed loading gate establish protection and a clear production axis. The roof spine, exhaust towers and asymmetric service deck keep the factory recognizable from above. The shutter cassette explains where the raised door retracts.

Paint remains desaturated and varied by unit family: olive Stumpy, blue Flash, gray Hammer, sand Peewee and blue/gold Commander. Lighter armor panels, dark recesses and restrained metal/optic accents create a consistent value hierarchy. Body colors are not faction colors; existing team rings and HUD/minimap markers remain the ownership signal, with team trim on the HQ. Subtle camouflage stays on painted mobile surfaces, while mechanical metal and optics retain clean material separation.

## Integration and rendering decisions

Fixed geometry is batched by finish inside each animated assembly, preserving hull/turret/gun separation, wheel spin, leg gait and live muzzle markers. Source geometry is cached, while each instance owns geometry/material copies for independent damage, wreck recoloring and disposal. Mobile materials preserve terrain valley fog and the existing camouflage path. The HQ retains its +X exit, foundation resizing, door travel, spawn coordinates, rotating beacon and destruction hooks; roof equipment and chimney details now follow their complete wreck assemblies. Simulation and balance are unchanged.

The HQ measures approximately 3,500 mesh triangles and 39 draws including its ring, beacon and halo. Mobile models span roughly 2,300–5,200 triangles and 16–22 mesh draws before their ring. These are reference costs, not targets to fill with detail.

## Visual iteration and future extensions

Use at least three screenshot-driven refinement rounds for future assets, checking close-up, rear, top-down/isometric, gameplay distance and the real terrain/lighting. Change proportions and major value breaks before adding small fittings. The HQ iterations raised exhaust towers that disappeared into the roof, added and broadened the shutter housing, broke up overly symmetrical roof grilles, and aligned face details that were buried in the housing slope. Check animated poses and wrecks as well as the resting model.

The reusable theme, model-specific rationale, material rules, hierarchy contracts and review checklist are documented in `docs/art-direction.md`. New assets should extend those principles while retaining a distinct role silhouette. Authored weathering and richer interiors are potential refinements, provided they support the existing hierarchy and rendering budget.

Validation: focused HQ tests, web/core typechecks and the production build passed. The full web suite passed 833 tests with one existing unrelated deployment-branch expectation failure. Temporary model-review pages were removed after screenshot capture.
