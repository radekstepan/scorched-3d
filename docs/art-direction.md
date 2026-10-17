# Unit and HQ art direction

This is the working design guide for new units and structures. The redesigned Stumpy, Flash, Hammer, Peewee, Commander and HQ are the current reference assets. Their shared language comes from Total Annihilation, Supreme Commander, Beyond All Reason and painted military miniatures: substantial industrial machines whose role is readable from an elevated RTS camera. Use those references for proportion, weight and clarity rather than copying a particular asset.

## Design from the gameplay silhouette

Start with the role, footprint and one defining feature. Establish the chassis or stance, primary armor mass and weapon before adding surface detail. The silhouette should communicate speed, protection or firepower even when paint and small fittings are invisible. A new unit should belong to the same manufacturing family without becoming a scaled copy of another unit.

| Reference | Design decision | Why it matters for future assets |
| --- | --- | --- |
| Stumpy | Wide tracked stance, sloping glacis, layered side protection, compact angular turret and reinforced cannon. Muted olive paint. | The medium battle-tank baseline: stable and protected, with the turret and gun as the focal point. More armor should change major masses before it adds small plates. |
| Flash | Low chassis, swept track guards, narrow arrowhead turret and compact weapon. Desaturated blue paint with restrained yellow marks. | Speed comes from a lower, tapered silhouette and less visual bulk. Preserve visible running gear rather than shrinking a heavy tank uniformly. |
| Hammer | Long tracked chassis, split armored cradle, visible breech/buffers and a dominant elevating barrel. Cool gray paint with orange accents. | Artillery reads through weapon length and support machinery. Leave negative space around the gun so its elevation and recoil remain legible. |
| Peewee | Compact torso tapering into a narrow waist, visible joints, shaped feet and a small weapon assembly. Sand-colored armor. | A scout needs an agile mechanical stance. Limbs should connect plausible joint centers; a tank turret perched on sticks loses the infantry identity. |
| Commander | Broad chest and shoulders, heavier articulated-looking legs, substantial feet, command mast and selective pale-blue/gold panels. | Command status comes from posture, mass hierarchy and a few controlled accents. It should feel related to Peewee without being an enlarged copy. |
| HQ | Sloped wall bastions, framed loading gate, armored shutter cassette, raised roof spine, exhaust towers and an asymmetric service deck. Neutral industrial paint with team trim. | A factory needs a clear production axis and a readable entrance. Use roof masses for recognition from above; supporting equipment should explain production, cooling or access. |

These colors are the neutral kind finishes (tray thumbnails). On the battlefield every unit wears its side's livery instead: the dominant paint and light secondary armor remap onto the team colors (commander blue for Blue, a hue-matched orange for Orange — see `teamPaint.ts`), while bare metal, recesses, optics and small functional accents keep their kind finishes. Team rings, HUD/minimap markers and the HQ's team trim reinforce the same identity. Wrecks still char to near-black, so death never reads as team paint.

## Shared shape language

Use broad flat faces, clipped corners and deliberate slopes. Chamfers catch the existing light and make armor feel manufactured without requiring smooth, high-resolution surfaces. Custom lofts and polygonal extrusions establish the main forms; boxes and cylinders are useful for mechanical parts when they support that design.

Build three scales of form: the chassis/torso/building establishes the silhouette; armor panels, turret, weapon and equipment masses explain construction; hatches, optics, seams and vents reward close viewing. Keep the first two scales dominant. If a model looks plain at gameplay zoom, adjust its proportions or major value breaks before adding bolts.

Make panel layers visibly separate with restrained gaps and recessed backing. Place raised plates on the slope they protect rather than letting them float or disappear inside it. Keep dark openings at tracks, joints, mantlets and vents: this negative space gives mechanical depth under the game's lighting. A cylinder can explain a pivot or hub; an unrelated box cannot explain an arbitrary decoration.

Running gear should support the weight above it. Show road-wheel faces and end-wheel structure through track openings, while guards protect the upper belt. On walkers, armor tapers around joint positions and broad feet provide a believable support area. This visual articulation does not imply a new joint simulation or inverse-kinematics system.

## Paint, materials and light

Use a restrained palette per asset: dominant desaturated paint, a lighter armor variant, dark recesses, bare mechanical metal and small functional accents. Place bright accents near optics, access points or the defining weapon instead of distributing them evenly. The darkest finish separates assemblies; pale armor picks out selected edges and protective surfaces.

Mobile units use `unitHullMaterial` so they retain the terrain valley-fog treatment. Apply the existing subtle grayscale camouflage to painted surfaces; use `noCamo` on metal, recesses and optics where paint variation would blur material distinctions. Preserve independent materials for damage and wreck recoloring. The HQ currently uses Lambert finishes and its existing beacon effect rather than the mobile-unit material path.

Judge materials under the scene's real lighting and terrain. A dramatic studio light or an unusually dark preview ground can disguise weak value separation. Do not rely on new shadow passes, glossy PBR materials or extra lights to make the model work. Keep emissive areas purposeful: the HQ beacon is an existing production signal, not a reason to add glowing strips to every machine.

## Geometry and animation contracts

`apps/web/src/renderer/vehicleGeometry.ts` provides the chamfered `armor` loft and `Assembly` finish batching. The model builders live alongside it in `stumpy.ts`, `flash.ts`, `hammer.ts`, `peewee.ts`, `commander.ts` and `hqModel.ts`; `units.ts` and `hq.ts` integrate them into the scene.

- Mobile units face +Z with +Y up. The HQ is the exception: its gate and exit lane face local +X, with the east team's group rotated to face inward.
- Preserve the unit footprint, seating and gameplay dimensions. A visual redesign must not silently change hit behavior, pathfinding, weapon ranges, production timing or balance.
- Preserve the named turret hierarchy and existing elevating barrel pivot and `tip` marker where present. The muzzle must follow the live weapon transform. Commander retains its own muzzle arrangement; do not assume every weapon has an identical barrel hierarchy.
- Wheel and leg discovery currently expects direct body-child Mesh objects named `wheel` and `leg`. Keep their axes, stored dimensions and `baseY` contracts. Attach decorative finishes beneath the animated mesh so the entire wheel or leg follows the pose.
- Batch fixed parts by finish within each moving assembly. Never merge across hull, turret, elevating gun, wheel, leg, shutter or topple pivots. Multi-finish children must follow both the live pose and the occlusion ghost.
- Cache source geometry, but preserve the current independently owned instance geometry/materials for disposal, damage and wrecks. Sharing mutable materials directly would let one damaged unit recolor another.
- Keep team rings, selection, camouflage, fog, muzzle effects and exploded wreck behavior intact. For HQs also retain shutter travel, spawn/exit clearance, foundation resizing and beacon shutdown. Roof equipment should settle with the roof; chimney caps should topple with their stacks.

There is no universal triangle target. As scale references, the current mobile models are roughly 2,300–5,200 triangles and 16–22 mesh draws before their team ring; the HQ is roughly 3,500 mesh triangles and 39 draws including ring, beacon and halo. These are comparison points, not quotas. Count actual rendered assemblies and materials, including effects, rather than treating low triangle count as proof of low cost. Prefer a few silhouette improvements over hundreds of separate fittings.

## Visual review for each new asset

Use a dedicated review scene to isolate proportions, then check the model in the real game. Complete at least three screenshot-driven refinement rounds, recording a specific visible weakness and the correction made in each. Compilation alone does not establish visual quality.

1. Inspect a close three-quarter view and the rear: check weight, weapon proportions, seams, intersecting panels and unexplained attachments.
2. Inspect top-down and isometric views: check role recognition, roof composition, track/limb separation and whether accents compete with the main weapon.
3. Inspect actual gameplay distance against existing terrain and lighting: check readability beside other units and against trees, smoke and ground textures.
4. Exercise movement/rest, turret traverse, gun elevation/recoil where applicable, selection, damage and destruction. For structures, also inspect open/closed gates, both team facings and slope foundations.
5. Capture final close-up and in-game screenshots, record triangle/draw counts with their inclusions, and run relevant integration tests, typechecks and the production build.

The HQ review illustrates the process: exhaust towers initially disappeared into the roof, the shutter lacked a plausible retraction housing, matching grille banks overwhelmed the top view, and face details became buried in a sloping panel. Raising the towers, adding and widening the cassette, making the roof equipment asymmetric and aligning the face details to its slope resolved those observed problems. Detail was added to explain construction and improve composition, not to meet a component checklist.

Keep temporary review pages out of the shipped app. Preserve review evidence in the task's artifact location and summarize durable decisions in the changeset and this guide. Future opportunities include authored weathering, decals and richer bay interiors, but they should support the same silhouette and material hierarchy.
