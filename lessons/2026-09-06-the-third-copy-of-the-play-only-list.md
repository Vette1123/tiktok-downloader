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

**My deploy check reported "still old" for six minutes and had never seen the page.**
The verification loop curled the homepage with curl's own User-Agent, and this site's
WAF — the one we built to keep scraper fleets out — answered 403. The script only
grepped the body for a marker, so a 403 error page and a stale deploy were the same
result to it. The deploy had in fact been live the whole time. A check that cannot tell
"absent" from "forbidden" is not a check.

**And `grep -c` counted lines, not matches.** On minified HTML that is one line, so the
first recount said one chooser link where there were two. `grep -o | wc -l` is the
honest count.
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

- **Assert the status code before grepping the body.** A WAF 403, a 404 and a stale
  deploy all look identical to `grep -q marker`, and our own edge rules will happily
  block our own verification.
- **`grep -c` counts matching LINES.** Against minified HTML or JSON that is nearly
  always the wrong number; use `grep -o | wc -l`.
- **Never delete a range by "from this symbol to the next one" in a file you have edited
  this session.** Anchor on the symbol's own end, or check what the range contains first.
- **A brand colour is a claim, exactly like a brand icon.** When a link stops being
  single-vendor, audit the palette around it too.
- **When the same module lives in two repos, say so in both headers.** Without that, the
  second copy is found by accident, and only after someone reports the bug twice.
