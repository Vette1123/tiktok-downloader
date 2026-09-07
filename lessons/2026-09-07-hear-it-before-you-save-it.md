# Hear it before you save it

**Date:** 2026-09-07
**Scope:** `audioPreview.ts`, `AudioPreview.tsx`, `byline.ts`, `ShareButton.tsx`, `DownloaderApp.tsx`

## What

**A player for audio-only results.** One existed already, and only for photo
carousels — the case where the soundtrack is obviously separate from everything
else on the card. Every other audio result was a title, a thumbnail and a
Download button with no way to check it is the right track. That stopped being
an edge case: YouTube video is unobtainable from this host, so a YouTube link
resolves to audio, and picking MP3 anywhere lands in the same place. The two
markups were the same card twice, so they are now one component driven by one
predicate: offer a listen when there is audio and nothing else here that can
already be heard. A video preview plays its own sound and an embed plays the
original, so both suppress it; a carousel keeps it in every case.

**"Share link", not "Share".** Shipping "Send to an app" this morning left the
card with a bare "Share" that sends a URL, directly above a button that sends
the file. Same verb, different object, and the surprising one was the old
button.

**No more "by Unknown".** The extractors fill a missing uploader with the
literal string `'Unknown'`, which is sensible inside a data structure and
strange on a card: it claims to name somebody and then does not. Both bylines —
the card's and the player's — go through one helper now.

**And the player stopped repeating the heading it sits under.** When the label
would only echo the card's title, the block names itself: "Preview".

## Mistakes

**I built the preview and then looked at it.** The first working version showed
`instagram_DMmxU4bKcsR_audio (audio)` in the card heading and again in the
player heading two lines below, with "by Unknown" under both. Every part of
that was correct by its own rule, and the whole was embarrassing. Nothing in a
unit test would have said so. Rendering it and reading the result is what
found all three.

**The iOS hint was teaching the long way round.** "On iPhone it saves to Files.
To add it to Photos, open the file, tap Share, then Save Video" was good advice
this morning and stale by lunchtime — the share sheet is now one tap away in
the banner. I only noticed because I was in that file for the button rename.
**Shipping a shortcut means auditing the copy that describes the long route.**

**A substring check would have eaten a real band.** The first `namedAuthor`
draft tested `includes('unknown')`. "Unknown Mortal Orchestra" is a real artist
and exactly the kind of name a music-oriented downloader sees. It is an exact,
case-folded set membership now, with that name as a test.

**A dead end chased for the last time.** Clicks driven through the automation
kept getting swallowed on the first attempt after a page load, which had looked
like a possible hydration gap worth investigating. A synthetic `.click()`
resolved instantly on the same element, which settles it: the handler is
attached, the harness's pointer event was not reaching the page. Not a product
bug, and recorded here so it does not get re-investigated a fourth time.

## What worked

- **Extracting the predicate before writing the JSX.**
  `shouldOfferAudioPreview` reads as four sentences about what is already
  audible, and its test file is where the carousel exception is explained.
- **One helper for two bylines.** There were exactly two sites, which is the
  point at which a shared helper stops being speculative.
- **`preload='none'`, carried over deliberately.** The original had a comment
  explaining that `metadata` would pull the head of every track through
  `/api/audio` for visitors who never press play. That reasoning applies far
  more broadly now that every audio result has a player, so the comment moved
  with the code.

## Rules

- **A feature that exists for one case is worth asking about for all of them.**
  The carousel player was right; its scope was an accident of what shipped
  first.
- **Look at the thing.** Three separate defects in one card, none of them
  reachable by a test that was not staring at the render.
- **When you ship a shortcut, go and read the copy that describes the long
  way.**
- **Placeholder strings are for data structures, not for screens.**
- **Match a sentinel exactly, never as a substring.** Real names contain them.
