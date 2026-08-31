# Nothing was watching the platforms, and Lighthouse asked for the one change we had already ruled out

**Date:** 2026-08-31
**Area:** `scripts/cf-smoke.mjs`, `.github/workflows/platform-monitor.yml`, `src/app/layout.tsx` (not changed, deliberately)

## What

An "enhance everything" pass that started by measuring rather than guessing,
and ended up building one thing and refusing three.

**What the measurement said.** Cloudflare's Workers analytics for the last four
days: 0 errors out of ~8000 requests, p50 CPU falling 7.00 → 3.70 → 2.46 →
1.62 ms as the week's work landed, p99 flat at 17-22 ms. The 12-13% of
invocations recorded as `clientDisconnected` are our own client hedge in
`resolve.ts` aborting the server when the browser answer wins — by design, not
a leak. Nothing was broken, which is what made the real gap visible: **nothing
in this repo could have noticed if something were.**

**The gap.** Every test asserts against a captured fixture. A fixture keeps
passing forever after the site it was captured from changes its HTML — which is
exactly how the 2026-08-13 sweep found every generic platform already dead with
a green suite. The only live assertion anywhere was YouTube, in the deploy
smoke, and it was advisory in CI. A platform could break on a Tuesday and the
first signal would be a user who gives up instead of writing in.

**What was built.** Six probes in `scripts/cf-smoke.mjs`, one real public post
per platform — Vimeo, Reddit, Pinterest, Instagram, Facebook, X — resolved end
to end against production. Each asserts the platform it routed to, a title, and
at least one thing a visitor could actually save; `success: true` alone is what
scores an HTML error page as a working extractor. `SMOKE_STRICT=1` makes
third-party checks hard failures inside CI, and a daily scheduled workflow sets
it. GitHub emails on a failed scheduled run, so the alerting needed no secret,
no D1 table, no Worker code and no bundle bytes.

## Mistakes

- **Designed a Worker cron, a D1 table, a `/api/status` route and a readout
  before noticing none of it was needed.** The reasoning was "a GitHub runner
  is a datacenter IP, so the probe has to run from Worker egress" — which is
  false. The runner only reaches Cloudflare; the extraction happens from the
  Worker either way. The whole feature collapsed into six entries in a script
  that already existed and one scheduled workflow. Cost: about twenty minutes
  of architecture for a component that was deleted before it was written.
- **Guessed a probe URL and it was already dead.** `instagram.com/reel/C2DfBGSJKp1/`,
  copied from an old lesson, 422s. A second Instagram URL from the same lesson
  works. Every probe in the list is now one that was run against production
  before being committed — a guessed probe produces a red run that means
  nothing, and a monitor that cries wolf gets muted, which is worse than not
  having one.
- **Spent real time trying to harvest live TikTok, Threads and Twitch URLs.**
  TikTok's profile page answers a 1.4 KB shell, Threads' markup carries no post
  code in the HTML, Reddit's `.json` listings return an HTML block page, and
  tikwm's user-feed endpoint answers HTML too. Four platforms have no probe as
  a result. That should have been time-boxed at the second failure instead of
  the fifth.
- **Ran Lighthouse locally and nearly acted on it.** It reported performance 79
  and an LCP of 4.5 s against a recorded baseline of 96, on a different
  Lighthouse major from a laptop over a home connection — not comparable, and
  there is no real-user data to check it against (the API token has no RUM
  scope, and the Web Analytics dataset is not exposed to it). Its single
  actionable suggestion was to preconnect to `cdn.buymeacoffee.com` for 360 ms
  of LCP. That widget is *deliberately* loaded behind `load` plus
  `requestIdleCallback`; preconnecting would open a connection early to
  compete with the critical path for a script that intentionally arrives late.
  The audit was asking us to undo a documented optimisation. Nothing shipped.

## What worked

- Answering "what should we improve" with the analytics API before writing
  anything. Four days of real numbers said the CPU work had landed, errors were
  zero, and the disconnects were ours — which redirected the whole session from
  optimising a healthy path to monitoring an unwatched one.
- Verifying every probe URL against production before committing it. Six of
  seven candidates worked; the seventh would have been a permanent false alarm.
- Reusing the smoke harness instead of writing a monitor. The advisory/strict
  split it already had was the exact knob the monitor needed.

## Rules

- A fixture proves the parser. Only a live request proves the platform. Any
  claim that a platform "works" needs one resolve from today.
- Before designing infrastructure for a probe, ask where the work actually
  happens. Ours happens at the Worker; the caller's IP is irrelevant.
- Time-box URL harvesting. Two failed attempts means that platform has no
  probe today — write the gap down and move on.
- A synthetic audit from an unrepresentative machine is not evidence. If its
  advice contradicts a change made deliberately, the audit is wrong, not the
  code.
