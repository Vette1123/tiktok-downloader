# An extension is a promise

**Date:** 2026-09-07
**Scope:** `mediaFormat.ts`, `blobSaver.ts`, `DownloaderApp.tsx`, `BatchPanel.tsx`

## What

Every saved file was named before a single byte of it had arrived. The audio
button says `.mp3`, the video button says `.mp4`, and both are decided at the
moment of the click. That is right most of the time and quietly wrong the rest:
a Cobalt tunnel really does return MP3, but the fallback path re-serves the
source's own audio track, which is AAC in an MP4 container from YouTube and
Opus in WebM from others. Those files were reaching disk called `.mp3`.

The cost is not cosmetic. Some players refuse them outright, taggers misread
them, and the file lies about itself in a folder somebody keeps. `saveMedia`
now reads sixteen bytes, sniffs the container, and corrects the extension
before writing — `.m4a` for ISO-contained audio, `.webm` for Matroska, `.mp4`
kept for ISO-contained video. Whether a file is audio is read from the
extension that was *asked for*, not from the bytes, because an MP4 container
holds both and only the button that was pressed knows which one was wanted.

Unrecognised bytes return the name unchanged, which is the correct answer for
every image and archive this app writes, so every media save can be routed
through it without a check at the call site.

## Mistakes

**Found while building something else, and nearly left as a note.** The MP3
tagger needed to refuse non-MP3 bytes, which is how the mismatch surfaced at
all. The tempting move was a line in that lesson saying "audio is sometimes
misnamed" and moving on. The sniffing primitive was already written by then;
the whole fix was one function and its call site.

**The first version put the correction in the component.** That would have left
`BatchPanel` — which saves videos on its own path — naming files the old way,
and the next person to add a save surface would have had a fifty-fifty chance
of picking the wrong helper. It belongs in `blobSaver`, beside `saveBlob`,
where every save already goes.

**The JPEG collision was luck, not design.** An MPEG frame sync is `0xFF`
followed by three set bits; a JPEG opens `0xFF 0xD8`, whose top three bits are
`110`. One bit apart from being sniffed as audio. The test that pins it was
written after noticing, not before — the mask happened to be correct because it
was copied from the spec rather than approximated.

## What worked

- **Reading the wanted-kind off the caller's extension.** `iso` is ambiguous by
  design; asking the bytes to disambiguate would have been guessing when the
  answer was already sitting in the argument.
- **Returning the input unchanged as the default.** It made "route everything
  through this" safe, which is what made a single call site enough.
- **Verifying against a real download.** The Cobalt MP3 turned out to already
  carry an ID3v2.4 tag, so it sniffs as `mp3` through the ID3 branch rather
  than the frame-sync one — a path that would otherwise have gone untested on
  real bytes.

## Rules

- **Name a file after its bytes, not after the button that fetched it.**
- **Put a correction where every caller already goes.** A helper that only the
  surface you were looking at uses is a fix half-applied.
- **A sniff's default answer must be "leave it alone".** That is what lets it
  sit on a universal path instead of behind a condition somebody has to
  remember.
