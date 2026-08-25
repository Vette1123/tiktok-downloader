# Supporter extras night: playlists, subtitles, and the universal page

## What
Shipped `/video-downloader` (12th landing page), YouTube playlist → batch
import (`/api/playlist`), YouTube subtitle downloads (`/api/subtitles`,
SRT/VTT conversion from json3), thumbnail save, history export/import, batch
draft persistence, and documented all of it as supporter extras on /pro.
Every server path Pro-gated off the same `p` claim; every page static;
verified end-to-end against wrangler dev.

## Mistakes
- **Test fixture lied twice before the code was even wrong** (again): og-tags
  in `<body>` and null-body Responses. Same two failure modes as yesterday's
  lesson, re-proving that fixtures fail before implementations do.
- **Regex-patched a test file into calling `withSecret()` outside `it()`** —
  collection-time stubs get undone by afterEach before any test runs. Rewrite
  the file instead of scripting edits.
- **`vi.fn(async () => …)` types its args as an empty tuple**, so
  `mock.calls[0][0]` passes vitest but fails the build's stricter tsc. Type
  mock fns with `(..._args: unknown[])` up front.
- **Imported `saveBlob` into DownloaderApp, which has had a private
  `saveBlob` since forever.** Vitest and eslint both stayed green; only the
  Turbopack build caught the duplicate binding. Consolidation means deleting
  the old copy, not adding a second import.
- **setState-in-effect is banned by this repo's ESLint** (`react-hooks/set-state-in-effect`).
  One-shot external reads belong in lazy `useState` initializers when the
  component provably mounts post-hydration — which the Pro gate guarantees here.
- **Windows keeps orphaned wrangler/workerd processes holding `out/`** between
  bash tool calls (EBUSY). Kill by CommandLine match across node/cmd/workerd,
  not just by name.

## What worked
- Reading `PRO_BENEFITS` consumers first: one array edit propagated to /pro,
  AccountPanel and the nudge with zero UI work.
- Keeping every new endpoint POST-only with the token in a header, and saving
  blobs client-side — sidesteps signed-URL leakage entirely.
- Pure modules (`playlist.ts`, `subtitles.ts`) with IO-free tests meant the
  Worker handlers were thin enough to trust after stub-level testing plus one
  live 403 check.

## Rules
- Fixture markup goes where real pages put their markup; Response bodies need
  bytes when anything reads chunks.
- New global helper beats a third local copy — and requires deleting the
  older copies, or the build will say so.
- This repo's lint enforces React 19 effect discipline; design state loading
  for it up front rather than fighting it later.

## Round two (same session): retry, health, drafts
Batch gained a merge-mode update path (itemsRef mirror + `publish(next,
merge)`) so a retry of failed rows leaves done rows — and their already-saved
files — untouched; cancelled rows stay excluded because a retry button must
not override an explicit stop. `/api/health` landed as pure parity with the
resolver's probe: no D1, no extractors, microseconds. The "Any public link"
hero chip became the internal link to /video-downloader — every page showing
the hero now points at the new landing from one line of copy that was already
there.

## Round three: progress store, i18n, and the codemod that shot the file
Shipped MB/rate readout (module progress store beside the reducer, throttled,
cleared un-throttled), SRT/VTT toggle, batch lane knob, manifest shortcut, and
the i18n pass (es/pt/id/ar, hydration-safe locale store, RTL mirroring).

**The codemod lesson, written in damage:** a Node script mixing literal
split/join with regex-replacement semantics inserted `$1` group tokens as TEXT
into JSX across three buttons, and two "successful" PowerShell -replace passes
had earlier replaced nothing at all — one because the file used U+2026 where
the needle had three dots, one because the import line I anchored on had been
reordered by an earlier edit. Both failures printed success. What caught them:
tsc during cf:build, and grep-auditing every insertion count against its
expected count.

Rules added to the personal rulebook:
- Never string-surgery source files from shell one-liners. Edit tool or a
  version-controlled codemod with per-site assertions — and audit every count.
- When a replacement reports 0 hits, STOP and diff the actual bytes; do not
  assume, and do not "fix" it by loosening the pattern.
- Unicode lookalikes (… vs ..., emoji) make eyeballed literals liars. Read the
  exact codepoints before matching.

Also learned: PornHub/Eporner formats carry vcodec/acodec = null on muxed mp4s
— "unknown" must not be treated as "audio-only" (`carriesBothTracks`), and
Eporner needs `--impersonate chrome` (TLS wall), which ytdlpProbe now tries
first with a plain retry fallback.

## Round four: imports beyond YouTube, taste memory
/api/playlist became a multi-source expander (YouTube playlist, Reddit subreddit/user via public .json with an old.reddit fallback, Pinterest board RSS, Vimeo channel/user RSS). One response shape keeps BatchPanel source-blind. Subtitle language joined prefs (optional field, invalid dropped not rejected) — picker floats it first and records on download; syncs through the existing account flow. Per-platform quality memory: re-pick on a result remembers for that platform only, resolve-time override beats global, hint+reset under the toggle.

Mistakes worth keeping: three Node literal-replacements silently no-opped on unicode lookalikes (em-dash vs hyphen) and one reordered anchor — caught only because I greped each file after instead of trusting "script printed ok". A Python-brained `"""` literal broke a codemod at parse time (which, accidentally, made it atomic). And a memo anchored to the wrong component (zipCandidateCount lives in BatchPanel).

Rule: after ANY scripted source edit, grep the intended insertion AND its neighbours. Counting "ok" lines is not verification.

## Round five: /pro rebuilt as the showcase
PRO_BENEFITS became {title, body} objects (7 cards: queue, collection import, lanes, subtitles+memory, priority, ZIP, ad-free) rendered as bordered cards on /pro, title+body rows on SupportPanel/homepage, compact title-only-with-tooltip in AccountPanel. /pro gained its own OG/Twitter image (hand-rolled ImageResponse — the platform renderer is platform-shaped). Batch runs now end with a scoreboard note (saved · failed · wall time); results row gained Share and Copy-link.

Verified against the live worker: all seven titles present in served HTML, OG image 200 image/png.

## Round six: honest SEO, proof of life
Import card + FAQ landed on exactly the four landings whose collections the importer reads (YouTube/Reddit/Pinterest/Vimeo) — the other eight stay silent rather than promise something the endpoint refuses. What's-New section on the homepage: four dated config lines, pruned-not-accumulated. Failure banner gained a Try-again button (localized, all five languages). QR send-to-phone was deliberately rejected twice over: a public QR API leaks every resolved URL to a third party, and a handwritten encoder is unverifiable overnight.

Codemod scorecard this round: emoji survived intact (PowerShell console renders U+1F4DA as ?? — codepoints don't lie, consoles do), one FAQ wrapper got duplicated then de-duplicated after a bad anchor, and i18n's id dictionary said 'Bahasa' not 'Bahasa Indonesia' — three more reasons anchors come from reading the file, never from memory.
