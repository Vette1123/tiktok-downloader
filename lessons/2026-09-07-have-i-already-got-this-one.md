# Have I already got this one?

**Date:** 2026-09-07
**Scope:** `history.ts`, `savedAgo.ts`, `appReducer.ts`, `i18nStore.ts`, `entitlements.ts`, `DownloaderApp.tsx`, `config/pro.ts`

## What

Two features, one question each.

**"Saved 2 hours ago" (free).** Somebody working through a folder of posts asks
"have I already got this one", and until now nothing could answer: the Recent
list records a *resolve*, not a download. `HistoryEntry` gained `savedAt`,
stamped when a file actually reaches the disk, and the result card shows a chip
while the Recent rows show a tick. `savedAgo` phrases the gap through
`Intl.RelativeTimeFormat`, so it degrades minutes to hours to "yesterday" to a
plain date past a week, in whatever language the footer picker is set to.

**"Save both — video and MP3" (supporters).** Where a post genuinely has two
files, one tap gets them instead of resolving the link twice. Sequential, not
parallel: both handlers drive the same progress bar, and browsers throttle
concurrent downloads from one origin anyway, so racing them would buy a
scrambled readout and no time.

## Mistakes

**The first version un-marked a file the moment it was most useful to know.**
`addHistory` dedupes by URL and replaces the row, and a fresh resolve carries no
`savedAt` — so pasting a link you had already downloaded wiped the very mark
that was about to tell you so. Caught in the browser, not by a test: the stamp
was set, the resolve ran, and the field came back `undefined`. Pasting a link
again does not un-download the file, and now neither `addHistory` nor
`mergeEntries` pretends otherwise.

**I nearly stamped every pasted link as saved.** The obvious hook was
`isSuccessMessage`, which is already used for the banner and the Pro nudge. But
a finished *resolve* also reads as a success — "Content processed
successfully!" contains the word — so every link somebody merely looked at would
have been marked as one they had. `isSavedMessage` is the narrower predicate,
built from the emoji the eight completion paths already share across five
languages, which are the only part of those strings nobody will reword.

**Eight completion paths, and I started writing the eighth call.** Video direct,
video proxied, audio direct, audio proxied, slideshow, ZIP, per-image,
download-manager hand-off. One forgotten call site would have quietly claimed a
file had never been saved. It is an effect over the card's state instead, the
same shape as the auto-save and focus-return effects added earlier today.

## What worked

- **Deriving the phrase on every render rather than memoising it.** "Saved this
  minute" is a function of *now*; a memo keyed on the history row would have
  gone on saying it for an hour. The list is capped at thirty, so the lookup is
  free and the correctness is unconditional.
- **`Intl.RelativeTimeFormat` with `numeric: 'auto'`.** It produces "yesterday"
  rather than "1 day ago", in every language that has a word for it, and it kept
  a translation table from being invented for a feature that needed none.
- **Checking the rendered page rather than the store.** Both the wiped mark and
  the working chip were only visible from the browser; the unit tests were green
  the whole time, on both sides of the bug.

## Rules

- **When a store dedupes by key, ask what the replacement loses.** A field added
  to one write path is dropped by every other one until told otherwise.
- **A predicate reused for a new purpose has to be re-read against that
  purpose.** "Success" covered two events; only one of them was a download.
- **Add the field to the merge path in the same edit as the write path.** Import
  and add are the same question wearing different clothes, and an export taken
  before the field existed is the case that finds it.
