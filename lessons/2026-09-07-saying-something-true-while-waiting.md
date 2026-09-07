# Saying something true while waiting

**Date:** 2026-09-07
**Scope:** `resolveNarration.ts`, `DownloaderApp.tsx`

## What

Resolving a link is the longest wait in this app — a few seconds when a source
is quick, fifteen or more when it is not — and the whole of what it said was a
pulsing grey shape. A shape communicates "something is happening" and nothing
else, which is not the question anybody has at eight seconds. The question is
"is waiting still the right thing to do".

Three lines now sit above the skeleton:

- under five seconds: **Reading the Instagram post…** — naming the platform,
  which is known from the link before any request goes out, and which doubles
  as a receipt that the paste was understood;
- five to fifteen: **Still working — some sources answer slowly.**
- past fifteen: **Still going. You can leave this open — it will finish or say
  why.**

The noun travels with the name. Pinterest has pins, Twitch has clips, YouTube
has videos; only some platforms have posts. "Reading the YouTube post" is the
kind of small wrongness that reads as somebody else's product with the labels
swapped.

## Mistakes

**The first draft narrated stages the app cannot see.** "Asking the CDN…",
"Picking the best quality…" — the sort of copy that makes a wait feel
supervised. The extractor chain does not report where it is, so every one of
those lines would have been a guess dressed as status. What survived is only
what is actually known: which platform the link is for, and how long it has
been. The module comment says so, because that constraint is the design.

**I shipped "Reading the YouTube post…" and only caught it in the browser.**
The map held names, not subjects. It looked fine in a unit test asserting
`'Reading the Instagram post…'` — Instagram genuinely has posts — and wrong the
moment a real YouTube link went through it. The test that would have caught it
is the one that varies the platform, which now exists.

**The obvious verification was the one I nearly skipped.** Stage one rendering
proves the component mounts, not that the timer ticks — those are
indistinguishable if the interval never fires. Stalling `/api/download` for
twenty-five seconds from the console made all three stages observable in one
run: at eight seconds "Still working", at seventeen "Still going".

## What worked

- **Writing the honesty rule into the module before the copy.** Every line was
  then checked against it, and one test asserts no stage word ever appears in
  any output.
- **Pairing name and noun in one map.** Two maps would have drifted the first
  time a platform was added.
- **Stalling one route rather than throttling the network.** A one-line
  `window.fetch` wrapper made a fifteen-second state reachable on demand.

## Rules

- **Never narrate a stage the system does not report.** Progress copy that
  guesses is worse than a spinner, because it can be caught lying.
- **A status line's silences and its wording are both content.** What it says at
  fifteen seconds is a different question from what it says at one.
- **Use the platform's own noun.** Pins, clips, videos, posts.
- **Proving a timer needs a slow case.** Make one on purpose; do not wait for a
  slow day.
