# Bluff House walkthrough: progress

## Status: Stage 4 (Furniture + exterior) done, waiting for approval

| Stage | Status |
|---|---|
| 1. Skeleton (clay geometry, collisions, stairs, level culling) | ✅ approved, proof in `proof/stage1/` |
| 2. Tour + UI | ✅ approved, proof in `proof/stage2/` |
| 3. Materials + realtime lighting | ✅ approved, proof in `proof/stage3/` |
| 4. Furniture + exterior | ✅ done, proof in `proof/stage4/` |
| 5. Baked GI + reflection probes | ⏳ next |
| 6. Performance + polish | — |
| 7. Ship | — |

## Stage 1: what was built

- `house-data.json` drives everything: rooms, open spans, openings, stair, site, furniture footprints, tour stops.
- Walls come from a 1-ft ownership grid per level (`src/build/plan.ts`), merged into runs. Openings are cut into the runs (`walls.ts`) and dressed (`openings.ts`).
- Floors, ceilings, the switchback stair (`stairs.ts`), roof and gable with trusses (`roof.ts`), the fireplace mass, decks, the infinity pool, the entry canopy, the motor court, foundation skirts, the bluff stairs, the dock (`exterior.ts`) and terrain (`terrain.ts`).
- All architecture is emitted straight into meshes merged by (visibility group × material): 79 meshes, about 11.5k triangles.
- Collision: one collision mesh with a BVH (three-mesh-bvh) and a capsule controller (`player/controller.ts`). The capsule has a 1.0-ft radius and is 5.75 ft tall, with a 5.5-ft eye, 0.65-ft step-up and 1.0-ft max drop. The stairs use invisible ramps.
- Level culling (`render/culling.ts`): interiors two floors away are hidden. Nothing is hidden outdoors.
- The square footage is computed and logged at startup: lower 1,852 / main 3,332 / upper 2,040 = **7,224 heated**, plus a 1,352 sq ft garage.
- The stair math is logged at startup: 18 risers × 7.333 in = 11.000 ft, and 8 treads × 11 in per flight.

## Proof (all from `pnpm test`, 14/14 passing)

- `proof/stage1/plan-level{0,1,2}.png`: orthographic clay plans, cut at 4.5 ft, roof hidden.
- `proof/stage1/aerial-level{0,1,2}.png`: bird's-eye clay views with everything above the level removed.
- `proof/stage1/overlay-level{0,1,2}-{blend,diff}.png`: each render overlaid on the approved SVG. In the diff images, black means both, red means render only and blue means drawing only.
- `proof/stage1/alignment.txt`: on every level, **100.0%** of the generated wall pixels land on drawn walls (within ±1 px = ±1 in), and **100.0%** of the drawn solid walls are covered. The firebox symbol, scale bar and north arrow are excluded.
- `tests/collision.spec.ts`:
  - 1,656 samples along every full-height wall piece all block the capsule.
  - Up and down every flight works (0 → 11 → 22 → 11 → 0 ft).
  - The great-room void rail and the loft rail block you.
  - The pool and the deck edges block you, and so does the drop at the bluff crest.
  - You can walk the bluff stairs all the way to the dock (−46.5 ft).
  - The 2.5-ft powder-room door, the front pivot doors and the bookcase door are all passable.
  - Every room has floor under its center.
  - Level culling works.
- `proof/stage1/views/*.png`: first-person clay views. `proof/stage1/live-app-entry.png` shows the running app with the HUD.

## Stage 2: what was built

- **Tour** (`player/tour.ts`): a centripetal Catmull-Rom spline through `tourStops`, re-sampled by arc length every 0.2 ft so speed is uniform.
  - Walking pace is 4.4 ft/s. It eases to 15% of that over the last 3.2 ft into each dwell stop and eases back out after.
- **Camera director** (`player/director.ts`):
  - **Looking:** the camera looks 7 ft ahead along the path and blends toward each stop's `lookAt` as it arrives. Turns are capped at 1.7 rad/s, so doubling back is a calm turn.
  - **Floor height:** taken from the walkable surface under the camera and smoothed by a critically damped spring.
  - **Head-bob:** ±0.04 ft vertical and ±0.15° roll, tied to distance walked and faded out when stopped.
  - **Handoff:** Space hands the exact pose to free walk. R (or Space again) resumes from the nearest path point *on the same floor* and blends there over 1 s. Pressing WASD or clicking the view also takes over.
- **Time of day** (`lighting/sun.ts`, `lighting/timeofday.ts`): the full NOAA solar algorithm.
  - For Oct 15 at Lake Lure: **sunrise 7:35 AM, solar noon 1:15 PM, sunset 6:53 PM** (EDT).
  - The slider runs 6:30 AM–9:00 PM with presets: Morning 8:00, Noon 12:30, Golden 5:45, Sunset 6:45, Night 8:30.
  - The sun, the sky color, exposure and the shadows follow the slider. Shadows re-render at most every 250 ms.
- **UI** (`ui/`):
  - Room caption on entry (`caption.ts`): level, name and meta. It fades in, holds 2.5 s and fades out, after a 0.25 s debounce at doorways.
  - Smoked-glass dock (`dock.ts`): tour ▶/❚❚, time slider + presets, Room sizes, Measure, Furnished (disabled until Stage 4) and Quality.
  - Shortcut card (H), mode chip and toasts.
- **Room-size labels** (`ui/labels.ts`, L): shown for rooms on your level at eye height, and hidden when a wall (not glass) is in the way. That check is a BVH sight line where glass and rail triangles are flagged see-through.
- **Measuring** (`ui/measure.ts`, M): click two surface points to get a line and a feet-inches label (e.g. `4′ 9″`). Esc cancels. With the mouse captured, the crosshair picks.
- **Outdoor naming** (`ui/where.ts`): outdoor areas get names from the site data (Covered Deck, Pool Terrace, Bluff Stairs, Boat Dock, Front Entry, Motor Court) with the captions from `outdoorAreas`.

## Stage 2 proof (`pnpm test`: 24/24 passing, including all Stage 1 tests and the kit-consistency checks)

- `proof/stage2/tour-report.txt`, from the fixed 1/30 s simulation of the whole tour:
  - **1,053 ft in 6.44 minutes**, and it completes.
  - **0 steps** where the 1-ft capsule touches a wall, rail or pane of glass.
  - **30/30 rooms** visited, then terrace → bluff stairs → dock, ending on the lake view.
  - Largest per-step camera move 0.18 ft, and largest turn 0.057 rad.
- `tests/tour.spec.ts`: Space pauses without moving the camera, and R blends back with no jump larger than 0.35 ft per step.
- `tests/ui.spec.ts`:
  - NOAA sun positions are checked.
  - Room labels show the kitchen from the great room and hide the primary suite behind its wall.
  - Measuring hits the great-room wall plane exactly and formats feet and inches.
- Screenshots:
  - `tour-great-room-dwell.png`: caption + dock at the lake-view dwell.
  - `tour-ends-on-lake-view.png`: the final stop at the dock.
  - `room-sizes-from-kitchen.png` and `measure-great-room.png`.
  - `shortcut-card.png`.
  - `live-tour-running.png`: the real render loop playing the tour.

## Stage 3: what was built

- **Materials** (`materials/library.ts`, `materials/procedural.ts`): one table of PBR materials, keyed by the wall and floor kinds in the JSON.
  - Every texture (hickory, plaster, ledge stone, board-and-batten, oak, walnut, tile, slate, pavers, deck boards, standing seam, pool mosaic, grass) is generated in code: color, normal and roughness/AO maps, tiled in real feet.
  - Floors and cabinetry are `MeshPhysicalMaterial` with clearcoat. Roughness never goes below **0.11** (lower overflows half-float and bloom turns it into black squares).
  - **Glass:** a faint green body tint that grows at grazing angles, full-strength Fresnel reflection of the sky, and no shadow casting.
- **Sky and environment** (`lighting/sky.ts`): the three.js physical Sky with its output clamped to **≤ 24**, light clouds and night stars. A PMREM environment map is rebuilt from it at most every **250 ms**, and only when the sun moves.
- **Height fog** (`render/fog.ts`): it thickens toward the lake (−50 ft) and thins with height, so the valley hazes and the house stays crisp.
- **Shadows:** a **4096** map, PCF soft (radius 2.5), a **±70 ft** box around the house, and `autoUpdate` off. They re-render only when the sun or the bookcase door moves.
- **Interior light** (`lighting/interior.ts`, `fixtures.ts`, `interiorEnv.ts`). Light counts are fixed, so shaders never recompile while you walk.
  - Hemisphere fill.
  - **4 RectAreaLights** in the nearest big glass walls, driven by daylight.
  - A pool of **8 shadowless 2700 K point lights** re-assigned every 250 ms to the nearest room fixtures.
  - **Recessed cans:** 6.5 ft grid, instanced emissive discs in trim rings, so they bloom at night.
  - A small "room" environment map, so interior surfaces reflect a warm room and a window instead of the open sky.
- **Post-processing** (`render/post.ts`, pmndrs `postprocessing` + N8AO), in a half-float HDR chain: N8AO → exposure → bloom → tone map → grade → vignette + grain → SMAA.
  - **N8AO:** half resolution on High. Its radius is a world-space 4 ft, so distant ridges get no AO and there are no dark ridge lines.
  - **Bloom:** mipmap blur with threshold 1.1.
  - **Tone mapping:** AgX by default, with ACES available for A/B.
  - **Grade:** a soft S-curve and +8% saturation.
  - **Grain:** 2%.
- **Time of day** (`lighting/timeofday.ts`) moves everything together: sun, sky, PMREM, fog color and density, lake color, hemisphere, daylight through the glass, lamps on below ~3° of sun, and exposure (separate targets inside and outside, eased as you walk through a door).

## Stage 3 proof (`pnpm test`: all passing)

- `proof/stage3/contact-sheet.jpg`: the **10 fixed views × Noon / Golden / Night**, full-size frames in `proof/stage3/views/`.
- `proof/stage3/health.csv`, from `tests/visual.spec.ts`, which checks every frame:
  - **0 Inf/NaN pixels** in the HDR buffer in all 30 frames. This is the root cause of bloom "black squares", counted exactly.
  - **Clipped (blown-out) pixels ≤ 0.73%** in every frame (the test fails above 3%). The worst frames are looking into the low sun through the west glass at 5:45 PM.
  - **52–112 scene draw calls** and ~110k triangles per view (shadow pass not included).
- Reviewed by eye for shadow acne, AO lines on distant ridges, floating objects and z-fighting. The review found z-fighting between the interior ceilings and the roof slab's underside (a sawtooth on the Study ceiling). Fixed by setting ceilings 0.04 ft lower.
- `proof/stage3/tonemap-agx-left-aces-right.jpg`: AgX keeps the great-room glass readable at golden hour, while ACES blows it out. ACES is punchier at night.
- `tests/baselines/stage3/`: these frames at 640×360 become the approved baselines once you OK this stage. Later stages fail if a view changes by more than MAE 6/255 without re-approval.

## Stage 4: what was built

- **Furniture (all 155 items from `furnitureByRoom`)** (`src/furniture/`):
  - `catalog.ts` maps every item name to a parametric model, ported from the reference prototype's builders (the JSON sizes were measured from them). Each model has material *roles* (upholstery, wood, rug), so finishes can change without rebuilding.
  - `furnish.ts` fits each model exactly to its `size` box and logs anything that needs more than 15% non-uniform scale. The four builders it first flagged were fixed: now 0 of 155.
  - Pieces are merged by level × material: about 40–60 draw calls per floor for all furniture. Books and wine bottles are instanced.
  - Colliders: an oriented box per piece. Plants collide only at the pot and the umbrella only at its pole. Rugs, art and wall-mounted pieces don't collide.
- **Staging:**
  - **F** (or the dock button) fades the loose furniture out and back in over 400 ms. Built-ins (cabinets, islands, vanities, closets, bookcases, the fireplace) always stay. When empty, you can walk where the furniture was.
  - **Click** a sofa, bed, chair or stool to cycle Linen → Leather → Bouclé, or a rug through Natural wool → Flat-weave stripe → Kilim. A wall in front of the piece blocks the click.
- **The world beyond the lot** (`src/build/world.ts`):
  - A long lake between our bluff and the far shore, about 1,750 ft west.
  - Wooded hills: our side climbs gently away from the house, the far side rises 300–1,300 ft.
  - Fall color painted per vertex (burnt orange, red maple, gold hickory, russet, evergreens on the high ground) under a canopy texture.
  - Three rings of Blue Ridge silhouettes at 7,500–11,500 ft.
  - A distance haze joins the height fog, so the far ridges fade blue.
- **Lake** (`src/render/lake.ts`):
  - A planar mirror at half resolution, rendered once per frame before the post chain (so the AO pass never triggers it), with interior furniture hidden.
  - Two scrolling ripple normal maps and a slow swell, Fresnel mixed with the deep-water color, and a sun glint.
  - Quality Low turns the reflection off.
- **Trees** (`src/build/trees.ts`):
  - ~260 near trees, instanced per species: red maple, orange oak, gold hickory and white pine. Each has 130–170 alpha-tested leaf cards that sway in the wind (vertex shader) and cast leaf-shaped shadows (a matching depth material).
  - 1,800 camera-facing impostors from 300 to 1,000 ft.
  - 70 boulders on the bluff.
  - Nothing grows on the house, decks, pool, drive, bluff stairs or dock (all from the JSON). Below the house, trees are kept under the main-level sightline so the lake view stays open.
- **Fire and outdoor lights** (`src/lighting/fire.ts`, `outdoor.ts`):
  - A wood fire in the great-room firebox: logs, an ember bed, animated noise-shader flames that bloom, and a flickering firelight.
  - Infrared heaters under the covered deck, sconces on the entry piers, step lights along the bluff stairs, lanterns on the dock and lights in the pool.
  - Six outdoor light clusters join the shared light pool, so the nearest ones light the ground after dark.
- **Assets** (`scripts/fetch-assets.ts`, `pnpm assets`):
  - Queries the Poly Haven and ambientCG APIs, downloads, compresses with glTF-Transform, and writes `public/models/manifest.json`.
  - At startup the app swaps each stand-in for its downloaded model, fitted to the same box.
  - Here the hosts are blocked, so it wrote `assets/MANUAL-DOWNLOADS.md` instead. `CREDITS.md` lists everything.

## Stage 4 proof (`pnpm test`: all passing)

- `proof/stage4/contact-sheet.jpg`: the 10 fixed views plus **view 11, the house from the water**, at Noon / Golden / Night. Full-size frames are in `proof/stage4/views/`.
- `proof/stage4/health.csv`: **0 Inf/NaN pixels** in all 33 frames, and clipping **≤ 0.2%**.
  - **~490k triangles** outdoors (budget 1.5M).
  - **139–257 draw calls inside** (budget 250: the foyer and kitchen are 5–7 over; see Known issues).
  - **288–299 outside** (budget 400).
- `tests/clearance.spec.ts` → `proof/stage4/clearance.txt`, checking 27 doorways, 221 wall pieces, 3 pieces of art and the whole tour:
  - **every doorway** keeps a clear 3-ft path, 3 ft deep on both sides;
  - **no furniture box** intersects a wall;
  - **art** hangs within 0.2 ft of a solid wall, never over an opening;
  - **no furniture collider** comes within 1 ft of the tour path.
- `tests/tour.spec.ts` (with furniture colliders on): the tour completes with **0 contacts** with walls, rails, glass or furniture.
- `tests/staging.spec.ts`:
  - the F fade is halfway at 200 ms and done at 400 ms;
  - loose colliders turn off while 30+ built-in colliders stay;
  - the finish cycles are checked.
  - Screenshots: `furnished-left-empty-right.jpg`, `finishes-linen-leather-boucle.jpg`.
- `CREDITS.md` is complete for what ships today: everything is generated in code, plus the four code libraries and the font.

## Next (Stage 5: baked GI + reflection probes)

- The Blender bake pipeline, three blended lightmaps, box-projected probes. Before/after shots of the great room, kitchen and primary bedroom.

## Walkthrough video (`tests/record.spec.ts`)

- `RECORD=1 pnpm exec playwright test tests/record.spec.ts` renders the guided tour to `video/bluff-house-tour.mp4` (git-ignored):
  - a fixed 1/30 s step per frame, so it's perfectly smooth however slow each frame is to render;
  - room captions drawn on, with fades on simulation time;
  - frames where nothing changed are reused;
  - resumable: frames already on disk are kept.
- Software rendering costs ~2 s per 960×540 frame, so the full 6.4-minute tour takes a few hours headless. On a real GPU the same code would record in minutes.

## Decisions made (please confirm or overrule)

1. **Input files.** Your kit (`bluff-house-claude-code-kit.zip`) is now in the repo:
   - `PROMPT.md` is the spec.
   - `reference/` holds the prototype and the approved plans. They're the same as the copies I first pulled from your artifacts, apart from file formatting.
   - `reference/house-data.kit.json` is your original data, kept untouched.
   - `house-data.json` is the working copy. It equals the kit on rooms, open spans and openings (checked by `tests/data.spec.ts`), and adds the `site`, `stair` and `location` sections plus the re-centered tour stops.
   - **Furniture positions:** the kit stores where the prototype *placed* each item; `house-data.json` stores the center of each item's measured footprint. They're up to 1.6 ft apart (the sectional's chaise). The spec asks for the center so a model can be fitted to the `size` box in Stage 4, so I kept the footprint centers.
   - **Range hood:** my first extraction put it in Bedroom 4 (above it, by height). The kit is right that it belongs in the kitchen. Fixed, and the extractor too.
2. **three.js r186 instead of r17x.** r186 is the current stable release, and the pmndrs `postprocessing` library supports it. It's pinned exactly: `three@0.186.1`.
3. **Site data moved into the JSON.** The decks, terrace, pool, entry, motor court, bluff stairs and dock were hard-coded in the prototype. They're now a `site` section of `house-data.json`, so they follow the same "change the JSON, rebuild" rule.
4. **Stair runs.** 8 treads × 11 in = 7.33 ft, so flight A starts at z 24.67 (not 24) and flight B ends at x 44.67 (not 44). The extra 8 in is hall floor.
5. **Stair guards.** Each open side of the well gets one continuous glass panel, from the lower floor to 42 in above the top floor (a glass stair "tower").
   - Separate rails per level left gaps or overlapped each other.
   - Walnut handrails run along the wall side of each flight.
6. **Bookcase door.** It rests 25° ajar as specified. Within about 5 ft it swings to 92°, then closes again as you leave.
   - At 25° the gap is only about 1.3 ft, so the 2-ft capsule (and the tour) couldn't get through the 3-ft opening.
   - Alternative: widen that opening to 3.5 ft in the JSON.
7. **Kitchen size.** The data has an L-shaped kitchen of 584 sq ft (16×26 + 14×12), not the 30×26 in the spec text. I kept the data: it's what the approved plans show and what makes the main level total 3,332.
8. **Gable eave.** The north eave is dropped where the gable meets the upper-hall roof. Otherwise it poked down into the upper hall.

### Stage 2 decisions

9. **Tour stops adjusted in the JSON.** The prototype's stops cut corners through 2.5–3 ft doorways with the 2-ft capsule. About 12 stops were re-centered or added (they're still data, in `tourStops`):
   - the primary door, slider and powder door;
   - the turn into the Study;
   - the foot of the stairs;
   - the lower-level route to the bar and the golf bay, which previously cut under the main floor outside the walls.
10. **Bookcase door leaf is 8 in deep (was 10 in)** and starts swinging at 12 ft away instead of 9.5. That leaves 2.3 ft of clear passage when it's open.
11. **The stair glass starts 1 ft into flight A on the two lower levels.** The treads there are under a foot high, so there's no fall risk, and it keeps the turn onto the stair clear. On the top floor the guard still runs the full length of the well.
12. **NOAA sun pulled forward from Stage 3.** The time slider needed a real sun. The physical sky and lighting are still Stage 3.

### Stage 3 decisions

13. **Procedural textures instead of downloaded CC0 sets.** This environment's network policy blocks the texture hosts (ambientCG, Poly Haven). Every material is generated in code at real-world scale.
    - Swapping in photo-scanned sets later is a change to one table.
    - To allow the hosts: environment menu → Edit → Network access → Allowed domains, then add `ambientcg.com`, `acg-download.struffelproductions.com`, `dl.polyhaven.org` and `api.polyhaven.com`.
14. **AgX over ACES.** AgX keeps the glass walls and the lake readable when the sun is in frame. ACES clips them. A soft S-curve after AgX restores the punch without clipping; a linear contrast boost had pushed two golden frames past 3% clipped.
15. **Interior environment stand-in.** Until Stage 5's baked lighting and box-projected probes, interior surfaces reflect a small generated "room" (warm floor, walls, a window that follows the sky, lamps at night) instead of the open sky. Otherwise every interior had a blue-white sheen.
16. **AO limited by distance, not by a box.** N8AO's radius is a world-space 4 ft with distance falloff. Far terrain can't produce dark ridge lines, and no clipping box is needed.
17. **Glass without a transmission pass.** It's a premultiplied blend with Fresnel reflection. A transmission pass would re-render the scene behind every pane, and the look is the same for clear architectural glass.
18. **Recessed cans:** each can is an emissive disc that blooms. The "soft pool" under them comes from the pooled room lights (2.2 ft below the ceiling), not one light per can. 100+ real lights would be too many; Stage 5's bake gives each can its true pool.
19. **Camera 10 (house from the dock).** The dock sits under a boathouse roof, and the ~56-ft, ~50° bluff hides everything below the top floor from the water's edge. The shot is taken from the foot of the bluff stairs, where only the top of the house clears the crest. **Proposal:** add an 11th view "house from the water" (a boat-height camera ~150 ft out) as the hero exterior.

### Stage 4 decisions

20. **Parametric furniture instead of downloaded CC0 models.** Poly Haven, Kenney, Quaternius, Sketchfab and ambientCG are all blocked here.
    - As the spec allows, I listed exact pages and API URLs (`assets/MANUAL-DOWNLOADS.md`) and continued with stand-ins.
    - The stand-ins are the prototype's builders, fitted exactly to the JSON sizes.
    - `pnpm assets` (or a manual download plus `pnpm assets --local`) swaps real models in with no code changes.
21. **Data changes for the clearance rule** (all in `house-data.json`):
    - **Tour stops:** 19 moved (by up to ~1.5 ft) and 2 added (around the sink island's end), so the 2-ft capsule clears every chair, stool, toilet and bed. Every dwell keeps its timing and look-at; four dwell spots (wine room, powder room, Bedroom 2, bar) stand 0.6–1.4 ft from where they were.
    - **Built-ins:** 32 nudged 0.1–0.54 ft off the walls they penetrated. The prototype placed them against wall centerlines, not wall faces.
    - **Doorways:** 6 pieces moved out of doorway paths.
    - **Bar stools:** tucked 0.55 ft under the counter overhang.
    - **The dog wash** moved from the mudroom's east wall to its west wall, beside the lockers. Between the mudroom's two doors it blocked one 3-ft doorway path or the other in either orientation. It's the only item that moved more than the kit test's 1.7 ft, and it's listed as a named exception in `tests/data.spec.ts`.
22. **Doorway clearance rule as implemented:** a path min(3 ft, door width) wide, 3 ft deep on both sides of the wall. On a slider, folding wall or garage door, any 3-ft window across the opening counts.
23. **View 11, the house from the water,** was added to the fixed views, as proposed in Stage 3. View 4 (kitchen) moved east of the sink island so the islands and the lake are both in frame.
24. **Lake reflection skips interior furniture** (as the spec says). Lit windows and the architecture still reflect.
25. **The far hills are a vertex-colored canopy heightfield, not individual trees.** Real trees go out to 300 ft, impostors to 1,000 ft, and the canopy beyond. Optional cloud shadows are not done.

## Known issues (to fix in later stages)

- The terrain is a 2-ft grid, so a 2-ft sloped "trench" shows outside buried lower-level walls (Stage 4: finer grid near the house).
- Quality "Auto" equals "High" until the adaptive system in Stage 6. Medium and Low already change the pixel ratio and shadow-map size.
- The loader bar is honest but trivial for now: there are no downloaded assets until Stage 4.
- Some interior light leaks: the RectAreaLights and point lights have no shadows, so a little daylight or lamplight reaches surfaces it shouldn't (Stage 5's bake fixes this).
- **Draw calls inside are 5–7 over budget in two views** (foyer 255, kitchen 257 vs 250): trees and landscape seen through the glass add ~20. Stage 6 will merge the outdoor fixtures, put trees on a distance/visibility switch from inside, and add LODs.
- The trees are stylized (procedural leaf cards), not photo-scanned glTF trees, and the canopy texture repeats visibly on the far hills up close.
- From the dock at night the bluff is mostly dark apart from the step lights. That's realistic, but a moon or more landscape light would read better.
- Downloaded models swap in automatically, but their per-model materials won't merge, so each one adds draw calls (Stage 6 merges them).
- Headless frame rates are SwiftShader (software) numbers and say nothing about real GPU speed.
- The interior draw-call counts include the shadow pass and stay under 250. They will grow with furniture (Stage 4).
