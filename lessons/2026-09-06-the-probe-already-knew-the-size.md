# The probe already knew the size

**Date:** 2026-09-06
**Scope:** `downloader.ts`, `mediaProxy.ts`, `apiRoutes.ts`, `types.ts`, `DownloaderApp.tsx`

## What

Four changes, all of them small, three of them cheap because the work was already
being done somewhere and nobody had read the answer.

1. **File size on the results card.** `probeStream` already asks every candidate
   stream for `bytes=0-1024` before we hand it to anyone — that is the
   reachability check from [the tunnel that served a JPEG](2026-09-06-the-tunnel-that-served-a-jpeg.md).
   A `206` answers with `Content-Range: bytes 0-1024/7251924`, and the number
   after the slash is the whole file. So the size costs zero extra requests:
   `probeStream` now returns `{ verdict, sizeBytes }` instead of a bare verdict,
   and it rides `VideoData.sizeBytes` → `/api/download` → the card, which shows
   `0:22 · 2.6 MB`. Absent whenever the source declined to say — a tunnel
   usually does — and the card renders nothing rather than a guess.

2. **Twitter/X dropped every video after the first.** Exactly the Instagram
   carousel defect one platform over: the gallery filtered to `type === 'image'`,
   so a post with two clips arrived with one downloadable stream and the rest
   invisible. Now every item carries `kind`, and the gallery collapses only when
   it holds a single video (which the main card is already showing).

3. **`/api/video` no longer forces `video/mp4` onto a picture.** The extractors
   now refuse an image-bodied "video" twice over, but the proxy was still the
   last place a JPEG could be relabelled on the way out. An upstream that says
   `image/…` is believed, passed through, and named with the matching extension.

4. **Removed the dead cobalt instance** `rue-cobalt.xenon.zone` — 530 to both
   GET and POST, from home and from production logs.

## Mistakes

**I built the size probe before checking whether the size was already in hand.**
The first sketch was a separate `HEAD` request per resolve — one more subrequest
at ~2 ms of Worker CPU each, on the one budget this project actually watches
([subrequests are the CPU](2026-08-31-subrequests-are-the-cpu.md)). Then the
existing `probeStream` turned out to be issuing a ranged GET one line above,
throwing away the `Content-Range` header that contains the exact number. The
feature that looked like it needed a new network call needed a wider return type.

**The Twitter bug was found by grep, not by report.** After fixing the Instagram
carousel I searched for the same shape elsewhere on a hunch and found it
immediately. It had presumably been shipping for as long as the extractor has
existed. Nobody wrote in about it — which is the argument for the grep, not
against it: a defect that costs a visitor the thing they came for does not
reliably produce a bug report, it produces a closed tab.

## What worked

- Rendering the number in a real browser rather than trusting the JSON. The API
  said `sizeBytes: 7251924` an hour before the card was confirmed to show
  `2.6 MB`; those are two different claims and only one of them is what a
  visitor sees.
- Making the proxy honest as a *separate* change from making the extractors
  honest. Layered guards for one failure are only redundant if they are
  independent, and the extractor fix and the proxy fix can each regress alone.

## Rules

- **Before adding a request, read the response you already have.** Range,
  length, type and disposition headers arrive on probes we are issuing anyway;
  most "we'd need to fetch it to know" is a header nobody read.
- **A field the source did not state is absent, not zero.** `formatBytes`
  returns `''` for undefined, 0, negative and NaN, so a missing size renders as
  nothing. A wrong size is worse than no size to somebody on mobile data.
- **When a defect is fixed on one platform, grep the others for its shape before
  closing it.** The carousel/gallery filter existed in two extractors; the fix
  was written once and applied twice in the same session because it was looked
  for. See the standing rule about fixing in the shared place.
