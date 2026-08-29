# The 504s that were never real, and the wall that ate the shortcode

## What

A follow-up pass over the errors the edge was logging, after the CPU/SEO/marketing
session ([2026-08-29-cpu-startup-seo-titles-marketing.md](2026-08-29-cpu-startup-seo-titles-marketing.md))
listed two of them as open findings.

Every error in a 23-hour window, split by `requestSource` — the dimension that
says who made the request:

| Status | Path | Source | What it is |
| --- | --- | --- | --- |
| 504 ×1369 | `/__resolve-cache` | `edgeWorkerCacheAPI` | our own `cache.match` misses |
| 504 ×~600 | every page, icon, `/api/image` | `earlyHintsCache` | the edge's own early-hints lookups |
| 499 ×363 | `/api/download` | eyeball | clients that went away |
| 422 ×177 | `/api/download` | eyeball | links that yielded nothing |
| 404 ×27 | `/.well-known/assetlinks.json` | eyeball | Android's `GoogleAssociationService` |
| 403 ×~40 | mixed | eyeball / firewall | upstream CDN denials and scanner blocks |

**Not one 504 came from an eyeball.** They are Cloudflare's internal cache
lookups, logged as pseudo-requests with `originResponseStatus: 0` and no user
agent. The `/api/image` 504s reported as a defect last session were the edge
asking its own early-hints cache about a path, nothing more.

Three things were actually fixed:

- **The hedge raced a promise that could reject.** `resolve()` asks tikwm and
  the server in parallel for a TikTok link and takes the first answer — but it
  raced the raw server promise, so a server *network failure* settled the race
  and was thrown at the caller while a perfectly good browser answer was still
  in flight. It also never passed the caller's `AbortSignal` to the losing
  request, so a cancelled paste kept a connection open until the Worker
  finished writing a body nobody would read.
- **The Meta login wall ate the shortcode.** A logged-out fetch of an
  `instagram.com/share/…` link — the shape the mobile app's Copy link produces
  — ends at `/accounts/login/?next=%2Freel%2FABC%2F`. The redirect follower
  returned the wall as the "canonical" URL, so `parseInstagramShortcode` found
  nothing and both the embed extractor and the media API were skipped, leaving
  Cobalt as the only path. `unwrapLoginWall` reads the post back out of `next`
  (same-origin only — that value gets fetched).
- **`/.well-known/assetlinks.json` now exists**, holding `[]`. Android asks for
  it once per installed PWA; `[]` claims exactly what the 404 claimed — this
  site vouches for no app — while being an answer rather than an error.

## Mistakes

- **Reported two findings without asking who made the request.** "`/api/image`
  504s, 115/day" and "`/api/download` 499s, 342/day" went into last session's
  hand-off as defects. The first is not a defect at all, and one extra
  dimension — `requestSource` — would have said so before it was written down.
  A status code without its source is not evidence.
- **`clientRequestSource` is not the field.** Two GraphQL round-trips were
  spent on a guessed name and on `edgeTimeToFirstByteMs`, which this plan does
  not carry. The dataset's own dimension list
  (`__type(name: "ZoneHttpRequestsAdaptiveGroupsDimensions")`) answers both in
  one query — introspect before guessing.
- **Backticks in a `node -e` inside double quotes.** A comment reading "its
  `next` parameter" was written to disk as "its  parameter", because bash ran
  `next` as a command. The same class of damage as last session's heredoc
  losses, in a new disguise: nothing inside a double-quoted shell string is
  safe from the shell.
- **Nearly built attribution for the 422s.** 177 a day against 847 successes
  looks like a 17% failure rate worth instrumenting. The edge log already
  attributes it: Worker subrequests are logged under their own upstream host,
  so `instagram.com 200:865 302:59 429:59` is the answer, with no new code,
  no analytics dependency and no synthetic probe set.

## What worked

- **Grouping Worker subrequests by upstream host and status.** One query gives
  a live per-platform health board from real traffic — Instagram 87% clean,
  YouTube 96%, TikTok 93%, Snapchat 18% — which is what a synthetic probe set
  tries to approximate and cannot keep current.
- **Making the new tests fail first.** Both `resolve.test.ts` additions were
  run against the stashed fix and failed for the right reasons before being
  kept.
- **Asserting the file, not the intention.** `public/.well-known/` starts with
  a dot, and a build step that skipped dot-directories would have dropped
  `assetlinks.json` silently, so it is in `cf-postbuild.mjs`'s required list.

## Rules

- Read `requestSource` before calling any edge status code a defect.
  `edgeWorkerCacheAPI` and `earlyHintsCache` rows are Cloudflare talking to
  itself; only `eyeball` rows are people.
- A 504 on this zone is almost never real. There is no origin behind the
  Worker, so a cache lookup that finds nothing is logged as a gateway timeout.
- `Promise.race` over a rejectable promise makes a failure win. Race for the
  first *answer* — map failure to null and let the other side finish.
- Every fetch a component starts on behalf of a caller takes the caller's
  `AbortSignal`, including the one it started as a hedge.
- Upstream health lives in the edge log, per host. Look there before writing a
  probe.
