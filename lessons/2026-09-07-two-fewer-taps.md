# Two fewer taps

**Date:** 2026-09-07
**Scope:** `linkDrop.ts`, `autoSave.ts`, `prefs.ts`, `prefsCore.ts`, `entitlements.ts`, `DownloaderApp.tsx`, `AccountPanel.tsx`, `config/pro.ts`, `i18n.ts`

## What

Three ways to spend fewer actions on the same download.

**Drop a link onto the page.** Dragging a tab, a bookmark, or selected text from
a chat onto the card resolves it. No drop overlay: the paste bar's own ring
lights in the colour focus already uses, and the one line under the bar swaps to
"Drop the link to start". Those are the two things already on screen pointing at
the field, so a full-width layer would only cover the thing it was pointing at.

**Paste with nothing focused.** `Ctrl`/`Cmd`+`V` anywhere on the page resolves
the link. This reads the clipboard off the event, so unlike the Paste chip
(`navigator.clipboard.readText()`) it needs no permission and works in Firefox,
which refuses read access outright. It stands down for any field the visitor is
typing in, and for a live selection they might be copying out of.

**Auto-save, for supporters.** A toggle in the account panel: a resolved link
starts downloading on its own. It is the same kind of benefit as the filename
template and is allowed for the same reason — it removes a tap, it does not
widen reach, and everything it saves is something an anonymous visitor can
already download with one more tap. Carousels are excluded: a gallery is a set
with a selection to make, and firing twenty downloads at a browser is not "less
standing over it".

## Mistakes

**The first drop handler called `preventDefault` on every `dragover`,** which
quietly made the card a drop target for files as well as links. A dropped image
would have been swallowed and then ignored, because `droppedLink` finds no URL
in it and returns — so the browser's own behaviour (open the file) was replaced
by nothing at all. Caught by asking what the handler does with a drag it does
not want, rather than by testing the drag it does. The fix reads
`dataTransfer.types` and only claims a drag that could hold text.

**`isEditableTarget` was written with `instanceof HTMLElement`,** which failed
immediately in this repo's test environment (Node, no DOM) — and would also have
returned false for an input inside an iframe, handing that field's paste to the
page. Reading `tagName` and `isContentEditable` off the target works in both.
The test environment caught a real cross-realm bug by accident.

**The auto-save effect was nearly hung off the resolve site.** There are four of
those — the paste bar, the PWA share-target hand-off, the recent list, and a
quality re-pick — and the rule in CLAUDE.md about fixing in the shared place
applies just as much to features: the call site that got forgotten would have
silently withheld a paid feature from the person paying for it. It watches the
card's state instead, which all four already produce.

**A dead local survived the refactor.** Extracting `templateHint` left
`const unknown = ...` unused in `FilenamesSection`; lint caught it. Worth
recording only because the extraction itself was a drive-by fix of a nested
ternary that the house rules ban, and a drive-by fix is exactly where a
half-finished edit hides.

## What worked

- **Reusing `--surface-line`.** The paste bar already had one token driving its
  ring, lit by an error (red) and by focus (cyan). Dragging is a third reason to
  light it and needed no new colour, no new element, and no new state in the CSS
  — just a third branch in a three-line helper.
- **Synthesising the gestures in the real browser.** `DataTransfer` and
  `ClipboardEvent` can both be constructed from the console, so the drag ring,
  the hint swap, the uri-list comment-line skip, the end-to-end resolve, the
  page-level paste, and the "leave the field's own paste alone" case were each
  confirmed against the running app rather than argued about.
- **Splitting the logic out of the component.** `linkDrop.ts` and `autoSave.ts`
  are pure and get real tests; what stayed in `DownloaderApp.tsx` is wiring. The
  interesting auto-save cases are the ones that return null, and those are
  exactly the ones nobody would think to click through by hand.

## Rules

- **Ask what a handler does with input it does not want.** `preventDefault` on
  `dragover` is a claim over every drag, not only the ones you can use.
- **A new feature needs the same "one place decides" treatment as a fix.** Four
  resolve sites means an effect over shared state, not four calls.
- **`instanceof` against a DOM class is a realm check, not a type check.** Read
  the properties.
- **A ring already lit for two reasons can take a third.** Reach for the
  existing token before reaching for an overlay.
