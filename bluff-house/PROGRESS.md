# Bluff House walkthrough: progress

## Status: Stage 2 (Tour + UI) done, waiting for approval

| Stage | Status |
|---|---|
| 1. Skeleton (clay geometry, collisions, stairs, level culling) | ✅ approved, proof in `proof/stage1/` |
| 2. Tour + UI | ✅ done, proof in `proof/stage2/` |
| 3. Materials + realtime lighting | ⏳ next |
| 4. Furniture + exterior | — |
| 5. Baked GI + reflection probes | — |
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

## Next (Stage 3: materials + realtime lighting)

- PBR material library, physical sky + PMREM, tuned shadows, RectAreaLights in the big glass, the 8-light interior pool, post-processing (N8AO, SMAA, bloom, AgX vs ACES) and 10 fixed screenshots at Noon / Golden / Night.

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

## Known issues (to fix in later stages)

- The terrain is a 2-ft grid, so a 2-ft sloped "trench" shows outside buried lower-level walls (Stage 4: finer grid near the house).
- The sky is a flat color that follows the time of day. The physical sky and environment lighting are Stage 3.
- Quality "Auto" equals "High" until the adaptive system in Stage 6. Medium and Low already change the pixel ratio and shadow-map size.
- The loader bar is honest but trivial for now: there are no downloaded assets until Stage 4.
- Headless frame rates are SwiftShader (software) numbers and say nothing about real GPU speed.
- The interior draw-call counts include the shadow pass and stay under 250. They will grow with furniture (Stage 4).
