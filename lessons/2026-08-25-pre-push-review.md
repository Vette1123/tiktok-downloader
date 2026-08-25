# The review that found the copy lying, not the code

## What
A full pre-push review of the uncommitted universal-downloads / supporter-extras
work (~4,500 lines across 57 files), then fixing everything it found. Thirteen
findings: four user-visible falsehoods, three real defects, three formatting
scars, and three consolidations. Tests went 578 → 616; tsc, eslint and
`pnpm cf:build` were clean before and after.

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
