# The cache outlived the link

**Date:** 2026-09-07
**Scope:** `urlExpiry.ts`, `cacheWorthy.ts`, `responseCache.ts`, `edgeCache.ts`, `apiRoutes.ts`, `scripts/cf-smoke.mjs`

## What

Adding a TikTok probe to the monitor turned up two cache bugs, neither of which
any test could have found, because both are about time and both produce
`success: true`.

**1. A Cobalt tunnel lives 92 seconds. The isolate cache held it for 180.**

Measured against production: a fresh resolve returns a tunnel stamped
`exp=<now + 92s>`. `responseCache` stored it for three minutes and the edge
cache for two. So for the last 88 seconds of a memory entry's life — and the
last 28 of an edge one — every visitor served that entry got a Download button
that answered `404`. On Cobalt-backed platforms, which is most of the site, that
is roughly half the cache window handing out dead links.

Both TTLs were chosen deliberately, with comments explaining that the URLs are
ephemeral so the TTL must be short. The comments were right about the hazard and
wrong about the number, and nothing measured it.

`cacheableForMs` now reads the expiry the URLs themselves carry (`exp`,
`expire`, `expires`, `x-expires`, seconds or milliseconds) and shortens the
entry to match, minus a 20-second margin for the visitor to actually press
Download. When less than that is left it refuses to store the entry at all: a
miss re-resolves and works, a hit on a dead payload does not.

**2. A rate-limited reel was cached and served to everyone.**

Eight consecutive resolves of the monitor's Instagram reel: the first was a
`MISS` that came back with the post's cover image and no video, and the next
seven were `HIT`s of that same answer. One refused extraction became minutes of
everybody getting a JPEG for a video link — the complaint from
[the tunnel that served a JPEG](2026-09-06-the-tunnel-that-served-a-jpeg.md),
arriving by a completely different road.

`worthCaching` refuses to store a video-shaped link that produced neither a
stream, nor audio, nor an embed. The distinction it draws is between an answer
that is *bad* and one that is merely *limited*: YouTube's embed-only result is
stable and stays cacheable, because Google refuses this host every time and
re-running the most expensive resolve on the site would buy nothing.

**Also:** TikTok and Twitch finally have monitor probes, from each platform's own
embed documentation.

## Mistakes

**The regex I wrote to find expiries could not match half of them.** It ended
with `(?:&|$)`, which is true for a Cobalt tunnel (`sig` follows `exp`) and
false for every provider that puts the expiry last — inside a JSON payload such
a URL is followed by a quote. The test that caught it was written to check
something else entirely; the assertion failed for the right reason by accident.
A negative lookahead for a digit is what it should have been from the start.

**I nearly shipped `expectVideo` on the TikTok probe as flaky.** Pass 1 read
real MP4 bytes, pass 2 got `404`. The first instinct was that TikTok CDN URLs
are single-use and the probe should not read bytes. That would have weakened the
one check that catches the JPEG bug, to work around a defect in our own cache.
Fetching the same URL three times in a row — all `404`, all `X-Cache: HIT` —
pointed at the cache instead.

**Two platforms went unprobed for months for a reason that took one page fetch
to solve.** The list's own rule forbids guessing a URL, and TikTok and Twitch
have no obvious permanent post, so they were skipped. Both publish an example
video in their embed documentation, which the platform itself has an interest in
keeping alive. The rule was never the obstacle; not looking was.

## What worked

- **Reading the expiry off the URL rather than picking a better constant.** Any
  number I chose would have been another guess, wrong the next time a provider
  changed its signing window. The URLs already carry the answer.
- **Measuring the tunnel lifetime directly** — resolve with a cache-busting
  query, read `exp`, subtract `Date.now()`. Ninety-two seconds is a fact; "a few
  minutes" was the comment that let this ship.
- **Adding a probe and letting it fail.** Both bugs were found by trying to
  extend the monitor, not by looking for them.

## Rules

- **A TTL guarding ephemeral URLs must be derived, not chosen.** If the thing
  being cached states its own expiry, that is the TTL; a constant is a guess
  with a comment attached.
- **Not every `success: true` is worth keeping.** A cache multiplies whatever it
  is given, including one unlucky answer. Before storing, ask whether this
  result is as good as the link can produce, and whether it will still be good
  in a minute.
- **When a monitor probe is flaky, suspect our own code before weakening the
  probe.** The check was right both times; the second pass really did get a
  broken URL.
- **A platform's own documentation is the best source of a durable probe URL.**
  Written into the probe list's rules.
