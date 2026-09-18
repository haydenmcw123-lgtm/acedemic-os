# SwingLab

Slow-motion golf swing analysis that runs entirely in the browser. Upload a
swing, get keyframes, biomechanics measured off body pose, a comparison against
published tour-average ranges, a short verdict and two drills.

The video never leaves the device. The only thing that ever touches a server is
the text of the measurements, sent to `/api/critique` so the Claude API key can
stay server-side.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind v4, tokens in `app/globals.css` |
| Pose | MediaPipe Pose (BlazePose Heavy), WASM, client-side |
| Video | ffmpeg.wasm — frame-rate probe and frame extraction |
| Storage | IndexedDB (`swinglab`), keyed by a client-generated session id |
| Server | One route, `/api/critique`, a proxy to the Claude API |

## Running it

```bash
npm install
npm run dev
```

## Design rules

The look is broadcast golf telemetry, not a fitness app. The rules are narrow
on purpose:

- **Deep fairway green (`#0B2E1F`) is the dark theme.** There is no light mode.
- **Yellow (`#E8C547`) means "your value."** Measured numbers wear it. Interface
  chrome — selected chips, buttons, rules — never does.
- **Red (`#C1444A`) means out of range.** It is never decorative.
- Muted gray-green (`#6E8577`) is the tour-range band on charts.
- Barlow Condensed for headings and numbers, Inter for body. Numbers are
  tabular, large and tight.
- Hairline white rules, generous space, square corners. No shadows, no
  gradients, nothing rounded.
- Overlays on video are telestrator, not filter: thin white lines, small yellow
  joint dots, semi-transparent.

## Phase 1 — upload and validation (done)

One screen: camera angle, club, footage. Tapping the target opens the **How to
film this** card — angle-specific, with a plan view of where the camera goes —
and the file picker opens from there.

A picked clip is read in place and measured:

| Check | Fails when | Warns when |
|---|---|---|
| Frame rate | under 60fps and not acknowledged as pre-slowed | 60–89fps |
| Duration | under 0.8s or over 25s | over 14s |
| Frame size | short side under 360px | short side under 540px |
| File size | over 600MB | — |

Accepting a clip writes a `SwingSession` to IndexedDB under a new id, with the
clip blob alongside it when quota allows, and later phases attach pose,
keyframes and the critique to that same id.

### Two decisions worth knowing about

**Frame rate is read twice.** `lib/ffmpeg.ts` reads it out of the container
header, which is the honest answer. If the ffmpeg core cannot be fetched, the
sampled estimate from `lib/probe.ts` stands in — it counts *decoded* frames per
unit of media time rather than presented frames, so a 120fps clip on a 60Hz
screen is not misread as 60. Sampled values are labelled as such and never
fail a clip on their own. The core URL is overridable with
`NEXT_PUBLIC_FFMPEG_CORE_URL` if you would rather self-host it than pull it
from a CDN.

**A 30fps file is not automatically rejected.** Photos exports slo-mo already
slowed down, at the playback rate — the file says 30fps but every bit of the
captured detail is there. Nothing in the file distinguishes that from footage
genuinely shot at 30. So the app asks instead of guessing, and records the
answer as `renderedSlowMotion` so later phases report tempo as a ratio rather
than in real seconds.

## Still to come

Phases 2 onward — keyframe detection, pose, measurement against tour ranges,
the critique route — are not built yet.
