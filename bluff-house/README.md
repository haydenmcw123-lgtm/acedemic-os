# Bluff House: first-person walkthrough

A browser walkthrough of a 7,224 sq ft lake house above Lake Lure, NC. The whole house is generated from `house-data.json`.

```bash
pnpm install
pnpm dev          # http://localhost:5173  (click to walk: WASD, Shift sprint, V roof, C collider, 1/2/3 levels)
pnpm test         # Playwright: plan alignment, collisions, clay views → proof/
pnpm build        # production bundle in dist/
```

See `PROGRESS.md` for the stage plan, the decisions made so far and the known issues.
