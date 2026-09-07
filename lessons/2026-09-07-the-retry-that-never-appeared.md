# The retry that never appeared

**Date:** 2026-09-07
**Scope:** `appReducer.ts`, `errorMessages.ts`, `DownloaderApp.tsx`

## What

Three fixes to what the app says when something goes wrong.

**The Try again button had never rendered on the path it was written for.** It
was gated on `state.originalUrl`, which names the link a *result* came from —
and `RESET_DOWNLOAD_STATE` clears it at the start of every attempt, so a resolve
that failed left it empty. The offer existed, was styled, was translated into
five languages, and was unreachable in the exact case its own comment described.
`retryTarget()` now falls back to the link still sitting in the field, with the
resolved link winning when there is one (after a *download* failure there is a
card on screen, and re-resolving it is how an expired tunnel gets fresh URLs).

**Being offline said the wrong thing, slowly.** With no connection the fetch to
our own API rejects with "Failed to fetch" — which the network classifier did
not match, because its pattern had `fetch failed` and not the reversed wording
browsers actually produce (Safari says "Load failed"). So it fell through to the
generic branch and put the browser's internal phrasing on screen. Now the
request is not made at all: `navigator.onLine === false` is answered
immediately with "You are offline… nothing about the post is wrong". Read only
in the negative, because `true` is satisfied by a captive portal and a dead
uplink alike.

**Failures now interrupt.** The banner was `role="status"`/`aria-live="polite"`
for everything, so an error queued behind whatever the page was already reading
out. A failure gets `role="alert"` — safe to switch per message only because
`key={message}` remounts the element, so no live region ever changes role in
place.

## Mistakes

**The bug was in a feature I had shipped and called done.** Nothing about the
retry button was hard; it was tested by looking at a *download* failure, where
`originalUrl` is set, and never against the resolve failure it was built for.
The two states differ by one field, and the screenshot that would have shown it
was never taken.

**The classifier was written from what errors ought to say.** `fetch failed`
came from reading Node's message; `Failed to fetch` is what the browser says,
and it is the one that reaches a visitor. A pattern list assembled by
imagination rather than by observation matches the cases you already thought of.

No wrong turn on the offline design itself — the one-directional reading of
`navigator.onLine` was clear from the outset.

## What worked

- **Folding four copies into `explain()`.** The same `${fe.title} — ${fe.hint}`
  dance appeared in two handlers twice each. The connection check went in once
  and every failure path got it; four copies would have got it in the two I
  remembered.
- **Making the derivation a named, tested function.** `retryTarget` is three
  words of logic, and its test is a paragraph explaining why `originalUrl` alone
  is the wrong answer. That paragraph is the part that stops it regressing.
- **Checking both fixes in the browser rather than only in tests.** The Try
  again button under a real failed resolve, and the offline banner appearing
  instantly with `navigator.onLine` stubbed to false.

## Rules

- **Test a UI condition against the state it was written for, not the state
  that is easiest to reach.** "Shown on failure" has more than one failure.
- **Error-matching patterns must come from observed strings.** Copy the message
  out of a real console, do not write what it probably says.
- **`navigator.onLine` answers "offline" and never "online".**
- **A failure should interrupt; a confirmation should wait.** `role="alert"` is
  not decoration.
