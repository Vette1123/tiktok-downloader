# Subrequests are the CPU, and the smoke test was pointed at the wrong host

**Date:** 2026-08-31
**Area:** `src/lib/downloader.ts`, `scripts/cf-smoke.mjs`, `.github/workflows/deploy-cloudflare.yml`

## What

A "make CPU better" pass that started from a wrong belief and only got anywhere
after measuring.

**The measurement.** `wrangler tail --format json` reports `cpuTime` per
request. Driving one request at a time against production, warm isolate:

| request | cpu |
| --- | --- |
| `/api/health` | 0 ms |
| edge-cache hit | 0 ms |
| YouTube resolve | 1 ms |
| TikTok resolve that failed | 6-7 ms |
| generic page that failed | 9 ms |

Then the same failing generic resolve, replayed locally against the built
bundle with stubbed fetches: **0.9 ms**. Our parsing is not the cost. The four
outbound HTTPS calls are — about 1.5-2 ms each, which is the same per-call
figure the axios removal measured back in July.

**The fix.** Three of those four calls went to the public cobalt instances,
which answer 400 for any host outside cobalt's service list, and `withRetry`
wraps each attempt in two more. The public instances are now skipped for a host
they do not serve, checked against a bare host-suffix list before the request
rather than after it. A configured `COBALT_API_URL` or a discovered self-hosted
resolver is ours and generic, so those are still tried for everything. Second,
an instance that fails *transiently* is left out of the rotation for five
minutes per isolate — production was logging `rue-cobalt.xenon.zone` 530 on
every resolve in the window, three subrequests each time to relearn it. A 400
earns no cooldown: that is about the URL, not the instance.

Generic failing resolve, measured after the deploy: **1 subrequest instead of
4, 9 ms → 1 ms of CPU, 2.5 s → 0.18 s of wall.** The supported-platform chain
is untouched at eight subrequests — each one is a real chance of a result, and
trimming those would trade a download for a millisecond.

**The second fix, same shape.** `fetchThroughRelay` in `pageScrape.ts` tried
three free relays — the Jina reader, the Internet Archive, allorigins — before
the configured unlocker. Every one of them refuses a Cloudflare Worker's
egress; that was measured on 3 August and written into `nativeMedia.ts`, and
the relay chain never got the note. Three guaranteed-failing subrequests on
every bot-walled page. `freeRelaysUsable()` now returns false on
`DEPLOY_TARGET=cloudflare`, so the Worker either uses a configured unlocker or
returns null immediately, and a self-hosted Node deployment keeps all four.
Worst-case chain counts after both fixes: generic 4 → 1, threads 5 → 2,
snapchat 7 → 4, reddit/pinterest/twitch 8 → 5.

**The smoke test.** `node scripts/cf-smoke.mjs` with no argument failed 14
checks against a healthy deployment. Its default target was the workers.dev
hostname, which stopped being a second front door when the Worker began
301-ing everything but the billing webhook to the canonical origin. `fetch`
with `redirect: 'follow'` turns a redirected POST into a GET, so every POST
check came back 405. It targets the canonical origin now and runs as its own
job after every deploy.

## Mistakes

- **Said the CPU lever was spent, twice, on four data points.** The 29 August
  conclusion — "isolate creation, not our code" — came from four single-request
  samples of `/api/health`, a route that makes no subrequests at all. It was
  true about that route and false about the one that matters. A route that
  does no I/O cannot tell you what I/O costs.
- **Measured the failing path locally and nearly concluded it was cheap.** 0.9
  ms in Node with stub fetches was right and irrelevant: the stubs were exactly
  the thing being measured. The local number is only useful *against* the
  production one — the gap is the answer.
- **Shipped the smoke job as a hard gate and failed the next deploy on
  YouTube's mood.** The first CI run failed on `metadata.duration is 0`, the
  embed fallback. Innertube answers a datacenter address differently, and
  differently again on a repeat ask seconds later; CI pass 1 got a real
  extraction and pass 2 did not. The two checks whose verdict belongs to a
  third party are advisory in CI now and hard failures everywhere else.
- **Broke a deploy with a type error in a test file.** The relay-gate push
  failed on `TS2493: Tuple type '[]' of length '0' has no element at index
  '0'` — an untyped `vi.fn` mock parameter in `pageScrape.test.ts`. `pnpm test`
  had passed: **vitest does not type-check, and `next build` type-checks test
  files.** Ten minutes of red CI for something `tsc --noEmit` reports in
  fifteen seconds. There is a `pnpm verify` now (typecheck, lint, test) so
  there is one command to run instead of three to remember.
- **Three patch scripts mangled their own escapes** writing template literals
  into `.mjs` files through a heredoc, once silently — a `\n` became a real
  newline inside a template and still worked, which is how it survived review.
  Line-splice edits with `String.raw`, or a plain file, beat clever quoting.

## What worked

- Decomposing by request shape rather than profiling: health / cached hit /
  one-provider success / full-chain failure, one request each, read straight
  off `cpuTime`. Five requests answered what a profiler could not.
- `wrangler secret list` before theorising about the resolver-discovery call:
  production has no `UPSTASH_*` and no `COBALT_API_URL`, so discovery is free
  and a generic URL now reaches no cobalt instance at all.
- Counting subrequests with a local harness that logs every `fetch` — the
  8-call TikTok chain and the 1-call generic path are both visible in a second,
  with no deploy.

## Rules

- For Worker CPU, **count subrequests, not lines of code.** Every outbound
  HTTPS call is ~2 ms of billed CPU; JS that touches no network is nearly free.
- Never call a lever spent from a route that does not exercise it.
- A check whose verdict belongs to a third party does not gate a deploy. Assert
  it where someone can act on it.
- After changing the fallback chain, re-measure in production. Local numbers
  with stubbed I/O measure the stubs.
- A fallback that is known to fail on this host is not a fallback, it is a
  2 ms tax. When a measurement retires an upstream, grep for every other caller
  of it the same day.
- Run `pnpm verify` before pushing. Tests passing is not types passing.
