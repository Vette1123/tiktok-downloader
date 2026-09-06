# Copy, switch, saved

**Date:** 2026-09-07
**Scope:** `clipboardWatch.ts`, `prefs.ts`, `prefsCore.ts`, `entitlements.ts`, `clientEnv.ts`, `DownloaderApp.tsx`, `AccountPanel.tsx`, `config/pro.ts`, `app/privacy/page.tsx`

## What

The loop a heavy user actually spends an evening on is: copy a link in the app,
switch to the tab, tap Paste, tap Download, switch back. Three of those five
steps are now optional.

**Clipboard watch (supporters).** Coming back to the tab reads the clipboard and
resolves whatever link is on it. With auto-save alongside, copying a link is the
whole interaction. It only reads while the tab is focused, which is not a policy
choice — the Clipboard API rejects otherwise — and focus is anyway the exact
moment the visitor returns from wherever they copied it. Firefox refuses
`clipboard-read` outright and Safari wants a gesture, so three refused reads and
the watcher stops asking for the session; the Paste button still works
everywhere, because a click is the gesture those engines want.

**Escape starts over.** The card clears and the cursor returns to the field.

**Focus returns after a save**, on a laptop only.

The privacy page gained a section saying plainly what is read, when, and what
happens to text that is not a link.

## Mistakes

**The two new behaviours broke each other, and the browser had to show me.**
Focus-return puts the cursor in the URL field after a save. The Escape handler
correctly ignores keys aimed at a field. So Escape did nothing at exactly the
moment somebody would reach for it — right after a download, with the cursor
sitting where the handler refuses to look. Each half was right; together they
were a dead key. The fix gives the field its own Escape (text first, then the
card), and the fact that both features shipped in the same batch is the only
reason it was caught before a visitor found it.

**I twice read the wrong signal out of the page and nearly "fixed" working
code.** Checking `document.querySelector('.results-section')` for existence
reported the card was still there after Escape; the element is an always-present
wrapper and its `children.length` had already gone to zero. Then
`document.body.innerText.includes('Smooth Adi')` reported the result was still
showing, when that text was the Recent list entry, which is supposed to stay.
Both times the reset was working. Asserting on presence rather than on content
is the same class of error as the smoke check asserting `duration > 0`.

**Focus-return was written before asking what it does on a phone.** Focusing an
input on a touch device raises the on-screen keyboard over the result that was
just saved — a courtesy on a laptop, an ambush on a phone. `useHasFinePointer`
exists because of that question, and it was asked one edit too late.

## What worked

- **Building `setFlag` at the second flag, not the third.** `setAutoSave` and
  `setClipboardWatch` are the same nine lines, so the second one became a table
  of keys and two one-line exports. Same for `writeOrClear`, which had already
  been copy-pasted twice before this.
- **Putting the decision in a pure module.** `clipboardDecision` has four
  reasons to do nothing, and every one is a real report waiting to happen: the
  same text twice (a focus event fires on every alt-tab), something already
  downloading, no link in the text, or the link already on the card (which is
  what the Copy link button puts there). None of those is discoverable by
  clicking around; all of them are one line in a test.
- **Writing the privacy section while writing the feature.** It forced the
  honest sentence — a copied link *is* sent to our resolver, exactly as a pasted
  one is — which is also the sentence the settings toggle needed.

## Rules

- **Two features that touch focus must be tested together, in that order.** A
  handler that ignores fields and a handler that focuses a field are each
  correct and jointly broken.
- **Assert on content, not on the presence of a container.** An empty wrapper is
  not a visible card, and a Recent entry is not a result.
- **Before moving focus, ask what the device does with it.** On touch, focus
  means keyboard.
- **A capability that reads something the visitor did not hand over gets a
  paragraph on the privacy page, in the same commit.** If the honest sentence is
  hard to write, the feature is wrong, not the sentence.
