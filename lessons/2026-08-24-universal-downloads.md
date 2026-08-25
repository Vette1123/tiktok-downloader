# Universal downloads and the MP3 fallback that doubled its own wait

## What
Made "paste any link" real rather than nominal. The generic chain gained a
native yt-dlp universal extractor (gated so Cloudflare never touches it), the
bot-wall error no longer aborts extractors queued behind it, the MP3 flow fell
back to resolving the video path when no audio-specific source answers, and the
client now auto-opens previews for verified long-tail results. Copy updated to
say what the app actually does.

## Mistakes
- **Wrote a test fixture with `og:video` in `<body>`.** `metaContent` stops at
  `</head>` (by design — head metadata lives there), so extraction found
  nothing and I nearly concluded the chain was broken. The page was fine; the
  fixture was lying. Put test HTML where real pages put things.
- **Stubbed a media response with `new Response(null)`.**
  `verifyStreamReachable` requires one non-empty body chunk; a null-body 200
  reads as an empty tunnel and fails verification. Two fixture bugs cost more
  time than the feature.
- **The audio fallback re-ran the entire Cobalt round it had just watched
  fail.** Calling `downloadVideo` fresh meant every Cobalt instance was asked
  again for the same URL — measured >150 s against stalling instances before
  the fix. Fixed by a `skipCobalt` constructor flag on the inner instance, not
  by reordering anything: worst case halved, typical case untouched, verified
  at 3 s end-to-end through workerd afterwards.
- **Trusted a green test run as "builds for Cloudflare".** Vitest never runs
  the wrangler alias/stub config or the export pipeline; only `pnpm cf:build`
  plus a local `wrangler dev` smoke of `/api/download` does. Two type errors
  surfaced only in the CF build's stricter pass.

## What worked
- Reading `mediaProxy.ts` before designing: `/api/audio` already streams MP4
  containers ("browsers extract the audio track themselves"), which turned a
  risky-sounding feature into a mapping between two existing paths.
- Gating native-binary code behind `nativeMediaAvailable()` kept the Worker
  bundle byte-equivalent in behavior — one env compare, no stub import ever
  reached.
- Verifying against the real runtime (wrangler dev + curl), which caught the
  latency doubling that 518 passing tests called fine.

## Rules
- Test fixtures must mirror where real pages put their markup.
- Never repeat an upstream round-trip inside its own fallback; pass down what
  the first attempt already learned (`skipCobalt`).
- "Tests pass" is not "deploys clean": run `pnpm cf:build` and a wrangler-dev
  smoke whenever `src/lib/**` API surface changes.
