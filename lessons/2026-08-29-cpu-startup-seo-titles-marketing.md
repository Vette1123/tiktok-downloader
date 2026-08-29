# CPU that was never in a handler, titles that were never seen, and copy that was a liability

## What

Three unrelated asks in one session: the Worker's CPU time had climbed, SEO
needed a pass, and the app needed to be submitted to places that market it.

- **CPU.** Production `cpuTimeP50` was 5.76 ms. Isolated single requests
  measured 6.17–7.97 ms; a six-request burst into a warm isolate measured
  0.28–0.60 ms. So handler work is ~0.5 ms and the rest is isolate startup —
  at ~1.2 req/min nearly every request creates one, which makes startup the
  per-request cost. Locally measured startup was 5.76 ms, i.e. the whole P50.
  The largest single component was an import cycle: `requireDb`/`WorkerEnv`
  lived in `src/lib/apiRoutes.ts`, which `auth/routes.ts` and the four billing
  handlers imported back. esbuild answers a cycle by wrapping those modules in
  `__esm()` init closures instead of flattening them, and V8 pre-parses a
  closure body at startup then fully compiles it on first call — the same
  ~28 KiB paid for twice. Moving the two declarations into a leaf module
  (`src/lib/workerEnv.ts`) took startup 5.29 ms → 3.48 ms (−34%) and the
  bundle 106.0 → 104.9 KiB. `src/lib/importCycles.test.ts` now fails if the
  cycle comes back.
- **SEO.** On-page was already good; the one real defect was self-inflicted.
  Every page title had been hand-fitted to the ~60 characters a result shows,
  and a global `%s — Social Media Downloader` template then pushed all
  thirteen to 78–106 characters, so the measured-to-fit part was the part
  Google cut. Template dropped (the site name comes from the WebSite /
  Organization JSON-LD anyway); titles now 31–58 chars, descriptions 106–159.
  Separately: Googlebot hit the zone 5 times in 23 h against ~800 page views a
  day, so crawl and authority — not markup — are the ceiling. `pnpm cf:health`
  confirmed no crawler is edge-blocked.
- **Marketing.** `docs/marketing/launch-kit.md` (copy at every length a
  directory asks for, plus a tiered submission list). The GitHub repo
  description and topics were rewritten: they still carried the "no watermark"
  framing that got the Creem payout account rejected — see
  [2026-08-10-creem-payout-rejection.md](2026-08-10-creem-payout-rejection.md).
  AlternativeTo listing submitted with six alternatives; both remain in that
  site's review queue.

## Mistakes

- **Measured with a tool that reports zero.** Started with `wrangler tail`,
  which prints `"cpuTime": 0` on every event here. Several minutes went into
  reading those numbers before noticing they were all the same number. The
  usable source is the Cloudflare GraphQL Analytics API
  (`workersInvocationsAdaptive`, `cpuTimeP50`/`P99`, `datetimeMinute`).
- **Every gate was green with the cycle in place.** Types, lint, tests and the
  200 KiB startup byte budget all passed while a third of isolate startup was
  being spent on it. Nothing in the toolchain models this, which is why the
  fix had to leave a test behind rather than a comment.
- **The guard that guarded nothing.** The first version of
  `importCycles.test.ts` matched imports with a line-anchored regex, so it
  walked straight past every multi-line import list — which is most of them
  here. It reported a clean graph while the exact cycle it exists to catch was
  still in the tree. Only re-introducing the cycle on purpose exposed it. A
  new guard is not verified until it has been made to fail.
- **Two experiments built and thrown away.** A stub for the yt-dlp module and
  a lazy-routes split were both implemented and measured; both bought nothing
  and were reverted. Cheap, but they came before the profiling that would have
  ruled them out.
- **Repeated shell-quoting damage.** Patch scripts written through unquoted
  heredocs kept losing backslashes and backticks — one produced an
  `Unterminated string` in a test file. Quoted heredocs (`<<'EOF'`) and
  `String.raw` from the start; and this repo's files are CRLF, so a
  `.replace()` against an LF-normalised needle silently matches nothing.
- **Guessed a URL on a site I was driving.** AlternativeTo's submission form
  is `/manage-item/`, not `/manage-software/`; the guess 404'd. The page's own
  menu had the link.

## What worked

- **Isolated request vs burst.** Six requests fired back-to-back into one warm
  isolate, compared against single requests a minute apart, separates startup
  from handler work with no instrumentation at all — and it agreed with the
  local `SourceTextModule` harness to two decimal places (5.76 vs 5.755 ms).
- **Attributing bundle bytes per module** by decoding the sourcemap's VLQ
  mappings, which is what pointed at the wrapped modules rather than at
  feature code.
- **Reading the site's own warnings before clicking.** AlternativeTo flags
  entries with malware or bundleware notices; two of the five alternatives
  originally planned were dropped on that basis.

## Rules

- A Worker cannot time itself and `wrangler tail` will not do it for you —
  measure CPU with the GraphQL quantiles, and separate cold from warm with a
  burst before touching any code.
- On a low-traffic Worker, startup **is** per-request CPU. Bundle bytes and
  module shape are the performance surface; handler micro-optimisation is not.
- Keep `src/lib/apiRoutes.ts` out of every cycle. Shared helpers that handlers
  need go in a leaf module. `importCycles.test.ts` enforces it.
- A test written to catch a specific defect must be run against that defect
  before it is trusted.
- Title text is written to the length a result shows; a `title.template` then
  changes that length globally and invisibly. Adding one is a change to all
  titles, not to none.
- Marketing copy is a compliance surface. The words that describe this app to
  a payment reviewer are the same words a directory listing carries.
