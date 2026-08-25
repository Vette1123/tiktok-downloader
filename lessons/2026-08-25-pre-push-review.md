# The review that found the copy lying, not the code

## What
A full pre-push review of the uncommitted universal-downloads / supporter-extras
work (~4,500 lines across 57 files), then fixing everything it found. Thirteen
findings: four user-visible falsehoods, three real defects, three formatting
scars, and three consolidations — plus a fourteenth found only at the end,
when the Worker bundle turned out to be over the CI size gate and the number I
had reported earlier came from a stale directory. Tests went 578 → 616; tsc,
eslint and `pnpm cf:build` were clean before and after; the bundle went
221.3 KiB → 106.0 KiB via `minify`.

## Mistakes
- **The FAQ told visitors the batch queue was free. It has never been free.**
  `BatchPanel` opens with `if (tier !== 'pro') return null`, and `PRO_BENEFITS`
  lists "The batch queue" first — yet two new copy blocks (homepage FAQ and the
  YouTube landing) said free users could "queue manually by pasting up to twenty
  links". Both feed FAQ JSON-LD, so the claim was headed for search results.
  Nothing catches this: a string is a string to tsc, and the gate that would
  contradict it lives in a component no test renders. Copy that describes a gate
  has to be read against the gate.
- **`/pro` said "The six above" under seven benefits.** The sentence had been
  edited from "four" once already. A counted noun next to a rendered array is a
  standing invitation to drift; it now reads "Every one above" and cannot.
- **The retry button appeared under every download in progress.** It gated on
  `!isSuccessMessage(message)` alone — but "Preparing your download…" is not a
  success message either, so a running transfer rendered an enabled button
  offering to restart itself. A two-state predicate cannot answer a three-state
  question (win / failure / still running); the missing term was "is anything in
  flight", which the file *already had* as `isResolvingOrDownloading` twenty
  lines away and unused by this branch.
- **Share and Copy-link were nested inside a thumbnail check.** The extras row's
  condition was `thumbnail || platform === 'youtube'`, which is right for its two
  optional members and wrong for the two unconditional ones — so exactly the
  long-tail results this release was built for (no cover image, not YouTube) lost
  both buttons. A wrapper condition must be the union of what it wraps, not a
  copy of the first child's.
- **A sort comparator was subtracting the wrong way round, and its test said it
  was fine.** `byVideoQuality` promised "ties prefer mp4" and returned
  `(a.ext === 'mp4') - (b.ext === 'mp4')`, which sorts mp4 *last*. The test named
  `prefers mp4 on ties` passed anyway: its mp4 was the only H.264 rendition, so
  the h264 pool filter decided the case before the comparator ran. A test that
  passes for a different reason than its name is worse than no test — it spends
  the budget and buys nothing. Every term in that comparator now reads
  "loser minus winner", stated in the comment, with two tests that vary only the
  container.
- **`endsWith('vimeo.com')` accepted `myvimeo.com`.** Two `detectImportSource`
  branches build their feed URL from the pasted link's own `origin` and the
  server then fetches it, so a suffix test turned a Pro-gated endpoint into a
  fetch-anything proxy on our IP. Registrable-domain checks need the dot:
  `host === d || host.endsWith('.' + d)`.
- **`noPlaylist: false` with `dumpSingleJson`** made yt-dlp fully extract every
  entry of a playlist over the network before the code took entry #1 and threw
  the rest away. Bounded now with `noPlaylist: true` + `playlistItems: '1'`.
- **Three codemod scars survived the previous session's own audit** —
  `PLATFORM_DISPLAY = {  tiktok:` collapsed onto one line, `},    ],` at eight
  sites in `platforms.ts` with a blank line before each insertion, and two JSX
  blocks at column 0 / twenty spaces. Lint and tsc are both blind to all of it.
  The previous lesson already said "grep the intended insertion AND its
  neighbours"; the neighbours were not grepped.
- **My own repair script guessed the line endings and was wrong.** The first
  version matched `\n` against a CRLF/LF-mixed file (git applied the patch with
  LF into a CRLF checkout) and reported 0 of 8 blank-line scars. The assertion
  caught it *before* `writeFileSync`, so the file was untouched — which is the
  only reason this is a footnote and not a fourth scar. Split on `/\r?\n/` and
  work in lines; never match a newline as a byte.
- **I reported the Worker bundle as 153.5 KiB, comfortably inside budget. It
  was 221.3 KiB and over.** `pnpm cf:startup` reads whatever sits in
  `.worker-size-check/`, and that directory held a bundle from an earlier
  session — so the number was real, precise, and about code that no longer
  existed. It is the same failure as the 2026-08-19 lesson (a stale `out/`
  answering a grep), which I had read *that morning*, in this repo's own
  ledger, and still walked into. The measurement only means something when the
  build that produced it is part of the same command:
  `wrangler deploy --dry-run --outdir … && pnpm cf:startup …`, never the second
  half alone.
- **And the real number would have failed CI.** `origin/main` was already at
  **199.64 KiB** against a 200 KiB gate — 0.4 KiB of headroom before a single
  line of this work. Nobody had removed that headroom; it had simply never been
  noticed, because the gate only speaks on the build that crosses it. This
  release added ~21.6 KiB and would have failed the deploy workflow's size step
  before it ever reached the deploy step.

## What worked
- **Running the gate first, reading second.** `pnpm test` / `tsc` / `eslint` /
  `cf:build` / `cf:startup` all passed on the unreviewed tree, which is exactly
  the information that matters: everything found afterwards was, by definition,
  something no automated check can see. Four of the thirteen were prose.
- **Assertions inside every scripted edit, with the count stated up front.**
  Three scripts, two of which aborted on a wrong expectation (8 vs 0 line
  endings, 12 vs 14 quoted lines) instead of writing damage. Both times the
  assertion was more accurate than my reading of the file.
- **Transplanting the uncommitted tree into a worktree** (`git diff` → patch,
  plus `git ls-files --others` copied by path) rather than editing a dirty
  checkout. The 57-entry status and 1,674-line diff matched on both sides before
  a single fix landed.
- **Attributing the bundle before cutting it.** Walking the sourcemap and
  charging each generated span to its source turned "it is 21 KiB too big" into
  a table: `downloader.ts` alone was 96.8 KiB of 221, and the whole of this
  release's new server code was 12 KiB. That killed the instinct to go carve up
  the new features — they were not the problem, and removing all of them would
  not have fixed it.
- **Reaching for the lever the budget is actually about.** The gate exists to
  bound how much a new isolate compiles, and nothing minified this bundle —
  `minify: true` took 221.3 KiB to 106.0 KiB, leaving half the budget free,
  without trading away one capability. `keep_names` went back on in the same
  change, which is precisely what the old config comment said to do "if minify
  is ever enabled": measured at +6 KiB and +1 ms, it keeps `wrangler tail`
  naming the function that threw.
- **Smoking the minified bundle, not just weighing it.** Minification changes
  emitted code, so the size number proves nothing about behaviour. A local
  `wrangler dev` answered `/api/health` 200, the download validator 400, both
  new Pro gates 403, and served `/`, `/pro` and `/video-downloader` — including
  the corrected FAQ strings, with the two false ones grepped for and absent.
- **Looking for the helper before writing one.** The busy-state predicate,
  the thumbnail i18n keys (`thumbnailBtn`/`thumbnailSaving`/
  `thumbnailUnavailable`, defined and never used) and `saveBlob` all already
  existed. Two of the three were about to be written a second time.

## Rules
- Copy that describes a gate must be read against the gate's code in the same
  pass. `tier !== 'pro'` and the FAQ are one change, not two.
- Never write a count into prose beside a rendered array. "Every one above"
  cannot drift; "the six above" already had.
- A boolean pair cannot answer a three-state question. Before adding a UI branch
  on `!isSuccess`, ask what the third state is — here, "still running".
- A wrapper's condition is the union of its children's, or the unconditional
  children go outside it.
- When a test's name claims a behaviour, make the fixture unable to pass for any
  other reason. Vary only the thing under test.
- Domain checks use the dot. `endsWith('vimeo.com')` matches domains anyone can
  buy, and it matters wherever the matched origin is later fetched.
- Line-ending-agnostic edits only: split on `/\r?\n/`. A regex containing `\n`
  silently matches nothing on half of a mixed-EOL Windows checkout, and reports
  success while doing so.
- A worktree needs a real `node_modules`. A junction to the parent's satisfies
  vitest and tsc, then Turbopack refuses it with "points out of the filesystem
  root" — `pnpm install` in the worktree, or the build gate is not actually run.
- **Never run `pnpm cf:startup` without the `wrangler --dry-run` that feeds it,
  in the same command.** It measures a directory, not your code, and a stale
  directory gives a confident wrong answer — twice now in this repo, from two
  different stale directories.
- Check the bundle budget's *headroom*, not just its verdict. `origin/main` sat
  at 199.64/200 KiB, so the gate was going to fail on whatever landed next
  regardless of what that was. A budget with no room left is a broken build
  waiting for a volunteer.
- Attribute before you cut: walk the sourcemap and charge bytes to sources. The
  new code is rarely where the bytes are.
