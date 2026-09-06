# The tunnel that served a JPEG

## What

A report that "some Instagram stuff downloads as images when I paste video
links". Reproduced against production in one request:

```
POST /api/download {"url":"https://www.instagram.com/reel/DKcalTzoftf/"}
  -> success, downloadUrl: /api/video?url=https://co.otomir23.me/tunnel?...
GET that downloadUrl
  -> 206, content-type: video/mp4, first bytes ff d8 ff e0 ... JFIF
```

A reel, downloaded as an `.mp4` that is a JPEG.

The chain: the embed page ships `is_video: true` with **no** `video_url` for a
good share of reels, so the embed extractor correctly bails; the media API is
session-only and anonymous requests skip it; Cobalt is left, and a public
instance that cannot extract the clip does not fail — it answers
`status: "tunnel"` with `filename: "instagram_DKcalTzoftf.jpg"` and streams the
post's cover image. Every guard we had said yes to that: the status is a
tunnel, there is a URL, and `verifyStreamReachable` asked only "does this serve
bytes". `/api/video` then forces `video/mp4` onto whatever it proxies, so the
lie was complete by the time it reached the browser.

Fixed on four levels, and given a path that actually works:

- **Read what Cobalt says it sent.** `cobaltMediaKind(filename)` — a `.jpg`
  tunnel is returned as an image, never as `downloadUrl`. Free: no request.
- **Read what the stream actually is.** `verifyStreamReachable` became
  `probeStream`, returning `ok | unreachable | wrong-type`, sniffing content
  type and magic bytes. The three-valued verdict matters: *unreachable* is a
  maybe the caller keeps as a last resort, *wrong-type* is a no it must drop —
  collapsing them is how the JPEG got held as a fallback and then returned.
- **Know when a still cannot be the answer.** `/reel/`, `/reels/` and `/tv/`
  settle it before any request; a `/p/` link is settled by the embed page's own
  `data-media-type`.
- **A new anonymous extractor that resolves those reels.**
  `tryInstagramCrawlerView` — Instagram's canonical post page, requested with a
  crawler user agent, carries the full `video_versions` payload logged out.
  Verified from a Worker on Cloudflare's own network, not just this box.

Alongside it, three adjacent defects the same reading turned up:

- A Cobalt `picker` with no video in it set `downloadUrl = items[0].url` — the
  first photo, presented as the primary video. Same bug, other status.
- A carousel's second and later **videos** were dropped entirely: a post of
  three clips handed back one. `ImageData` grew a `kind`, so the gallery carries
  clips, `/api/images` names them `.mp4` and routes them through the video
  proxy, tiles show a play badge, and the lightbox plays them.
- Every carousel video reported `0:00`. The container has no duration and the
  embed's children carry none; Instagram's own encoder writes `duration_s` into
  the signed URL's `efg` parameter, so the URL answers it.

## Then production refused the new path, and a scratch Worker did not

Deployed, the reel in the report stopped downloading a JPEG — and stopped
downloading anything. `tryInstagramCrawlerView` returned null in production
while the scratch Worker I had verified it with, on the same network, in the
same minute, still got 200 and a 731 KB page carrying `video_versions`. The
parser was not the difference: copied verbatim into the scratch Worker, it
pulled the right clip out of the page CF had fetched.

The Worker could not say which of four silences it was, so I shipped a log line
that names them. One request answered it:

```
instagram crawler view: DKcalTzoftf answered 429, 0 chars
```

**Instagram rate-limits the address, not the post.** A preview Worker is a cold
address; production has been serving this site all day. Retrying is the wrong
instinct — it deepens the limit and costs a doomed 731 KB subrequest per
attempt — so a 429 now benches the crawler view for ten minutes per isolate,
the same shape as the cobalt cooldown above it.

## Mistakes

- **I spent a long time hunting the wrong shape.** The first hypothesis was the
  embed's poster-as-photo path — plausible, well-documented in the code, and
  wrong. Eight `/p/` and fourteen `/reel/` probes said every embed shell that
  lacked `gql_data` was a photo post, so that path could not be firing. What
  found the real defect was not reading more code: it was downloading the file
  and looking at byte 0. **A "wrong file" report is answered by opening the
  file.** I had `success: true` and a populated `downloadUrl` in front of me for
  half an hour before I fetched one.
- **I nearly shipped the fix without the extractor.** Refusing the JPEG turns a
  wrong answer into an honest failure, which is better but is not a download.
  The reel in the report has no working anonymous path once Cobalt is refused —
  that is *why* Cobalt was answering with a cover image. Stopping at the guard
  would have been "fixed" in the diff and still broken for the user.
- **Two heredoc round-trips died on backslashes.** `<<'EOF'` through this tool
  ate `\\` in the regexes, producing a syntax error and then a silently
  non-matching pattern that made me conclude the crawler view had no URLs in it.
  Write files with real backslashes using the Write tool, not a shell heredoc.
- **I read the payload's escaping wrong and built on it.** Convinced by a
  `JSON.stringify` dump that the crawler view was double-encoded (the embed's
  `contextJSON` is), I wrote a double-parse that matched nothing. It is encoded
  **once**; the doubling was the dump's own escaping. A debug print is a second
  layer of escaping, and confusing it for the data's is a fifteen-minute detour
  every single time.
- **The unanchored scan was nearly good enough to ship.** Taking the first
  `video_versions` in the page worked on all eight samples — and the page also
  embeds neighbouring posts from the same account, so it would eventually have
  handed someone a different clip with no error anywhere. Anchoring on the
  post's own media id costs nothing (the shortcode *is* the id, in base 64) and
  was verified by matching the embed's `video_url` byte for byte on 7/7 posts
  where both exist.

## What worked

- **`node scripts/cf-smoke.mjs` against production, then `curl` the URL it
  returns.** One request each. The whole diagnosis is two commands.
- **Wikipedia's most-viewed-reels and most-liked-posts articles** as a sample
  set, exactly as the 2026-08-15 lesson said. Regex the shortcodes out of
  `?action=raw`. Public beyond argument, and the mix of shapes (single video,
  photo, sidecar, sidecar-with-video) is what exposed the carousel defects.
- **`data-media-type` on the embed's container.** Authoritative, present in the
  bare shell, and it had been sitting in the markup this whole time while the
  code guessed from strings that only exist in the JSON blob whose *absence* is
  what triggers the guess.
- **A scratch worker under `wrangler dev --remote`** to answer "does Instagram
  serve the crawler view to a Cloudflare IP". It does, and the extracted URL
  streams 206 `video/mp4` from there. That is the only way to know, and it is
  ten minutes of work — but see above: it answers for a *cold* address, and the
  deployment is not one.
- **Copying the production parser verbatim into that scratch worker.** It ruled
  out half the problem in one request: same network, same page, right answer,
  so the parse was never the difference.
- **A throwaway live vitest** driving the real `Downloader` against the real
  internet, deleted before committing. Five URLs, one line of output each, and
  it caught the `duration: 0` that no fixture would have.

## Rules

- A file-content complaint is answered by reading the file's bytes. Status
  codes, content types and `success: true` all describe claims about the file;
  the magic number describes the file.
- A content type you set yourself can never be evidence. `/api/video` forces
  `video/mp4`, so its header says nothing about what it is carrying.
- Any third party that reports success can be reporting success at doing
  something else. Cobalt's `status` says a tunnel exists; only `filename` says
  what is in it.
- "Reachable" and "correct" are different questions and need different answers.
  A probe that returns a boolean will get them confused sooner or later.
- Refusing a wrong answer is half a fix. Find the path that gives the right one
  before calling it done.
- A capability verified from a scratch Worker is verified from a *cold address*.
  Anything rate-limited per-IP will behave differently from the deployment that
  has been serving traffic all day, and the scratch Worker will keep saying it
  works.
- A `return null` with four causes behind it is not a diagnosis, it is a place
  to put a log line. One request settled what an afternoon of reasoning could
  not.
- Every probe of a video must assert the bytes are a video. The Instagram probe
  passed on `images.length` alone, so nothing in this repo had ever checked that
  an Instagram *video* resolved to a video — for as long as that was true.
- The pricing page sells "One-tap ZIP bundles"; the carousel ZIP checkbox is
  free for everyone and always has been. Left alone deliberately — what Pro
  sells is not a thing to change while fixing a download bug — but it is the
  mirror image of the 2026-08-25 finding and wants a decision.
