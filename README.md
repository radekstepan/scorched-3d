# Scorched 3D

A browser remake of the classic Scorched Earth artillery game — currently a playable terrain demo: seeded TNT-style islands rendered in 3D at a gentle default height scale with water, trees, rocks, a hover probe, a static Total Annihilation unit roster (Commander, Stumpy, Flash, Hammer, and the Peewee infantry scout) re-placed on every regen as two even teams — Blue mustering west, Orange east, subtle team rings circling every live hull (brightening on selection, gone on wrecks) with matching HUD chips and minimap outlines on live hulls (dead hulls drop off the minimap), each side fielding a map-end HQ factory works (monitor roof, chimney stacks, silo, workshop annex, a framed sectional door, and a rotating red warning beacon, sited on a leveled dirt pad on low dry ground with a cleared (unpainted) exit lane and set into the slope on deep concrete foundations) that slides its door up to send out random reinforcements while it stands (weaker units more often, stronger units slower to build — artillery takes the longest) (and goes silent as a charred wreck under enough enemy fire, guns reaching well under half the map so forts take aimed fire solely from deep push-ins, and fort-shelling guns under consistent enemy fire answer the enemy first) — and ambient skirmish fire (flat tracer bolts at muzzle velocity — the Peewee's peashooter cycling fastest for lighter chips, and lobbing green grenades on steep mortar arcs once it closes to knife-fight range — ballistic shells arcing from elevating barrels under gravity, in-flight rounds glowing onto nearby trees, hulls, and dirt, layered core-plus-halo muzzle flashes, recoiling turrets sliding back along the barrel with each shot, and layered impact explosions with fireball, smoke, shockwave ring, and lingering glow that wash downhill on graded ground instead of stamping flat circles, with live crowns and trunks catching crossed rounds as stuck embers and early bursts while guns hold fire and seek a clear firing position when standing wood or ridges block their actual muzzle trajectory, admitting canopy-clearing arcs only within the weapon mount limits, tubes cranking onto each lay at limited elevation rates instead of snapping) traded between units across team lines only (friendlies never draw fire) whose hulls turn to face their targets while turrets traverse within clamped limits, scarring the terrain with persistent scorch decals (charred centers fading to scorched rims with irregular edges, draped to the terrain normal and stretched down the fall line on slopes, each blast denting a tiny visual crater bowl deeper downhill than uphill) while blasts flatten nearby trees to toppled trunks, stumps, and charred snags that sink and decay away, ignite layered fringe fires (outer/core flames, embers, smoke columns, ground glow) that burn down through smoke to smouldering wrecks and spread to neighbours, and chip rocks toward buried rubble, while near-misses splash the hulls themselves with accumulating damage (each blast rocking the hull with a decaying directional shove and tilt while recoiling it away from the blast and pointing the hull at its live shooter so idle patrols turn and pursue to weapons range (giving up past the disengage bound, the patrol-anchor leash, or memory expiry — while ordered hulls keep driving their orders, recording a self-defense memory the guns answer without steering, which converts to a pursuit on arrival), with arcing shell wounds investigating the firing position past the bolt gates on the hunt leash while the turret traverses onto the shooter, and idle hulls that spot a live enemy hunt it down on a wider leash through the same pursuit (peewee scouts spotting farther, ranging wider, and probing alone so the squad engages what the scout finds) — while sides that have lost contact keep pushing toward the last-known enemy position on the wider team-advance leash instead of guarding their patrol loops (peewee scouts ranging toward the enemy staging area while no contact exists yet so battles open with probing, any hit alerting the whole side so heavies reinforce the firing position even past notice, a scout's HQ sighting shared team-wide so the side marches on the spotted works, and every hull's eyes feeding a per-enemy shared last-known memory — ordered and outnumbered spotters report without engaging — that expires a minute unseen and is forgotten when a mate re-checks the empty spot) — weighing the local odds first (outnumbered hulls hold facing the threat for backup instead of charging alone, but finish a bounded lateral escape when trees block their firing lane; that escape keeps its destination through incoming hits and repeated blocked-shot retries, quarries join the squad focus with wounded enemies finished first, and guns pile onto engaged targets), flank hits rocking harder; charring paint, smoke, then embers — and exhausted hulls die epicly in a scaled-up layered burst, leaving exploded husks — popped turrets thrown clear for tanks, a slumped torso for the walker, charred past the live cap — that smoulder, slowly sink, gutter out, and vanish while no longer firing, driving, selecting, or drawing fire), while every unit patrols a seeded looping route with its hull facing travel, pitched and rolled to the terrain grade through slew-limited tilt and refusing climbs past retail-tank slope limits, tracked hulls rolling on spinning road wheels while leaving fading twin tread trails behind them while driving, the walker stamping alternating gapped footsteps, the walker striding an alternating leg gait that settles to neutral at rest, live hulls breathing faintly with engine-idle sway while they hold, and its turret tracking targets independently with a weightier, slower traverse — and clickable, box-selectable units (static white/cyan double rings + beacon, bottom selection tray with per-kind icons and counts, live minimap markers) that leave patrol on right-click move orders, driving deterministic cost-weighted A* paths that prefer open easy ground (with string-pulled smoothing that refuses shortcuts back through woods, trunk-keepout steering that routes legs around standing trunks while hulls crush through wood they must cross, felling trees at a crawl, and traversing gun tubes knock down any bole they touch instead of clipping through it, and walkable, separated formation fan-out) at slope- and vegetation-dragged speed before rejoining their patrol loop on arrival, while lateral separation steering keeps adjacent hulls from deadlocking inside each other's spacing stop (explosion scorch and crater bowls are visual decals/mesh dents only — they never alter heights or walkability or trap units) — and a View-menu Territory toggle that tints each team's recent ground in its faction color on both the 3D map and the minimap (contested ground blends both colors, stale ground fades out).

## Combat

Every team unit has its own weapon reload clock, with staggered opening shots and a slower reload while moving. A gun that is turning, out of range, or blocked by terrain retries independently so other aimed units keep shooting. Up to 128 projectiles can be in flight; impact effects and lights retain separate small pools. When the projectile budget fills, rotating weapon service keeps later units from starving. Reinforcements receive a fresh clock, and destroyed units stop firing.

## Movement in crowds

Autonomous units combine forward drive, collision separation and the short exit coast into one velocity with bounded acceleration. A packed column therefore brakes and changes direction gradually, while crowd priority continues until its final pair separates so the last two units cannot resume circling each other. Orders, holds and hit recoil take control immediately. Terrain still rejects every accepted step, and tree crushing follows the actual driven travel.

Firing lines keep their seats when nearby units leave no room for routine circling. Genuine clearer firing positions and flanks still allow a shuffle, provided its whole travel lane clears nearby hulls and earlier reserved shuffles. Isolated duels retain their combat movement.

When a dry terrain obstacle blocks a unit, it searches a bounded 21×21-cell neighbourhood and follows a persistent detour around the outcrop. Patrols, pursuits and orders share this recovery. The unit keeps its chosen side while nearby targets move, pivots before tight corners, and resumes its original destination after clearing the obstacle. Searches that cannot cross a large barrier retain the existing patrol skip or ordered hold behavior; shoreline sliding is unchanged. New orders and holds discard the recovery route.

## Command interface

The battlefield sits inside an RTS command shell inspired by the sibling Stumpy model viewer: olive instrument panels, lime accents, fine dividers and condensed headings. The header holds the game-view navigation and current build version; the left rail holds the operation, world presets and live radar; the right rail holds view controls, the probe, live unit counts and expandable terrain diagnostics. Both rails scroll independently, leaving the central canvas and its selection tray unobstructed on desktop.

The top-right version badge is calculated by Vite from the Changesets release plan, including pending changes (for example, a pending minor bump from `0.1.0` displays `0.2.0`). Without pending changes it uses the shared workspace package version. This identifies the running build; `APP_VERSION` in core retains the last released version until `yarn version-packages` runs. Dev restarts after release metadata changes, and production build caching includes that metadata.

Camera navigation uses wall time independently of the simulation's slow-frame cap, so keyboard pan keeps its speed down to 4 FPS; longer stalls are capped at 250 ms to avoid a large jump on return. Keyboard and right-drag pan retain a minimum world speed at close range, then scale with distance in wider views. Wheel/pinch zoom stops 60 world units from the focus, framing a complete tank with surrounding terrain. Terrain and water collision lift the camera and focus together, preserving the chosen angle and distance; the focus may float above the surface to clear a nearby ridge.

At widths up to 1000px, Worlds / radar and Inspector buttons open one drawer at a time over the full-width battlefield. Press the active button again to close it. The selection tray scrolls horizontally when many groups are selected. View toggles and world buttons expose their selected state to assistive technology, and every interactive control has a visible keyboard focus outline.

## Maps

Six seeded worlds ship in the Worlds panel, each re-rolled by REGEN: Greenreach (lush island with bay and north ridge), Gods Channel (scattered volcanic isles), Ashen Pass (dry highland corridor), Glass Caldera (crater lake ringed by steep walls), River Crossing (meandering river through forest and plains, held by two ford crossings), and Dust Plains (wide flat steppe with gentle swells and scattered copses, built for armor battles). Every world spans a 320×256 attribute grid (about 5.1k × 4.1k world units — double the classic extent on each axis), so there is room to maneuver: guns reach well under half the map and only threaten the enemy HQ on deep push-ins.

## Start the app

1. Install the Node version from `.nvmrc`.
2. Run `yarn install`.
3. Run `yarn build` one time (builds `@scorched-3d/core` so the web app can resolve it).
4. Run `yarn dev`.
5. Open the printed URL in your browser (usually `http://localhost:5173`).

More commands:

- Run `yarn typecheck` to check types.
- Run `yarn test` to run tests.
- Run `yarn build` to produce the single-file production bundle (`apps/web/dist/index.html`).

For more steps, read [Development](docs/development.md).

## Deploy

Every push to `main` publishes `apps/web` to GitHub Pages via
`.github/workflows/deploy-pages.yml` (build → upload → deploy, no
publishing branch). One-time setup: in the GitHub repo go to
Settings → Pages → Source and select "GitHub Actions". The site then
serves from `https://<owner>.github.io/<repo>/` after each push.

## More information

- [Art direction](docs/art-direction.md) explains the unit/HQ theme, design rationale and visual review requirements.
- [Architecture](docs/architecture.md) shows workspaces, files, and build notes.
- [Development](docs/development.md) shows how to extend and verify the app.

### Unit folio

Open **02 / Unit folio** in the command bar to browse Commander, Stumpy,
Flash, Hammer and Peewee. The studio renders the actual battlefield models
at inspection scale. Drag to orbit, scroll/pinch to zoom, choose 3/4, front,
rear, top or Gameplay studies, toggle a turntable or wireframe, and reset the camera.
The default Gameplay view looks over the Unit Workshop reference’s textured,
seeded Greenreach terrain, with rolling heights, a level inspection pad, rock
scatter and distance fog; switch Terrain off for the studio grid. Independent
Motion and Shooting toggles preview wheels
and walker strides in place, barrel recoil, muzzle flashes and short tracers.
Selection ring previews the battlefield team marker. These are visual studies
using production model articulation, with no battle orders or damage.
The inspector also offers night lighting, field olive/desert sand/arctic ash
liveries, turret traverse, barrel elevation, battle-damage tint and a destroyed
pose. Wrecks suppress motion, firing and selection; turning wreck off restores
the chosen paint and damage. Commander has no elevating barrel, so that slider
is disabled. Original model comparison shows the reference’s original Stumpy
geometry; it is disabled for other units, and its static model disables motion,
firing and barrel elevation. Restore study defaults returns all controls and
the camera to the initial terrain study.
The roster and controls adapt to narrow screens.

Opening the folio freezes battle simulation, effects, camera input and orders.
The battlefield stays mounted, preserving its map, damage, selection and camera;
returning to **01 / Battlefield** resumes from that point without catching up
elapsed wall time. The battlefield's **Pause / Resume** button is independent:
a battle paused before opening the folio stays paused when you return.

The studio owns its WebGL context, controls, shadow map and model resources.
`folio/preview.ts` builds the terrain with the shared map/albedo pipeline and
owns the preview animation, using the live locomotion and muzzle helpers.
`folio/settings.ts` applies reversible paint, damage, articulation and lighting
without mutating battlefield models. Each roster change or exit cancels its animation loop, disconnects its resize observer and
releases geometry, materials, copied textures and the context. Camouflage
textures are copied from the shared battlefield cache so inspecting a unit
cannot dispose textures still used by the battle.
