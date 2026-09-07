# The pile you have not saved

**Date:** 2026-09-07
**Scope:** `batchHandoff.ts`, `BatchPanel.tsx`, `DownloaderApp.tsx`, `scripts/cf-smoke.mjs`

## What

Once the Recent list started recording which rows were actually downloaded (see
[have I already got this one](2026-09-07-have-i-already-got-this-one.md)), the
gap between "resolved" and "saved" became a number — and that number is a real
piece of work sitting there: links pasted while browsing that nobody got round
to saving.

So Recent now says `2 not saved yet`. A supporter gets **Send them to the
queue**, which drops the lot into the batch panel and scrolls it into view.
Everybody else gets *Supporters queue these →*, which is the clearest statement
of what the queue is for, made at the moment the visitor can see their own pile.

That is the second thing routed into the queue today; the first was a pasted
playlist. Both come from the same observation: the most persuasive place to
describe a feature is where the need is already on screen.

**Also:** a failing platform probe now prints the API's own error sentence
alongside the status. `expected 200, got 422` sent the reader to the logs for
something already in the body; `…got 422: Instagram is rate-limiting this
downloader right now` is the difference between "wait" and "the post is gone",
which this list's own rules say to tell apart *before* touching any code.

## Mistakes

No wrong turn on the feature itself. Two decisions were close enough to be worth
recording:

**A second channel in the hand-off store, not a second use of the first.** A
collection URL and a list of links land in different fields — the importer
expands one, the queue works through the other — so sharing a slot would have
made every reader guess which kind it was holding. Two small channels beat one
tagged union nobody can read at the call site.

**Append, never replace.** Somebody who has already pasted a few links into the
queue and then sends their unsaved Recent rows over meant both. Replacing would
have quietly deleted the first set, which is the kind of loss that is only
noticed after the run finishes.

## What worked

- **Building on data added an hour earlier.** `savedAt` was added to answer "have
  I already got this one"; the whole of this feature is one `filter` over it.
  Features that fall out of a field somebody already added tend to be the ones
  worth having.
- **Capping the offer at the queue's own limit.** Offering to send twenty-five
  links to a queue that takes twenty would fail at the far end for a reason
  invisible from here.

## Rules

- **Put the case for a paid feature where the need is visible, not where the
  copy is.** A pile of unsaved links, or a pasted playlist, argues for the queue
  better than any sentence on the pricing page.
- **A monitor's failure line should carry the reason the API already gave.** The
  status code alone throws away a sentence that is sitting in the body.
