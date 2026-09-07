# Two knobs, one memory

**Date:** 2026-09-07
**Scope:** `downloadProgress.ts`, `platformMemory.ts`, `platformQuality.ts`, `platformFormat.ts`, `DownloaderApp.tsx`

## What

**How much longer.** The download readout said `6.2 / 20.0 MB · 3.1 MB/s` — the
two inputs to a sum nobody should be doing while they wait. It now says
`· about 30s left` as well. The interesting part is where it stays quiet, since
a wrong estimate is worse than none: before three seconds (the opening window is
TLS setup and the instance's own startup, which reads wildly pessimistic), under
five seconds left (the number changes faster than it can be read, and a nearly
full bar already says it), and over an hour (the rate has collapsed and the
transfer is going to fail rather than finish, so "about 4 hours" is a guess
about the wrong thing).

**Per-platform format.** Quality has been remembered per platform for a while:
data saver for the phone-video site, best available for the lecture site. Format
was not, and "MP3 from YouTube, video from TikTok" is exactly as ordinary a
habit. It also stopped being a preference this week — with YouTube video
unobtainable from this host, the MP3 is the whole of what a YouTube link can
give, so picking it once and having it stick is the difference between a working
default and a chore.

Both are set the same way: an explicit re-pick on a *result*, which is a
statement about the platform rather than about the post. The hint under the
toggles now names both, with one reset for the pair.

## Mistakes

**I nearly listed only the non-default.** The hint was going to print "MP3" and
say nothing for a remembered "Video", on the reasoning that video is what the
site does anyway. Wrong: the memory overrides the *global* toggle, so for
somebody whose global is MP3, a remembered "Video" is the entire reason that one
platform behaves differently — and they would have been left reading
"TikTok: HD" wondering where the video came from. Caught by asking who the line
is for rather than what it usually says.

**And a hint that could render as `YouTube: · reset`.** The first version gated
on "is anything remembered" but built its list only from values it had words
for, so a remembered "video" produced a truthy check and an empty list. Fixing
the first mistake fixed this one too, which is the tell that they were the same
mistake.

## What worked

- **Extracting `platformMemory` at the second use, not the third.** The map
  operations and the storage wrapper are identical for quality and format;
  writing the second one by copy would have meant two places to fix the next
  time a validator or a storage guard changed. What stayed behind in each module
  is the naming, which is the part call sites read.
- **Keeping the two stores separate under one shape.** A test asserts it
  explicitly, because the whole hazard of a generalisation like this is a shared
  key turning "MP3 for YouTube" into "data saver for YouTube" as well.
- **Testing the ETA by its silences.** Five of the seven assertions are cases
  where it must say nothing. That is where the value is: the number itself is
  arithmetic.

## Rules

- **A derived readout should show the conclusion, not the inputs.** Bytes and a
  rate are the arithmetic; "about 30s left" is the answer.
- **An estimate must have a range where it declines to answer.** Too early, too
  close, and too far are all worse than silence.
- **When a per-thing memory earns a second thing, generalise the mechanism and
  keep the names.** `effectiveFormat` reads better at a call site than
  `effectiveFor<Format>`, and costs three lines.
- **Ask who a status line is for before deciding what it omits.** "Everyone
  knows the default" is false for anybody who changed the default.
