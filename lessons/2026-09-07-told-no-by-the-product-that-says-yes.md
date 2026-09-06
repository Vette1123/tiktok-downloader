# Told no by the product that says yes

**Date:** 2026-09-07
**Scope:** `linkAdvice.ts`, `batchHandoff.ts`, `importSources.ts`, `DownloaderApp.tsx`, `BatchPanel.tsx`

## What

I pasted the eight things a confused visitor pastes and read what came back.
Seven of them got this:

> Could not download this generic content. The post may be private,
> region-locked, unavailable, or not supported.

For `instagram.com/nasa` every clause of that is wrong. It is not generic, it is
not private, it is not region-locked, and nothing about it is unsupported — it
is a profile, which we can tell before making a single request. The visitor is
left to guess that the fix is to open a post and copy *that* link.

The worst one was a YouTube playlist, which got the same sentence — while the
site has a feature that turns a playlist into a queue. Somebody holding exactly
the thing the batch queue exists for was being told no by the product that says
yes.

`linkAdvice` now recognises a profile, a collection and a bare front page from
the pasted text, before anything is resolved:

- **A profile** gets what to do instead: "Open the video, reel or photo you want
  and paste the link to that."
- **A collection** gets the queue. A supporter sees "Send it to the queue" and
  the link is handed to the batch panel, which scrolls into view with the field
  filled. Everyone else sees "Supporters can queue it →", which is the one place
  on the site where making that case is help rather than advertising: the
  visitor is holding a collection and the queue is the answer to holding one.

Zero `/api/download` requests are spent on any of it now.

## Mistakes

**Reusing `detectImportSource` immediately claimed two single posts as
collections.** `vimeo.com/76979871` read as a user's channel feed and
`pinterest.com/pin/214343263495052387` as a board — and the importer had been
building `vimeo.com/76979871/videos/rss` and `pinterest.com/pin/<id>.rss` for
months, URLs that cannot resolve, so anybody who pasted a pin into the playlist
box was told the collection was empty. Reusing the function found a bug in it.
Both are fixed at the source rather than papered over in the new caller, because
the importer was equally wrong.

**I shipped "That is a Instagram profile" as far as the browser.** The article
was concatenated by the template, which cannot know that "an Instagram" and "an
X" are both right while spelling says otherwise. The article travels with the
name now. Caught by reading the rendered string, which is the only place a
sentence assembled from parts can be read.

**The first hand-off was `setState` inside an effect,** which this repo bans and
its lint rule stopped. The store had a clear-on-read that forced it: consuming
the value is a write, and a write cannot happen during render. Dropping the
clear and having the panel remember the last seed it applied removed the effect,
the write, and a whole function.

**And an ad-hoc `hover:border-cyan-400/60` on the new button,** caught by the
repo's own hover-language test rather than by me. That test exists because a
previous "fixed once" hover cleanup was undone by the next page somebody added.
It worked exactly as designed.

## What worked

- **Pasting the wrong things on purpose.** Eight URLs, one script, and the
  single worst error message on the site fell out in ten seconds. None of this
  was reachable by testing the happy path, and none of it was a bug report — it
  is the kind of failure that produces a closed tab.
- **Deciding before the request.** The advice is pure, runs on the pasted text,
  and costs nothing; the old road spent four extractors to arrive somewhere
  worse.
- **Making the negative case the bulk of the tests.** Thirteen shapes that must
  keep resolving normally, against nine that must not. A false positive here
  refuses a real post, which is far worse than the generic error it replaces.

## Rules

- **Read your product's error messages by causing them.** The happy path is
  tested constantly and the error path is written once and never looked at.
- **When a wrong input has a right answer elsewhere in the product, route to
  it.** "That is a playlist" is a better error; "here is the queue" is a feature.
- **Reusing a function in a second place is a free audit of the first.** Both
  bugs it exposed had been shipping in the importer.
- **An article belongs to the word, not to its spelling.** Any sentence built by
  concatenation has to be read as a sentence before it ships.
