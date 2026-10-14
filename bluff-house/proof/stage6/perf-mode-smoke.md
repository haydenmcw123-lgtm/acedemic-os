# Perf report — smoke run (software rendering, 20× tour speed: the timings mean nothing, the pipeline is what is tested)

ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)

480×270 at 1× · Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36

| | measured | budget |
|---|---|---|
| First view | 14.4 s | < 6 s |
| Download | 22.5 MB | ≤ 60 MB |
| GPU memory | 108 MB | ≤ 350 MB |

## low

Frame time over the whole tour (415 frames, 188 s): **avg 392.3 ms · p95 600 ms · p99 700 ms** · worst 900 ms

Scene draw calls: inside 403 ❌ (budget 250) · outside 287 ✅ (whole frame incl. mirror + post: 423 / 307) · max triangles 699316 ✅

| # | stop | where | scene calls | frame calls | triangles | avg ms |
|---|---|---|---|---|---|---|
| 1 | Front Entry | outside | 232 | 252 | 432,772 | 3436.5 |
| 4 | Entry Foyer | inside | 223 | 243 | 428,730 | 494.4 |
| 8 | Great Room | inside | 160 | 180 | 358,078 | 562.5 |
| 9 | Great Room | inside | 152 | 172 | 341,824 | 388.9 |
| 13 | Primary Bedroom | inside | 113 | 133 | 299,584 | 305.5 |
| 16 | Primary Deck | outside | 81 | 101 | 247,524 | 316.6 |
| 22 | His Closet | inside | 187 | 207 | 425,104 | 241.7 |
| 25 | Primary Bath | inside | 109 | 129 | 350,794 | 688.9 |
| 28 | Her Closet | inside | 177 | 197 | 422,612 | 383.3 |
| 41 | Covered Deck | outside | 88 | 108 | 259,022 | 361.1 |
| 42 | Covered Deck | outside | 182 | 202 | 390,688 | 208.3 |
| 45 | Dining Room | inside | 98 | 118 | 275,682 | 561.1 |
| 48 | Wine Room | inside | 141 | 161 | 360,940 | 308.3 |
| 53 | Powder Room | inside | 139 | 159 | 355,734 | 475 |
| 58 | Kitchen | inside | 142 | 162 | 369,374 | 444.4 |
| 61 | Butler's Pantry | inside | 96 | 116 | 302,764 | 508.4 |
| 68 | Mudroom & Laundry | inside | 84 | 104 | 250,950 | 500 |
| 71 | Garage | inside | 86 | 106 | 270,360 | 333.3 |
| 91 | Game & Media Room | inside | 120 | 140 | 302,790 | 488.9 |
| 96 | The Grounds | outside | 110 | 130 | 309,744 | 377.8 |
| 99 | The Grounds | outside | 89 | 109 | 261,016 | 266.7 |
| 113 | Bedroom 5 | inside | 95 | 115 | 281,590 | 422.2 |
| 120 | The Grounds | outside | 133 | 153 | 315,640 | 408.3 |
| 123 | The Grounds | outside | 95 | 115 | 310,834 | 358.3 |
| 126 | The Grounds | outside | 287 | 307 | 553,166 | 333.4 |
| 153 | Game & Media Room | inside | 313 | 333 | 553,720 | 350 |
| 156 | Golf Simulator | inside | 98 | 118 | 306,590 | 444.4 |
| 159 | Game & Media Room | inside | 111 | 131 | 287,992 | 383.3 |
| 163 | Lower Bath | inside | 80 | 100 | 261,214 | 399.9 |
| 167 | Bedroom 5 | inside | 98 | 118 | 283,376 | 325.1 |
| 173 | Home Gym | inside | 117 | 137 | 293,986 | 422.2 |
| 185 | Pool Terrace | outside | 54 | 74 | 217,120 | 283.3 |
| 198 | Boat Dock | outside | 35 | 55 | 198,546 | 236.1 |

