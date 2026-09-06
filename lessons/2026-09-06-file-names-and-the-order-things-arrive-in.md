# File names, and the order things arrive in

Follows [2026-09-06 — the tunnel that served a JPEG](2026-09-06-the-tunnel-that-served-a-jpeg.md).

## What

Two asks in one sitting: give supporters something new worth supporting for,
and fix downloads turning up "in weird positions" in the folder.

They turned out to be the same file. `buildDownloadFilename` gained an optional
`template` — `{date} {time} {platform} {author} {title} {index}`, validated by
the same predicate that guards the stored preference, with presets, a live
preview and an editor on the account page. It is Pro, decided in exactly one
place (`useFilenameTemplate`), because seven call sites in the results card each
checking the tier is seven chances to give the feature away or withhold it by
accident. Those seven collapsed into one `nameFile(ext)`.

The ordering complaint had a real cause: the timestamp stopped at minutes. Two
files saved in the same minute fell back to sorting by platform, then author,
then title — so a clip grabbed twenty seconds later could sort *above* one
grabbed first, and a folder sorted by name stopped matching the order things
were downloaded in. `HHMM` became `HHMMSS`. The Recent list is now sorted on
read rather than trusted, because the stored array's order is only ever as good
as whatever last wrote it.

Three smaller things the same reading turned up:

- `slugify` dropped a whole extra word when the truncation happened to land on a
  word boundary, because the "don't cut mid-word" rule ran even when the cut was
  already clean.
- The batch queue zipped a carousel's clips as `.jpg`. Same defect as the one
  fixed this morning, in the copy of that code nobody had looked at.
- `ProNudge`'s dismiss control was a `×` character where the project has an icon
  set.

## Mistakes

- **I gated the carousel ZIP behind Pro, then had to put it back.** The Pro page
  had claimed "One-tap ZIP bundles" for months while the checkbox was free, so
  gating it looked like making the copy true. Then the browser showed me the
  landing page underneath the results card: *"Pull every image from a carousel —
  individually or as ZIP"*. Nine public surfaces promise that ZIP to everyone —
  two platform pages, the FAQ, `llms.txt`, the terms. Gating it would not have
  made one claim true, it would have made nine false, on pages people arrive at
  from search. The honest fix was the other direction: the *batch* archive is
  genuinely supporters-only because the queue is, so that is what the benefit
  now describes. **This is the 2026-08-25 finding wearing the other face** —
  there the FAQ promised a free batch queue that was Pro-only. Same lesson: the
  marketing surfaces and the gate are one system, and changing either half alone
  produces a lie.
- **I nearly shipped a feature the pricing page could not honestly describe.**
  Which is to say I nearly decided the product's pricing while fixing a
  download bug. Taking a documented free feature away is a business call and it
  was not mine to make quietly.
- **The first template engine was three regexes deep and wrong.** Substituting
  the tokens and then tidying the leftover separators cannot tell a stranded
  separator from one the author typed: `{author} - {title}` came out
  `nasagoddard ancient-space-rocks`, the deliberate ` - ` eaten by the same rule
  meant to clean up after a missing author. Matching each token *together with
  the text leading up to it* — so an empty token takes its own separator with it
  — is one regex and needs no cleanup pass.
- **I confused a debug dump's escaping for the data's, again.** Same mistake as
  this morning's crawler-view parse, two hours apart, in a different file.
- **A `NUL` byte got into `filename.ts`** through an edit and turned it into a
  binary file for `grep`. Rewriting it whole with Write fixed it; the tell was
  `grep` saying "Binary file … matches" rather than any error.
- **Two ref writes and a hook dependency that lint caught, not me.** `publish`
  in the batch panel must keep a stable identity, so the template is read
  through a ref — which then has to be written in an effect, not during render.

## What worked

- **One function, seven call sites.** `nameFile(ext)` in the results card
  replaced seven repetitions of the same three metadata lookups. The feature
  needed a change in exactly one place afterwards, which is the whole argument.
- **The same predicate for the builder and for storage.** `prefsCore` imports
  `isFilenameTemplate` from `filename` rather than re-stating the rule, so a
  template the builder would ignore can never reach the account — a settings
  screen showing a value that does nothing is worse than a rejected input.
- **Refusing `{ext}` as a token.** The extension has to describe what the bytes
  are, and a settable one is this morning's bug, self-inflicted. It is a test.
- **Presets tested against a bare post.** Every preset has to survive an
  untitled post by an unknown author, or picking one silently produces `.mp4`
  with nothing in front of it.
- **Opening the page rather than reasoning about it.** The ZIP claim on the
  landing page was four inches below the card I was editing, and no amount of
  grepping the component would have shown it to me.

## Rules

- A benefit list and a gate are one system. Before moving anything across the
  line, grep every public surface that describes it: platform pages, FAQ,
  `llms.txt`, terms, the nudges. Nine claims beat one.
- Never quietly withdraw a feature the site advertises for free. That is a
  pricing decision wearing a diff.
- A filename with minute resolution does not sort. If name order is supposed to
  mean time order, put seconds in it.
- Sort on read where the promise is an order. Stored arrays are only as ordered
  as whatever last wrote them.
- When an empty value has to disappear along with its separator, consume the
  separator *with the token*. Substituting first and cleaning up after cannot
  tell deliberate punctuation from leftovers.
- `grep` reporting "Binary file … matches" on a source file means a control
  character got in. Rewrite the file rather than hunting the edit.
