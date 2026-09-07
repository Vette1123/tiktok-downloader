# The JPEG came back through another door

**Date:** 2026-09-07
**Scope:** `downloader.ts`

## What

The monitor's Instagram reel probe went red and the resolve logged nothing at
all — four extractors, every one of them silent on failure. So the first commit
was not a fix, it was a sentence: name each method, record each outcome in a
word, and print the lot on the two degraded exits.

Production answered on the next deploy:

```
instagram crawler view: DKcalTzoftf answered 429, 0 chars — rate limited, holding off for 10 minutes
Instagram gave a reel its cover image: embed:nothing crawler:nothing media-info:nothing cobalt:stills(1)
```

Which is the whole story in two lines. Instagram rate-limits the crawler view
with a `429`; the ten-minute hold then makes every later attempt a silent skip;
this reel's embed page carries no `video_url`; and **Cobalt answers with
`images: [cover]`**.

That last one is the bug from
[the tunnel that served a JPEG](2026-09-06-the-tunnel-that-served-a-jpeg.md),
back through a door the guard was not standing at. That fix probes a candidate
stream and rejects one whose first bytes are a picture — but a gallery never
claims to be a stream, so it is never probed. The cover reached the visitor as
`images[0]`, which is the original complaint (*"I put video links, it's
downloaded as images"*) reproduced exactly, by a different route.

Two changes:

- **A single still is never the answer for a `/reel/` link.** A reel cannot be a
  carousel, so one image is the poster. More than one is left alone: that is a
  real carousel something mislabelled, and dropping it would lose content
  nobody could get otherwise.
- **A rate limit says so.** Falling through now produces *"Instagram is
  rate-limiting this downloader right now… Nothing is wrong with the post — give
  it a few minutes and try again"* instead of the generic list of reasons
  (private, deleted, region-locked) that are all wrong and all alarming.

## Mistakes

**I fixed this bug on 2026-09-06 and did not ask how else it could arrive.**
The guard I built answers "is this stream really a video". The question I should
have asked is "what else can reach the visitor as their file", and the answer —
`images[]` — was sitting in the same function. A fix aimed at one path, for a
defect defined by its outcome.

**The first version of the refusal was an inline condition,** `!(expectsVideo &&
images.length === 1)`, buried in a branch that no test could reach: the file
around it stubs `fetch` for private methods and cannot drive the whole chain.
Extracting `stillsAreJustTheCover` made the rule four assertions instead of a
comment, and the one that matters is the negative — a four-image gallery must
still come through.

**I wrote a test that asserted nothing new.** The first attempt re-checked
`instagramLinkIsVideo`, which two existing tests already cover, and passed
immediately — which is what a test that tests nothing does. Deleted and
rewritten against the actual rule.

## What worked

- **Shipping the diagnostic as its own commit and waiting for the deploy.** Two
  log lines replaced every hypothesis. The alternative was reasoning about four
  extractors from the outside, which is what the previous hour had been.
- **A give-up line that names each attempt.** `cobalt:stills(1)` is the entire
  finding in eleven characters, and it is only legible because each method was
  given a name first.
- **Nothing logs on the path that works.** The signal is readable because it is
  rare.

## Rules

- **A guard protects a path, not an outcome.** After fixing "this stream is
  secretly a picture", ask what else ends up on the visitor's disk — the same
  wrong file can arrive as a gallery, a thumbnail, or a fallback.
- **When a chain of extractors gives up, it must say which one and how.** Four
  ways to fail that all look like one result is a chain nobody can debug from
  outside, and this repo has now needed the same line twice in one day (see
  [YouTube](2026-09-07-youtube-was-answering-with-an-embed.md)).
- **"Something beats nothing" has a size limit.** For a link whose shape names a
  video, one image is not a smaller answer; it is the wrong one.
- **A rate limit is not an unavailable post.** Telling somebody their public
  reel is private, deleted or region-locked is worse than telling them nothing.
