# Nafis on iOS

**Date:** 2026-09-07
**Scope:** `apps.ts`, `apps.test.ts`

## What

Nafis shipped on the App Store on 2026-09-06 — a day after Rafiq and Masareef —
and the companion-app list still described it as Android-only. Every iPhone
visitor tapping its name in the footer landed on a Google Play listing they
cannot install from: the exact dead end this module was rewritten to remove two
days earlier, left behind on the one app that had not shipped yet.

The entry now carries `{ id: '6807595780', slug: 'nafis' }`, which gives it an
`appStoreUrl` and the `installUrl` chooser like its neighbours. All three apps
are now on both stores, so the list is uniform — but `appStoreUrl` and
`installUrl` stay optional, because the next app added starts Android-only and
a required field would have to be filled with something untrue on its first
day.

## Mistakes

**I nearly changed one of the two things the old comment said.** It gave two
reasons Nafis had no App Store entry: no iOS id anywhere, and
`vette1123.github.io/nafis-privacy/go` returning 404. The obvious move on
hearing "it's on iOS now" is to add the id and stop. But `installUrl` points at
that chooser page, and if it were still 404 the change would have handed every
desktop reader a dead link — worse than the Play-only link it replaced. Both
claims had to be re-checked. The page now returns 200 and contains the same App
Store id, which is the only reason `installUrl` is safe to set.

**No wrong turn on the id itself**, because it was not guessed: the iTunes
lookup API, queried by bundle id `com.mohamedgado.nafis`, returned exactly one
result — "Nafis: Gold, Silver & Dollar", seller Mohamed Gado, released
2026-09-06. Searching by name would have been a guess dressed as a lookup.

**One copy is out of reach.** The module header says an identical port lives in
the Reely repo and that both must move together. Searching every project on
this machine for `com.mohamedgado.nafis` found only this repo and
`portfolio-v1/lib/projects.ts` — no Reely copy. The portfolio one carries the
same stale claim and even names the trigger ("When it ships on iOS, this
becomes that chooser — and only then"), so it is now wrong by its own rule.
Left untouched: it is a different repo and not what was asked for.

## What worked

- **A comment that recorded its evidence.** "No iOS submit config in its
  eas.json, no App Store id anywhere in its repo, and nafis-privacy/go 404s" is
  what turned "add the id" into "re-check both, then add the id". A comment
  saying only "Android-only" would have let the dead chooser link through.
- **Verifying against Apple's own index, then against the chooser page.** Two
  independent sources agreeing on `6807595780`, neither of them me.
- **Checking the iPhone branch in the browser rather than reasoning about it.**
  Overriding `navigator.userAgent` and stubbing `window.open` showed the row
  now opening `https://apps.apple.com/app/id6807595780`.

## Rules

- **When a comment lists two reasons for a decision, revisiting it means
  re-checking both.** Fixing the half you were told about leaves the other half
  to fail quietly.
- **Look an id up by a key that cannot match the wrong thing.** Bundle id, not
  app name.
- **This kind of staleness is silent.** Nothing throws when a store link goes
  out of date; somebody just cannot install the app. The invariant test pins
  what is checkable — App Store link and chooser present together, the label
  never claiming a store that has no URL — and the release itself remains the
  only signal for the rest.
