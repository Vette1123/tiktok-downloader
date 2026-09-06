# The third copy of the Play-only list

## What

`src/lib/apps.ts` is a near-copy of the same module in the Reely repo: one
`playStoreUrl` per app derived from the Android package, and an `openOnPlayStore`
helper. Three surfaces use it — the hero promo cards, the footer "Our apps" menu, and
the `DevAppLinks` row on every platform landing page. Rafiq and Masareef shipped on the
App Store on 4 Sep, so since then every iPhone visitor tapping either card landed on a
Google Play listing they could not install from.

Ported the fix: apps on both stores carry `appStoreUrl` and `installUrl`, Android keeps
the `market://` hand-off, an iPhone gets the App Store, a desktop reader gets the chooser
page. Nafis is Android-only and keeps its Play link.

## Mistakes

**I deleted the icon I had just added.** After swapping every call site off
`GooglePlayIcon` I removed its now-dead definition by slicing from its `export const` to
the next one — and the next one was `AppsIcon`, which I had inserted immediately above
`GitHubIcon` twenty minutes earlier. `pnpm verify` caught it as two import errors. A
delete-by-range is only safe if you know what is inside the range; the end anchor was
picked from the file as it used to look, not as it was.

**The brand colour was a claim and I nearly left it.** I changed the Play triangle to a
neutral device glyph and moved on, but the promo card also carried an emerald-to-green
sheen the code comment called "Google-Play-green". A green Play-shaped card promoting an
App Store app says the same wrong thing the icon did. It is the site's cyan/sky now,
which is what every other accent here already uses.

**This is the third copy and there is still no shared package.** Reely and this site each
own an `apps.ts` that differ only in naming (`CompanionApp` vs `PlayApp`). The same defect
existed in both and had to be fixed twice. Not extracted, because two independently
deployed sites with no shared package is a real constraint, but the duplication is why the
bug lived in two places for two days.

## What worked

**Fixing the sibling repo first and porting.** The second pass took a fraction of the
time and arrived with the shape already settled — including the decisions that had needed
thought once (a chooser for desktop, the App Store only for Apple phones, `storeHref` so
the anchor's real href is right for a right-click).

**`pnpm verify` as one gate.** typecheck, lint and 637 tests in one command caught the
self-inflicted icon deletion immediately.

**Writing the cross-repo relationship into the file header.** "The same module exists in
the Reely repo… fix both or neither" is the only thing that will connect them next time.

## Rules

- **Never delete a range by "from this symbol to the next one" in a file you have edited
  this session.** Anchor on the symbol's own end, or check what the range contains first.
- **A brand colour is a claim, exactly like a brand icon.** When a link stops being
  single-vendor, audit the palette around it too.
- **When the same module lives in two repos, say so in both headers.** Without that, the
  second copy is found by accident, and only after someone reports the bug twice.
