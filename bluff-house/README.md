# Bluff House: first-person walkthrough

A browser walkthrough of a 7,224 sq ft lake house above Lake Lure, NC. The whole house is generated from `house-data.json`.

```bash
pnpm install
pnpm dev          # http://localhost:5173 — the guided tour starts on its own; Space walk · R resume · L sizes · M measure · T time · H help
pnpm test         # Playwright: plan alignment, collisions, full tour sim, UI → proof/
pnpm build        # production bundle in dist/
```

See `PROGRESS.md` for the stage plan, the decisions made so far and the known issues.

## Perf check on your own machine

```bash
pnpm perf         # builds, opens Chrome on your real GPU, plays the tour on High then Medium (~15 min) → perf-report.md
```

Leave the window alone while it runs. No Google Chrome installed? `pnpm exec playwright install chromium` then `PERF_BROWSER=chromium pnpm perf`.
You can also open `http://localhost:5173/?perf` in any browser while `pnpm dev` runs: the report appears on screen at the end.

## Rebuilding generated assets

```bash
pnpm textures     # procedural textures + lightmaps → mip-mapped KTX2 (public/textures, public/lightmaps), ~11 min
pnpm bake         # Blender lightmap bake (~1 h), then run pnpm textures again
```
