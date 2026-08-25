# Lessons

One file per finished unit of work — a feature, a fix, a release, an audit, a
refactor. Named `YYYY-MM-DD-slug.md`, committed *with* the work rather than
after it.

Format:

```markdown
# <title>

## What
One paragraph: what the unit of work actually was.

## Mistakes
The wrong turns. What was assumed and turned out false, what was verified the
wrong way, what nearly shipped, what was built and then deleted. This section is
the point of the file — git already records what was built. If there genuinely
was no wrong turn, say so in one line and keep the file short.

## What worked
The approaches worth repeating.

## Rules
Short imperatives for next time.
```

Read the lessons touching an area before starting work in it; the table below is
the index for exactly that.

| Date | Lesson | The one thing |
| --- | --- | --- |
| 2026-08-10 | [Creem payout-account rejection](2026-08-10-creem-payout-rejection.md) | A reviewer reads the marketing, not the code — "no watermark" describes a circumvention tool even when the code only fetches public files. |
| 2026-08-10 | [Withdrawing the subscription](2026-08-10-withdrawing-the-subscription.md) | When the question is "who gets this feature", change the input to the decision, never the decision points — and a capability that must never be sold needs its own name, not a flag inside one that is. |
| 2026-08-13 | [Every generic platform was dead, and one was pretending not to be](2026-08-13-platform-sweep.md) | The shared public resolver is blocked by the origins it resolves, so each platform now reads its own embed surface first — and a sweep that only checks `success: true` will score an HTML error page as a working video. |
| 2026-08-13 | [The Instagram session was fine; every path that used it was dead](2026-08-13-instagram-media-api.md) | Instagram's GraphQL `doc_id` now answers "execution error" for everyone, so the credentialed path had to move to `/api/v1/media/<id>/info/` — prove a credential with one endpoint only it can answer before blaming it. |
| 2026-08-14 | [The server was never the slow half](2026-08-14-client-hedge-and-facebook-shapes.md) | A TikTok paste calls tikwm from the browser before it ever calls us, so a server-side measurement missed 6s of the wait — hedge a third party on the critical path, never await it on a long timeout. |
| 2026-08-14 | [The slow platform was not slow, and the broken one was never reached](2026-08-14-tiktok-latency-facebook-share.md) | A latency report is answered with a stopwatch, not a diff — TikTok's first upstream had started queueing (race them, don't reorder), and Facebook's own share links only redirect for a crawler. |
| 2026-08-15 | [The membership that could not be delivered](2026-08-15-buymeacoffee-webhook.md) | Support arrives before the account does, so a webhook that writes `users.grants WHERE email = ?` matches zero rows and calls it success — record support against the address, apply it at sign-in. |
| 2026-08-15 | [Two bad samples and I declared Instagram dead](2026-08-15-instagram-logged-out-wall.md) | Instagram answers deleted, restricted and never-existed with the same "may be broken" shell, so a platform-is-dead conclusion needs a post proven public by a third party — and the credentialed path is one real account, which hundreds of probe requests got locked with `checkpoint_required`. |
| 2026-08-10 | [Footer apps menu, batch textarea](2026-08-10-footer-apps-menu.md) | `.surface` is unlayered CSS that owns `position` — anything absolute against it needs a wrapper — and a layout change is not verified until the page is on screen. |
| 2026-08-15 | [The identifier every account hangs on is scoped to a project](2026-08-15-google-oauth-project-move.md) | A Google `sub` names a person within one Cloud project, so moving projects re-keys every account — and `users.email` has no UNIQUE constraint, so the orphan inserts without a single error. |
| 2026-08-15 | [The homepage was public, and Google still called it a login wall](2026-08-15-google-oauth-brand-verification.md) | A page proven public from one IP is proven public from one IP — and a Cloudflare setting looks like it changed nothing until the cache is purged, because the edge bakes its injected script into the stored HTML. |
| 2026-08-15 | [The bot protection that could not be told who the good bots were](2026-08-15-waf-crawlers-bot-fight-mode.md) | Free-plan Bot Fight Mode runs outside the Ruleset Engine, so no `skip` rule reaches it — allowlisting crawlers means turning it off and re-expressing the defence as WAF rules, then re-testing with a browser UA so the probe isn't answering about itself. |
| 2026-08-19 | [A stale directory answered a question I never asked it](2026-08-19-bmc-widget-static-export.md) | The grep that found nothing was pointed at a three-day-old `out/`, and fixing that step left its false conclusion — "React drops the tag" — standing through a build, a deploy and a commit message; when the evidence is void, re-run the conclusion. |
| 2026-08-20 | [The close button we broke ourselves](2026-08-20-bmc-widget-close-zindex.md) | The tip jar's chevron is a picture, not a button — the vendor closes via an overlay stacked above it, which our z-index band flattened; and the fix that restored the desktop left the phone with nothing to tap, because the real mobile close was sitting under the PWA status bar the whole time. |
| 2026-08-24 | [Universal downloads and the MP3 fallback that doubled its own wait](2026-08-24-universal-downloads.md) | A fallback must not re-run the round-trip that just failed (pass `skipCobalt` down), and tests passing is not deploys clean - run cf:build plus a wrangler-dev smoke when API code changes. |
| 2026-08-24 | [Supporter extras night: playlists, subtitles, universal page](2026-08-24-supporter-extras.md) | Fixtures fail before code does; pure modules make Worker handlers trustworthy; and consolidation means deleting the old copy, or the build says so. |
| 2026-08-25 | [The review that found the copy lying, not the code](2026-08-25-pre-push-review.md) | Every gate was green before the review started, so everything it found was invisible to tooling — the FAQ promised a free batch queue that is Pro-only, a comparator test named "prefers mp4" passed for a different reason than its name, and `cf:startup` read a stale directory to report a bundle 68 KiB smaller than the one that would have failed CI. |
