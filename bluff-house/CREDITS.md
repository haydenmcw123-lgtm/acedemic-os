# Credits

## Code libraries

| Library | Version | License | Used for |
|---|---|---|---|
| [three.js](https://threejs.org) | 0.186.1 | MIT | renderer, Sky shader, RoundedBoxGeometry, GLTFLoader, BufferGeometryUtils, RectAreaLight |
| [postprocessing](https://github.com/pmndrs/postprocessing) | 6.39.5 | Zlib | HDR composer, bloom, AgX/ACES tone mapping, SMAA, vignette, grain |
| [n8ao](https://github.com/N8python/n8ao) | 2.0.1 | ISC | ambient occlusion |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 0.9.16 | MIT | collision and sight-line queries |
| [Inter](https://rsms.me/inter/) (Google Fonts) | — | SIL OFL 1.1 | UI type |

## Models and textures

**Everything you see is generated in code from `house-data.json`** — no third-party art is bundled yet:

- **Furniture (155 items):** parametric models in `src/furniture/catalog.ts`, ported from the builders in the
  reference prototype (`reference/bluff-house-v3.html`, the project's own kit), each fitted to its JSON size box.
- **Materials:** procedural PBR texture sets (albedo, normal, roughness/AO) in `src/materials/procedural.ts`,
  `furnitureTex.ts` and `natureTex.ts`, each at a real-world tile size in feet.
- **Landscape:** procedural hills, ridgelines, fall trees (leaf cards), impostors, boulders and lake ripples
  (`src/build/world.ts`, `src/build/trees.ts`, `src/render/lake.ts`).
- **Sky:** three.js `Sky` (Preetham model), MIT.

The spec prefers CC0 scans (Poly Haven, ambientCG, Kenney, Quaternius; Sketchfab CC0/CC-BY with attribution).
Those hosts are blocked by this build environment's network policy, so `scripts/fetch-assets.ts` lists exactly
what to fetch in `assets/MANUAL-DOWNLOADS.md`. When models are downloaded (`pnpm assets`), their credits are
written to `assets/downloaded-credits.md`; paste them here.

| Asset | Source | Author | License |
|---|---|---|---|
| — none downloaded yet — | | | |
