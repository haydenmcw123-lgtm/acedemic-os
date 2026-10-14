# Stage 6 perf report (cloud container)

Measured by `tests/perf.spec.ts` in this container. **It has no GPU** (Chromium renders with SwiftShader on the CPU), so:

- draw calls, triangles, GPU memory and download size are exact: they don't depend on the GPU;
- frame times here are software-rendering times and say nothing about your laptop. **Run `pnpm perf` for real ones** (see the end).

## Budgets

| Budget | Measured | Limit | |
|---|---|---|---|
| Draw calls inside (main scene pass, worst of the whole tour) | 223 | 250 | ✅ |
| Draw calls outside | 232 | 400 | ✅ |
| Triangles (worst frame, incl. shadow and probe refreshes) | 890,065 | 1,500,000 | ✅ |
| GPU memory (1920×1080, High) | 303 MB | 350 MB | ✅ |
| Download (production build; text gzipped as any host does) | 33.8 MB | 60 MB | ✅ |
| First view | 15.82 s in software | < 6 s | ⏳ needs a real GPU: `pnpm perf` |
| App allocations per frame (after JIT warm-up) | 1,622 B | ≈ 0 | ✅ (was 472 KB) |
| Shader re-checks per frame | 0 | 0 | ✅ (was ~40) |

**Whole frame** (scene + lake mirror + AO and post passes) is in the per-stop tables. A normal frame is the scene plus ~30–70 mirror calls and ~35 post passes. Four frames are higher: the first frame (Front Entry: the first shadow-map render), and the Loft, Bedroom 3 and Game Room stops. Those three re-captured their room's reflection probe after the test set the clock (6 cube faces, once). These are one-off refreshes, not steady cost.

## High: per tour stop

The whole guided tour at a fixed 1/30 s step (395 s): all 33 stops, half a second into each dwell, plus 91 frames every 4 s in between. (Software frame time avg 2713 ms · p95 7307 · p99 8975: CPU rendering, meaningless for real speed.)

| Stop | Room | Where | Scene calls | Mirror calls | Whole frame | Triangles |
|---|---|---|---|---|---|---|
| 1 | Front Entry | outside | 232 | 35 | 494 | 890,065 |
| 4 | Entry Foyer | inside | 222 | 35 | 284 | 629,139 |
| 8 | Great Room | inside | 160 | 35 | 222 | 557,363 |
| 9 | Great Room | inside | 152 | 31 | 210 | 541,485 |
| 13 | Primary Bedroom | inside | 113 | 32 | 172 | 499,937 |
| 16 | Primary Deck | outside | 81 | 32 | 140 | 447,373 |
| 22 | His Closet | inside | 186 | 33 | 246 | 625,163 |
| 25 | Primary Bath | inside | 109 | 20 | 156 | 544,641 |
| 28 | Her Closet | inside | 177 | 33 | 237 | 623,265 |
| 41 | Covered Deck | outside | 88 | 31 | 146 | 457,395 |
| 42 | Covered Deck | outside | 181 | 25 | 233 | 584,299 |
| 45 | Dining Room | inside | 98 | 34 | 159 | 475,809 |
| 48 | Wine Room | inside | 141 | 25 | 193 | 554,411 |
| 53 | Powder Room | inside | 139 | 33 | 199 | 553,057 |
| 58 | Kitchen | inside | 142 | 22 | 191 | 562,707 |
| 61 | Butler's Pantry | inside | 96 | 32 | 155 | 503,313 |
| 68 | Mudroom & Laundry | inside | 83 | 26 | 136 | 445,329 |
| 71 | Garage | inside | 86 | 21 | 134 | 464,651 |
| 91 | Loft | inside | 162 | 35 | 384 | 827,461 |
| 96 | Bedroom 4 Suite | inside | 108 | 21 | 156 | 495,861 |
| 99 | Bedroom 4 Bath | inside | 111 | 35 | 173 | 538,221 |
| 113 | Study | inside | 97 | 32 | 156 | 480,583 |
| 120 | Bedroom 2 | inside | 140 | 34 | 201 | 527,423 |
| 123 | Jack & Jill Bath | inside | 92 | 20 | 139 | 493,687 |
| 126 | Bedroom 3 | inside | 90 | 20 | 297 | 708,983 |
| 153 | Game & Media Room | inside | 160 | 35 | 375 | 755,203 |
| 156 | Golf Simulator | inside | 98 | 32 | 157 | 507,377 |
| 159 | Game & Media Room | inside | 111 | 35 | 173 | 487,361 |
| 163 | Lower Bath | inside | 80 | 22 | 129 | 454,959 |
| 167 | Bedroom 5 | inside | 98 | 35 | 160 | 483,361 |
| 173 | Home Gym | inside | 117 | 35 | 179 | 493,579 |
| 185 | Pool Terrace | outside | 54 | 33 | 114 | 415,701 |
| 198 | Boat Dock | outside | 35 | 32 | 94 | 395,497 |

## Medium: per tour stop

The whole guided tour at a fixed 1/30 s step (395 s): all 33 stops, half a second into each dwell, plus 91 frames every 4 s in between. (Software frame time avg 2976 ms · p95 7301 · p99 9380: CPU rendering, meaningless for real speed.)

| Stop | Room | Where | Scene calls | Mirror calls | Whole frame | Triangles |
|---|---|---|---|---|---|---|
| 1 | Front Entry | outside | 232 | 35 | 494 | 887,167 |
| 4 | Entry Foyer | inside | 222 | 35 | 284 | 627,683 |
| 8 | Great Room | inside | 160 | 35 | 222 | 556,999 |
| 9 | Great Room | inside | 152 | 31 | 210 | 541,121 |
| 13 | Primary Bedroom | inside | 113 | 32 | 172 | 499,937 |
| 16 | Primary Deck | outside | 81 | 32 | 140 | 447,373 |
| 22 | His Closet | inside | 186 | 33 | 246 | 625,163 |
| 25 | Primary Bath | inside | 109 | 20 | 156 | 544,641 |
| 28 | Her Closet | inside | 177 | 33 | 237 | 623,265 |
| 41 | Covered Deck | outside | 88 | 31 | 146 | 457,395 |
| 42 | Covered Deck | outside | 181 | 25 | 233 | 584,299 |
| 45 | Dining Room | inside | 98 | 34 | 159 | 475,809 |
| 48 | Wine Room | inside | 141 | 25 | 193 | 554,411 |
| 53 | Powder Room | inside | 139 | 33 | 199 | 553,057 |
| 58 | Kitchen | inside | 142 | 22 | 191 | 562,707 |
| 61 | Butler's Pantry | inside | 96 | 32 | 155 | 503,313 |
| 68 | Mudroom & Laundry | inside | 83 | 26 | 136 | 445,329 |
| 71 | Garage | inside | 86 | 21 | 134 | 464,651 |
| 91 | Loft | inside | 162 | 35 | 384 | 827,461 |
| 96 | Bedroom 4 Suite | inside | 108 | 21 | 156 | 495,861 |
| 99 | Bedroom 4 Bath | inside | 111 | 35 | 173 | 538,221 |
| 113 | Study | inside | 97 | 32 | 156 | 480,583 |
| 120 | Bedroom 2 | inside | 140 | 34 | 201 | 527,423 |
| 123 | Jack & Jill Bath | inside | 92 | 20 | 139 | 493,687 |
| 126 | Bedroom 3 | inside | 90 | 20 | 297 | 708,983 |
| 153 | Game & Media Room | inside | 160 | 35 | 375 | 755,203 |
| 156 | Golf Simulator | inside | 98 | 32 | 157 | 507,377 |
| 159 | Game & Media Room | inside | 111 | 35 | 173 | 487,361 |
| 163 | Lower Bath | inside | 80 | 22 | 129 | 454,959 |
| 167 | Bedroom 5 | inside | 98 | 35 | 160 | 483,361 |
| 173 | Home Gym | inside | 117 | 35 | 179 | 493,579 |
| 185 | Pool Terrace | outside | 54 | 33 | 114 | 415,701 |
| 198 | Boat Dock | outside | 35 | 32 | 94 | 395,497 |

## LODs

- Furniture: 180,740 triangles at full detail, 28,992 as far-away twins (−84%). From the water all four furniture groups show their twins; from the kitchen all three floors are at full detail (only the deck furniture, 50+ ft away, is a twin).
- Trees: from the kitchen 31 full crowns + 229 lite; from the water 8 + 252 (the trees near the house keep full crowns for the sun's shadow map).

## The real numbers: run this on your laptop

```bash
pnpm perf
```

It builds the app, opens Chrome on your GPU and plays the whole tour on High then Medium with vsync off (~15 minutes; leave the window alone). It writes `perf-report.md`: avg / p95 / p99 frame times, draw calls and triangles per stop, first view, download and GPU memory at your screen size.
