# Bluff House: first-person walkthrough

A photoreal browser walkthrough of a 7,224 sq ft lake house above Lake Lure, NC, on a mid-October afternoon. Every wall, door, stair, room and piece of furniture is generated from one file, `house-data.json`: change the JSON, reload, and the house rebuilds.

**Live:** https://haydenmcw123-lgtm.github.io/acedemic-os/bluff-house-tour/

## Run it

You need [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io) (`npm install -g pnpm`).

```bash
pnpm install && pnpm dev          # → http://localhost:5173
```

The guided tour starts by itself (about 6½ minutes, 33 stops). Take over any time:

| Key | Does |
|---|---|
| **Space** | pause the tour / free walk (WASD or arrows, mouse to look, Shift to hurry) |
| **R** | resume the tour from where you are |
| **T** | next time of day (Morning, Noon, Golden, Sunset, Night), or drag the slider |
| **F** | furnished ↔ empty (click a sofa, bed, chair or rug to cycle its finish) |
| **L** | room-size labels |
| **M** | measure: click two points |
| **B** | baked lighting on/off (before/after) |
| **H** | the key card |

Quality is **Auto** by default. If the frame rate drops it lowers resolution, then shading, reflections and shadows, and it climbs back when there's headroom. High, Medium and Low are fixed.

## Deploy (GitHub Pages)

```bash
pnpm deploy:pages
```

It builds the production site for `/acedemic-os/bluff-house-tour/`, commits only that folder to `main` and pushes. Your Academic OS page at the site root is never touched. GitHub Pages republishes in about a minute. Pages must be set to *Deploy from a branch → main / (root)*, which it already is.

Other hosts: `pnpm build` writes a static site to `dist/`; upload that folder anywhere (Netlify, Vercel, S3). Set `BASE_PATH=/sub/path/` when building if the site isn't served from the domain root.

## Check it

```bash
pnpm test         # Playwright, headless: geometry, collisions, the full tour, visuals, budgets (~1 h in software)
pnpm perf         # the real perf check on YOUR GPU: opens Chrome, plays the tour on High and Medium → perf-report.md
```

`pnpm perf` takes about 15 minutes; leave the window alone. No Google Chrome? Run `pnpm exec playwright install chromium`, then `PERF_BROWSER=chromium pnpm perf`. While `pnpm dev` runs you can also open `http://localhost:5173/?perf` in any browser; the report appears on screen at the end.

## Rebuild the generated assets

These outputs are committed, so you only need these after changing the house or the materials:

```bash
pnpm bake         # Blender lightmap bake (~1 h on 4 cores; needs Blender: brew install --cask blender)
pnpm textures     # textures + lightmaps → mip-mapped KTX2 (~11 min). Run after every bake.
pnpm assets       # optional: real CC0 furniture models (see assets/MANUAL-DOWNLOADS.md)
```

## How it's built

- **three.js r186** (WebGL2) with **postprocessing** (HDR, AgX tone mapping, bloom, SMAA) and **N8AO** ambient occlusion. Vite + strict TypeScript, pnpm.
- **Geometry:** `src/build/` turns the rooms, spans and openings in `house-data.json` into merged walls, floors, ceilings, stairs and glass, with a BVH collider for walking.
- **Lighting:**
  - a NOAA sun for 14 October at Lake Lure, a physical sky and a 4096² shadow map;
  - interiors use three Cycles lightmaps (Morning, Noon, Golden) blended with the clock, plus six box-projected reflection probes;
  - lamps and cans are real lights at night.
- **Materials:** procedural PBR sets at real-world scale, pre-baked to KTX2. Furniture is parametric, fitted to each item's size box from the JSON.
- **Performance:** adaptive quality, LODs, instancing, level culling, KTX2 and shader warm-up behind the loader. Budgets and numbers are in `proof/stage6/perf-report.md`.

Where to look next:

- `PROGRESS.md`: every stage, decision and known issue.
- `CREDITS.md`: every library and tool, with its license.
- `proof/`: the evidence for each stage.
