# Build prompt: "Bluff House" photoreal walkthrough

> Paste everything below the line into Claude Code, run from a folder that contains:
> - `house-data.json` (the floor plan, openings, furniture and tour, the single source of truth)
> - `reference/bluff-house-v3.html` (a working single-file prototype to mine for algorithms)
> - `reference/plans/level0.svg`, `level1.svg`, `level2.svg` (the approved floor plans)

---

## 0. Role and how to work

You are building a **photoreal, smooth, first-person 3D walkthrough** of a 7,224 sq ft three-level lake house that sits on a bluff above Lake Lure, North Carolina. It runs in the browser and is aimed at a mid-range laptop.

Work in **stages** (section 9). At the end of each stage:
- run the tests,
- capture screenshots,
- report what passed and what didn't,
- **stop and wait for my OK** before the next stage.

Rules:
- Don't skip ahead.
- Don't mark anything done without proof: a screenshot, a test result or a frame-time number.
- If something in this spec conflicts with what looks or performs best, tell me and propose the change. Don't silently deviate.
- Keep a `PROGRESS.md` with what's done, what's next, known issues and any decisions you made.
- Explain decisions in plain language. I'm learning Claude Code through this project, so after each stage give me a 3–5 bullet "what you built and why" summary.

---

## 1. Goal and quality bar

- **Realism is the #1 priority.** It should read like an architectural visualization, not a video game:
  - correct scale,
  - soft contact shadows in every corner,
  - bounce light,
  - glossy floors with real reflections,
  - believable fabrics,
  - a sky and lake that sell the location.
- **Smoothness is #2.**
  - Hold 60 fps on a 2022+ laptop with integrated graphics (Intel Iris Xe / Apple M1) at 1080p using the "High" preset. Floor: 45 fps.
  - No hitches over 50 ms while walking.
  - No pop-in that a normal user would notice.
  - Camera motion is eased everywhere.
- **Everything is generated from `house-data.json`.**
  - Walls, floors, openings, collisions, room labels, measurements and the tour all come from that data.
  - If I change a room rectangle in the JSON and rebuild, the house, the collisions and the tour labels all update.
  - Never hand-place a wall.

---

## 2. Tech stack (use exactly this unless you justify a change)

- **Vite + TypeScript** (strict mode), `pnpm`.
- **three.js** (latest stable r17x; pin the exact version in package.json).
- **Post-processing:** the `postprocessing` library (pmndrs). Effects:
  - **N8AO** (`n8ao` package) for ambient occlusion.
  - SMAA or MSAA.
  - Bloom (mipmap blur, luminance threshold so only windows, bulbs and the sun bloom).
  - **AgX or ACES Filmic tone mapping** (A/B them in screenshots and pick one).
  - Subtle vignette and film grain at ≤ 2% strength.
  - **SSR is optional.** Use it only if it holds the frame budget; otherwise rely on reflection probes (see section 5).
- **Collisions:** `three-mesh-bvh` with a **capsule character controller** (radius 1.0 ft, height 5.75 ft, eye height 5.5 ft).
- **Assets:**
  - glTF 2.0 (`.glb`) compressed with **Meshopt** geometry and **KTX2 (Basis UASTC for normals, ETC1S for color)** textures, using `gltf-transform` in a build script.
  - Load with `GLTFLoader` + `KTX2Loader` + `MeshoptDecoder`.
- **Lighting bake (Stage 5): Blender 4.x, run headless** (`blender -b -P scripts/bake.py`), Cycles, baking lightmaps to a second UV channel.
  - If Blender isn't installed, tell me the one install command for my OS and wait.
- **UI:** plain TypeScript + CSS (no React needed). It must look premium: smoked glass, Inter or a similar font, smooth 200 ms transitions.
- **Tests:** Playwright (Chromium) for automated tour, collision and screenshot runs.
- **Code layout:**
  ```
  src/
    data/        (types + loader for house-data.json)
    build/       (walls.ts, floors.ts, stairs.ts, roof.ts, openings.ts, exterior.ts, terrain.ts)
    materials/   (library.ts: one place for every PBR material)
    furniture/   (catalog.ts: maps item names → glb + scale + offset)
    lighting/    (sun.ts, sky.ts, interior.ts, probes.ts)
    player/      (controller.ts, tour.ts, input.ts)
    ui/          (dock.ts, labels.ts, measure.ts, staging.ts, loader.ts)
    render/      (renderer.ts, post.ts, quality.ts)
    main.ts
  scripts/       (fetch-assets.ts, compress-assets.ts, bake.py, gen-plans.ts)
  tests/         (tour.spec.ts, collision.spec.ts, visual.spec.ts, perf.spec.ts)
  ```

---

## 3. The house (exact data is in `house-data.json`)

### Coordinate system
- Units are **feet**.
- **+x = east, −z = north.** The lake and the view are **west (x < 0)**. The street and garage are east.
- The y axis is up.

### Levels

| Level | Name | Floor y | Ceiling | Wall height |
|---|---|---|---|---|
| 0 | Lower (walkout to pool) | 0 | 10 ft | 11 |
| 1 | Main (street entry) | 11 | 10 ft | 11 |
| 2 | Upper | 22 | 9 ft | 9 |

### Data structures
- **`rooms`**: each room has `id`, `level`, `name`, `rects` (one or more `[x0, z0, x1, z1]`), plus optional flags:
  - `floor` (hickory default; also `tile`, `slate`, `rubber`, `turf`, `concrete`)
  - `wall` (plaster default; also `tilewall`, `stone`, `paneling`, `theater`, `drywall`)
  - `noCeil` (open to the roof above)
  - `void` (the double-height great-room space on level 2)
  - `stair`
  - `meta` (a caption shown on entry)
- **Wall generation algorithm** (proven in the prototype; port it):
  - Rasterize rooms onto a 1-ft ownership grid per level.
  - Put a wall on every grid edge where the owner changes, including room-to-outside.
  - Merge collinear edges into runs.
  - Remove edges listed in `opens`. Those are open-plan spans; `rail: true` means a guard rail goes there instead of a wall.
  - Cut `openings` out of the remaining runs.
  - Walls are **0.5 ft thick**. Each wall face takes the material of the room it faces. Exterior faces are board-and-batten siding on levels 1–2 and stacked stone on level 0.
- **`openings`**: `{level, axis, at, from, to, kind, sill, head}`. Kinds:
  - `door`: **pocket door**. Show the casing and an open slot only, never a swinging leaf. Swinging doors read as random walls in a walkthrough.
  - `front`: double 9-ft timber pivot doors with sidelights.
  - `window` / `glass`: fixed glazing from the sill to the head. Use thin black steel frames with mullions every ~4 ft.
  - `slide`: multi-panel sliders, shown open.
  - `fold`: a 17-ft folding glass wall in the great room, shown open so the great room flows onto the covered deck.
  - `glassdoor`: the frameless glass door into the wine room.
  - `open`: a cased opening with no door.
  - `bookcase`: a **hidden bookcase door** into the Study. Render it as a full bookcase that is swung 25° open on a pivot, with books and a warm glow behind it. It's the signature detail.
  - `gdoor`: garage doors (insulated, carriage-style, wood-look).
  - `fireplace`: a stone fireplace mass that rises through both stories to the ridge (x −2.5…2.5, z 24…31).

### Stairs
- A switchback stair in the Stair Hall, x 42–56, z 22–36, serving all 3 levels.
- Flight A runs north to south along x 52–56 from z 24 to z 32, then a landing at z 32–36.
- Flight B runs east to west from x 52 to x 44, arriving at the next floor.
- Use 7.33-in. risers and 11-in. treads. That's 18 risers per 11-ft floor, so check the math and adjust the landing if needed.
- Open-riser white oak treads on a steel mono-stringer, with glass guard rails and a walnut handrail.
- **Collision for stairs uses an invisible ramp**, not the treads, so walking is smooth.

### Roof
- Standing-seam metal (dark bronze) with 2.2-ft eaves.
- The **great room has a gable** with the ridge running east–west along z = 35. Pitch is about 8:12 (0.68). The ridge is ~29 ft above the main floor.
- Exposed timber trusses inside.
- A full glass gable end facing the lake.

### Program (7,224 heated sq ft + 1,352 sq ft garage + ~700 sq ft decks)
- **Main level (3,332 sq ft):**
  - Entry Foyer 18×22 (slate floor).
  - Great Room 26×26, two-story with a stone fireplace.
  - **Kitchen 30×26, fully open to the great room.** No wall between them, and a 14-ft island facing the lake.
  - Dining 18×12 with glass on two sides.
  - Glass Wine Room 8×8.
  - Powder Room.
  - Butler's Pantry 14×10.
  - Mudroom/Laundry.
  - Primary Suite: bedroom 20×22, bath 18×12, his and hers closets.
  - Garage: 4 cars + boat bay, 26×52.
- **Upper level (2,040 sq ft):**
  - Study behind the bookcase.
  - Bedrooms 2 and 3 with a Jack & Jill bath.
  - Bedroom 4 Suite with its own bath.
  - Loft overlooking the great room.
  - Upper hall with a glass rail along the great-room void.
- **Lower level (1,852 sq ft):**
  - Game & Media Room (26×18 + wet bar) with a walkout to the pool.
  - Home Gym with glass to the lake.
  - Golf Simulator bay.
  - Bedroom 5 + bath.
  - Lower hall.

### Design language
- Mountain-modern lake house: warm, not rustic-kitschy.
- **Materials:**
  - Wide-plank hickory floors with a satin finish.
  - Warm white plaster walls.
  - Stacked fieldstone.
  - Rough-sawn timber beams.
  - White oak cabinetry.
  - Honed quartz with soft veining.
  - Black steel window frames.
  - Aged brass and bronze hardware.
  - Cognac leather.
  - Oatmeal linen.
  - Wool rugs.
- **Mood:** a magazine-shoot calm. Large openings, nothing blocking circulation, and every view leads to the lake.

---

## 4. Furniture and staging

- `furnitureByRoom` in the JSON lists every item with:
  - its plan position `x, z` (center),
  - `rotDeg` (rotation about y),
  - `size` `[w, h, d]` in feet: the footprint and height it must fit.
- **Replace every item with a real CC0 glTF model:**
  - Sources, in order of preference:
    1. **Poly Haven** models (CC0)
    2. Kenney / Quaternius (CC0) for simple items
    3. **Sketchfab CC0 or CC-BY only**, with attribution logged in `CREDITS.md`
  - Write `scripts/fetch-assets.ts` to download them.
  - If a download is blocked in your environment, list the exact URLs for me to download manually into `assets/raw/` and continue with placeholders.
- **Scaling:** scale each model to fit its `size` box and keep its proportions. Log any model that needs more than 15% non-uniform scale and pick a better one.
- **Textures for architecture:** **ambientCG / Poly Haven PBR sets**, 2K, with albedo + normal + roughness (+ AO). Every material has a real-world tile size in feet, and UVs are world-projected in feet, so a 6-in. plank is 6 in. everywhere.
- **Clearance rule:** nothing within 3 ft of a doorway centerline or across any tour path.
  - No floor lamps or plants in walkways.
  - No art floating off walls. Art must sit flush on a wall that exists and must not overlap an opening.
  - Write a test for this (section 10).
- **Staging feature:**
  - Click a sofa, bed, rug or chair to cycle through 3 finishes: Linen / Leather / Bouclé, or 3 rug patterns.
  - Press **F** to toggle Furnished ↔ Empty, with a 400 ms fade. Fade the materials' opacity, or scale items to 0 with an ease.
  - Built-ins (cabinets, island, vanities, fireplace, bookcase, closets) are always present.

---

## 5. Lighting and realism (where most of the effort goes)

### Sun and sky
- The location is **Lake Lure, NC (35.428° N, −82.205° W)**. The date is **October 15**, time zone America/New_York (EDT).
- Compute the sun azimuth and elevation with the NOAA solar position algorithm. The prototype has a working version; port it.
- Sunrise is about 7:30 and sunset about 18:50. Verify both with the algorithm.
- Use a physically based sky: three's `Sky` shader or a Preetham/Hosek model. **Also generate a PMREM environment from it** whenever the time changes (throttled, at most every 250 ms while the slider is dragged).
- Clamp the sky's output (≤ 24) before PMREM to avoid half-float overflow.
- **Sun shadows:**
  - One directional light, shadow map **4096**, PCF soft, a tight shadow camera fitted to the house (±70 ft).
  - Set `shadowMap.autoUpdate = false` and re-render shadows only when the time changes.
  - Tune bias and normalBias so there's no acne on floors and no peter-panning at wall bases.

### Interior light (the realism make-or-break)
- **Stage 3 (realtime):**
  - A hemisphere light plus **RectAreaLights** in the large glass walls so daylight floods in from the windows.
  - A pool of **at most 8 shadowless point lights**, assigned to the nearest fixtures around the camera.
  - Recessed cans render as an emissive disc plus a soft pool of light.
  - At night, pendants, sconces and lamps glow warm (2700 K) and bloom.
- **Stage 5 (baked):** export the static architecture to Blender with a second UV channel (Blender Smart UV or xatlas), bake **Cycles indirect + AO lightmaps** for three times of day (morning, noon, golden hour), and blend between them at runtime as the slider moves. Night uses the noon bake × 0.05 plus the electric lights.
  - Direct sun stays realtime so shadows still move.
  - The result must show visible bounce: the sunlit floor tints walls warm, and ceilings aren't flat gray.
- **Reflection probes:**
  - One cube probe per major room (great room, kitchen, primary, foyer, game room, stair hall).
  - **Box-projected** so floor and cabinet reflections line up with the room.
  - Update them when the time changes.
- **AO:** N8AO, half-res on High.
  - Clip it to a box around the house; on distant terrain it causes dark ridge lines.
  - Tune it so corners and furniture contacts ground without dirty halos.

### Material rules
- Use `MeshPhysicalMaterial`:
  - fabrics: sheen
  - lacquered wood, quartz, leather, car paint: clearcoat
  - glass: transmission or a cheap fake (see the pitfalls)
- **Floor roughness at 0.11.** Below that, half-float specular overflows to Inf/NaN and bloom produces black squares.
- Glass has a very slight green edge tint, Fresnel reflection of the PMREM sky, and no shadows cast by panes.

### Exterior and site
- **Terrain:**
  - The house sits on a gently sloped lot. Grade is at the lower-level floor on the west (y 0) and rises to the main level on the east (y 11).
  - West of x ≈ −34, a wooded **bluff** drops to the lake at about y −52 to −56.
  - Bluff stairs with landings lead down to a **covered boat dock** at about (−84, 100).
- **Lake:**
  - Planar reflections at half resolution with an animated normal map, a slight Fresnel tint and distant fog/haze.
  - Hide interior furniture during the reflection pass.
  - The far shore is ~1,750 ft west, with ridges of the Blue Ridge Mountains beyond.
- **Mid-October fall color:**
  - Hillsides are a mix of oranges, reds, gold and evergreens.
  - Use **instanced** glTF trees for the near trees (≤ 300 ft). They need wind sway in the vertex shader and alpha-tested leaf cards with a proper shadow depth material.
  - Use impostor billboards for the mid range, and a textured, vertex-colored terrain canopy for the far hills.
- **Outdoor spaces:**
  - Covered deck off the great room: x −16…0, z 22…48, at y 11. Timber posts on stone piers, glass rail, ceiling heaters.
  - Primary private deck: x −14…0, z 0…20, with a privacy screen.
  - Paver terrace at grade.
  - **Infinity-edge pool** x −28…−10, z 30…52, 4.5 ft deep, with the vanishing edge on the west side.
  - Entry canopy at x 56–63 with stone piers.
  - Driveway and motor court on the east.
- **Atmosphere:** height fog plus distance haze matched to the sky color, and slow-moving cloud shadows (an optional projected texture).

---

## 6. Experience

### Guided tour (the default on load)
- Use `tourStops` from the JSON. Each has a position; some have `dwellSec`, `lookAt` [x, z, y] and a `label`.
- **Path:** a centripetal Catmull-Rom spline through the stops, sampled by arc length.
- **Speed:** walking pace ~4.4 ft/s, eased to near zero approaching each dwell stop and eased out after it.
- **Camera:**
  - Eases its look direction toward `lookAt` during dwells. Otherwise it looks along the path with a slight lead.
  - Head-bob is subtle: ±0.04 ft vertical and ±0.15° roll, tied to the distance walked.
- **Floor height** comes from the walkable surface under the camera, smoothed with a critically damped spring so stairs feel like stairs, not an elevator.
- **Space** pauses and drops straight into free walk at the same spot. **R** resumes the tour from the nearest path point, blending there smoothly over ~1 s.
- The tour must visit every room on all 3 levels, then the terrace, pool, bluff stairs and dock, and end on the lake view.

### Free walk
- Click to lock the pointer. **WASD** to move, **Shift** to sprint (×2), mouse to look.
- Movement has acceleration and deceleration (no instant stops), and step-up for treads ≤ 0.65 ft.
- **Collisions** use the BVH capsule against walls, rails, furniture, glass, the pool edge and terrain.
- You can't walk off a ledge higher than ~1 ft. Stair ramps are walkable.
- **Plants and umbrellas collide only at the pot or pole**, never with their full bounding box.

### Time of day
- A slider from 6:30 to 21:00, plus presets: Morning 8:00, Noon 12:30, Golden 17:45, Sunset 18:45, Night 20:30.
- Everything updates together: sun, sky, PMREM, fog, lake color, interior lights turning on below ~3° sun elevation, exposure and the lightmap blend.

### Measurement
- **L** toggles room-size labels (e.g. "26′ × 26′"), floating at eye height in each room on the current level and hidden when blocked by walls.
- **M** enters measuring mode: click two points on any surface to draw a line with a feet-inches label (e.g. 14′ 7″). Esc cancels.

### Room names
- When you enter a room, show its name (plus `meta`, if present) in a caption that fades in for 2.5 s.

### UI
- A minimal smoked-glass dock at the bottom center: Tour ▶/❚❚, the time slider with presets, Room sizes, Measure, Furnished, and a quality menu (Auto / High / Medium / Low).
- **H** shows a small shortcut hint in the corner (Space, WASD, Shift, R, L, M, F, T, H, Esc).
- The loader is a thin progress bar with real byte progress from the asset loads, then a 600 ms fade into the first frame. No black-frame flash.

---

## 7. Performance plan

- **Budgets (High preset, 1080p, iGPU):**
  - ≤ **250 draw calls** inside the house and ≤ 400 outside.
  - ≤ 1.5M triangles.
  - ≤ 350 MB of GPU memory.
  - Total download ≤ 60 MB, with first view in under 6 s on a fast connection.
- **Techniques:**
  - Merge static architecture by material.
  - Instance repeated furniture: chairs, stools, books, bottles, recessed cans.
  - Use LODs for trees and big furniture.
  - Cull by level: when you're on the upper floor, hide the lower-level interiors entirely, and vice versa.
  - Mip-mapped KTX2 textures. Anisotropy 8 on floors.
- **Adaptive quality:**
  - Measure the frame time with a 2 s rolling average.
  - If it's over 20 ms, step down one tier: drop the pixel ratio (1.0 → 0.85 → 0.75), then AO resolution, then SSR, then lake reflections, then the shadow map size.
  - If it stays under 12 ms for 10 s, step back up. Never oscillate (use hysteresis).
- **No per-frame allocation** in hot paths: reuse vectors and avoid closures in the render loop.
- Shader warm-up: call `renderer.compile()` on the full scene behind the loader so there are no first-look hitches.

---

## 8. Floor plans stay in sync

- Write `scripts/gen-plans.ts`. It reads `house-data.json` and outputs SVG floor plans per level, showing:
  - walls with poché
  - openings with pocket doors
  - stairs
  - room names and dimensions
  - furniture footprints
  - the north arrow and scale bar
- Use `reference/plans/*.svg` as the target style.
- Run it in CI. If the plans and the 3D model ever disagree, the JSON is wrong, not the code.

---

## 9. Staged build plan (stop after each stage for my OK)

1. **Skeleton** (target: about a day of work for you)
   - Set up Vite + TS + three.js and load the JSON.
   - Generate walls, floors, ceilings, openings and stairs as flat gray "clay" geometry.
   - Free-walk with BVH collisions, the stair ramps and the level culling.
   - **Proof:**
     - clay screenshots of all 3 levels from above (roof hidden)
     - a top-down render overlaid on `level1.svg` that lines up exactly
     - a collision test passing
2. **Tour + UI**
   - Build the tour spline, dwell, look-at, head-bob, Space/R handoff, room captions, the dock, measuring and size labels.
   - **Proof:** the Playwright tour runs start to finish with zero wall or rail intersections, and the logged room-visit list contains every non-void room id.
3. **Materials + realtime lighting**
   - Build the PBR material library, sun/sky/PMREM, shadows, rect lights, the interior light pool, post-processing and time-of-day.
   - **Proof:** 10 fixed camera screenshots (listed in section 10) at Noon, Golden and Night.
4. **Furniture + exterior**
   - Fetch and compress real models, place them from the JSON, build staging, terrain, bluff, lake, pool, decks, dock and fall trees.
   - **Proof:**
     - screenshots
     - the clearance test passing
     - `CREDITS.md` complete
5. **Baked GI + reflection probes**
   - Run the Blender bake pipeline, blend 3 lightmaps, add box-projected probes.
   - **Proof:** side-by-side before/after screenshots of the great room, kitchen and primary bedroom.
6. **Performance + polish**
   - Adaptive quality, shader warm-up, LODs, instancing and the loader.
   - **Proof:**
     - a perf report with average, p95 and p99 frame times during the full tour on High and Medium
     - draw calls and triangle counts per stop
7. **Ship**
   - A production build and one `README.md` with run and deploy steps. Deploy to Netlify, Vercel or GitHub Pages; ask me which.

---

## 10. Tests and acceptance criteria

- **`tour.spec.ts`:**
  - Run the whole tour with a fixed timestep (1/30 s) and the render loop disabled.
  - Assert:
    - the tour completes
    - every room id is visited
    - the camera capsule never intersects walls, rails or glass
    - the tour takes about 5–7 minutes at normal speed
- **`collision.spec.ts`:** scripted walks that check:
  - up and down every flight of stairs
  - into each wall (blocked)
  - into the great-room void rail on level 2 (blocked)
  - into the pool (blocked)
  - off the deck edge (blocked)
  - down the bluff stairs to the dock (allowed)
- **`clearance.spec.ts`:**
  - Every doorway has a clear 3-ft-wide path.
  - No furniture bounding box intersects a wall.
  - No art is more than 0.2 ft off a wall surface.
- **`visual.spec.ts`:**
  - Fixed screenshots:
    - front entry from the motor court
    - foyer looking toward the great room
    - great room toward the lake
    - kitchen island toward the lake
    - primary bedroom
    - primary bath
    - the Study through the bookcase door
    - the loft over the void
    - game room at the walkout
    - exterior from the dock looking up at the house
  - Each at Noon / Golden / Night.
  - Compare against the approved baselines with a tolerance. Before I approve a baseline, review it yourself for: black or NaN pixels, blown-out windows, shadow acne, dark AO lines on distant ridges, floating objects, and z-fighting.
- **`perf.spec.ts`:** log frame-time stats and draw calls during the tour. In headless mode treat these as relative numbers only. Give me a one-line command so I can run the real perf check on my laptop.

---

## 11. Pitfalls already learned (don't repeat these)

- **Half-float specular overflow.** Roughness below ~0.1 on bright, sunlit surfaces produces Inf, and bloom turns it into black squares. Clamp roughness to ≥ 0.11, or clamp the bloom input.
- **The sky shader's HDR** can overflow the PMREM. Clamp it.
- **GTAO/N8AO on far depth** draws dark jagged lines on distant ridges. Limit AO to a box around the house or a distance cutoff.
- **Box3 colliders on plants and umbrellas** create giant invisible walls. Collide on the pot or pole only.
- **Swinging doors** look like random walls in a walkthrough. Use pocket doors or doors shown fully open against a wall.
- **Floor lamps and plants** in circulation paths get in the way of the tour. Keep them out.
- **Merged geometry breaks per-item references.** After merging, re-bind any instanced children (books, bottles) to the merged group so they don't end up at the origin.
- **Planar water reflections** double the cost. Render them at half resolution, skip them during the AO normal pass, and hide interior furniture in the reflection pass.
- **Headless Chrome (SwiftShader)** is slow and has no real GPU. Use a fixed timestep and no render loop for tests, and capture images with `canvas.toDataURL` (`preserveDrawingBuffer` only in test mode).
- **Square footage must be computed from the data**, never estimated. Print it in the console at startup: lower 1,852 / main 3,332 / upper 2,040 = **7,224 heated**.
- **Stair math:** risers × count must equal the floor-to-floor height exactly, or the top step floats.

---

## 12. When you finish

Give me:
1. how to run it locally (one command)
2. the deployed URL
3. what is exact vs approximated
4. the 3 changes that would add the most realism next, with honest effort estimates
