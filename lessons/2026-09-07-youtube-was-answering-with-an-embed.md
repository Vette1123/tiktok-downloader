# YouTube was answering with an embed, and the monitor said fine

**Date:** 2026-09-07
**Scope:** `youtubeInnertube.ts`, `downloader.ts`, `DownloaderApp.tsx`, `scripts/cf-smoke.mjs`

## What

The daily smoke went red on one check — `metadata.duration is 0 — looks like the
embed fallback, not a real extraction` — and the check turned out to be wrong
about *why* while being right that something was broken.

Resolving eight different YouTube links against production:

| video | result |
|---|---|
| `dQw4w9WgXcQ` | a real stream |
| the other seven | `embedUrl`, no `downloadUrl`, **no `audioUrl`** |

So seven of eight YouTube links were a dead end — playable in an iframe,
downloadable as nothing — and the monitor was green on YouTube because its one
probe is the one video that still worked.

Probed from a Cloudflare edge isolate (colo MRS), which is the only address whose
answer counts:

| client | most videos |
|---|---|
| `ANDROID_VR` | `LOGIN_REQUIRED` — "Sign in to confirm you're not a bot" |
| `IOS` | **OK**, 5 audio formats with plain URLs, all caption tracks |
| `TVHTML5`, `TVHTML5_SIMPLY_EMBEDDED_PLAYER`, `ANDROID_UNPLUGGED`, `WEB_CREATOR`, `MWEB` | blocked, unplayable, or sign-in |

`ANDROID_VR` is the only client that publishes a muxed progressive stream, and it
is the one being bot-blocked. No other client publishes one at all, and muxing
the adaptive tracks needs ffmpeg, which workerd cannot run. **YouTube video is
genuinely not extractable from this host** and no amount of client-shopping
changes that.

Everything else is recoverable, and was simply being thrown away:

1. **`fetchPlayerResponse` now tries `IOS` when `ANDROID_VR` fails.** Verified
   end to end the way the module's original probe was: extract from the edge,
   then fetch from a different address — itag 140 (`audio/mp4`, AAC 130 kbps,
   the one `pickAudio` prefers) gives `206 audio/mp4`, and a caption `baseUrl`
   gives the real transcript XML.
2. **`/api/subtitles` works again.** It reads the same player response, so for
   most videos it had been answering supporters *"Could not load that video from
   YouTube. It may be private or unavailable"* about public videos. A listed Pro
   benefit, silently dead, with an error message that blamed the video.
3. **The embed fallback now carries the audio.** `tryYouTubeInnertube` in
   `auto` mode used to return null whenever there was no muxed stream, throwing
   away the audio track that was in the same response. It now returns the
   half-answer with an empty `downloadUrl`, and the fallback hands it over as an
   MP3 — so the common YouTube result went from "here is an iframe" to "here is
   the MP3 you probably wanted". Costs no extra subrequest.
4. **The embed's caption stopped lying.** It said "direct download isn't
   available for this video" while a working MP3 button sat underneath it.
5. **The smoke check asserts bytes, not duration.** `checkStreamIsVideo` is now
   shared with the platform probes.

## Mistakes

**I read one red check and started fixing the check.** The failing assertion
(`duration > 0`) really was a bad proxy — duration comes from Innertube, and a
Cobalt-served resolve gets its metadata from oEmbed, which has none — and I had
the replacement half-written before running the resolve against more than one
video. The check was wrong AND the thing it was watching was broken; treating
the first as the explanation almost buried the second.

**I concluded "ANDROID_VR is 403'd ~17% of the time" from twelve calls against
one video, wrote it into a source comment as the finding, and it was wrong.** The
403 is a rate limit and real, but the actual failure is a 200 carrying
`LOGIN_REQUIRED`, on nearly every video, and `dQw4w9WgXcQ` is an outlier that
keeps working. Twelve samples of one input measured the input, not the system.
The comment and the lesson both had to be rewritten after probing four videos
instead of one.

**Two production probes in a row returned a Cobalt tunnel and I read that as
"Innertube is dead, Cobalt is covering".** They were cache hits on the same
video. The resolve cache is documented, it is mine, and I still forgot it —
every probe after the first was measuring the cache.

**I wrote the audio fallback as a second Innertube call on the failure path**,
justified it in a comment as "worth one more subrequest", shipped it as far as
green tests, and only then noticed the audio was already sitting in the response
the first call had fetched. The fix was to stop discarding it. Both the code and
its justification comment were deleted.

## What worked

- **A scratch Worker on `wrangler dev --remote`.** Every conclusion here is
  about how Google treats a Cloudflare datacenter address, and from this machine
  `ANDROID_VR` answers `OK` with itag 18 every single time. A residential probe
  would have "proved" nothing was wrong.
- **Extracting from the edge, then fetching from home.** That is what makes a
  fallback trustworthy rather than plausible: the URL has to survive leaving the
  address that asked for it.
- **Probing more than one input the moment a result looked stable.** Four videos
  turned a rate-limit story into a bot-block story.

## Rules

- **A monitor probe is one input, and one input is a sample size.** A per-platform
  check with a single URL proves that URL works. `dQw4w9WgXcQ` is the most-cached
  video on the internet and behaves like nothing else — the least representative
  probe available, and the one this repo had.
- **Assert the promise, not the mechanism.** `duration > 0` was a fingerprint of
  a particular extractor, so it went red when a different extractor did the job
  correctly. Reading a kilobyte of the stream tests the actual claim and holds
  whoever answers. Same rule as
  [the tunnel that served a JPEG](2026-09-06-the-tunnel-that-served-a-jpeg.md).
- **Before adding a call, check what the last one already returned.** Second time
  this exact mistake shipped in one day — see
  [the probe already knew the size](2026-09-06-the-probe-already-knew-the-size.md),
  where the file size was in a header the probe was discarding.
- **A degraded path that returns `success: true` needs its own alarm.** The embed
  fallback is a real feature and correctly reports success, which is exactly why
  it can hide a total extraction failure for however long nobody pastes a
  YouTube link and looks.
