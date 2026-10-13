# Bluff House walkthrough: progress

## Status: Stage 1 (Skeleton) done, waiting for approval

| Stage | Status |
|---|---|
| 1. Skeleton (clay geometry, collisions, stairs, level culling) | ✅ done, proof in `proof/stage1/` |
| 2. Tour + UI | ⏳ next, not started |
| 3. Materials + realtime lighting | — |
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

## Next (Stage 2: tour + UI)

- Centripetal Catmull-Rom tour through `tourStops`, sampled by arc length. Dwell easing, look-at, head-bob, and the Space/R handoff to free walk.
- Room captions, a smoked-glass dock, room-size labels (L), measuring (M) and the shortcut card (H).
- `tour.spec.ts`: a fixed-timestep run with zero wall, rail or glass intersections and every room visited.

## Decisions made (please confirm or overrule)

1. **Input files.** `house-data.json` and the prototype weren't in the repo. I took the prototype from your "Bluff House" artifact (`reference/bluff-house-v3.html`) and the approved plans from the "Bluff House Floor Plans" canvas (`reference/plans/`).
   - `scripts/extract-prototype.mjs` rebuilds the JSON from the prototype. It parses the plan data and measures the furniture by running the prototype headless.
   - If you have your own `house-data.json`, drop it in and rebuild. The schema is in `src/data/types.ts`.
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

## Known issues (to fix in later stages)

- The terrain is a 2-ft grid, so a 2-ft sloped "trench" shows outside buried lower-level walls (Stage 4: finer grid near the house).
- The sun is a fixed mid-afternoon placeholder. NOAA time of day is Stage 3.
- Headless frame rates are SwiftShader (software) numbers and say nothing about real GPU speed.
- The interior draw-call counts include the shadow pass and stay under 250. They will grow with furniture (Stage 4).
