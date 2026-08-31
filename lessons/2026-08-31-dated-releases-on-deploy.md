# Dated releases on deploy, ported from the sibling repo

**Date:** 2026-08-31
**Area:** `.github/workflows/deploy-cloudflare.yml`, `scripts/release-notes.mjs`

## What

The repo is public, continuously deployed, and carries no version number, so the
only public record of what a deploy changed was the commit log. A `release` job
now runs after `deploy` on `push`, builds notes from the Conventional Commit
subjects since the previous `v*` tag, and publishes a dated GitHub release
(`v2026.08.31`, `.1` for a second release the same day).

Three decisions worth keeping:

- **Dates, not semver.** Nothing here is installed and no API compatibility is
  promised, so a bumped minor would mean nothing to a reader.
- **A separate job.** Publishing needs `contents: write`. The deploy job runs
  build scripts straight off the lockfile, so giving *it* write would hand that
  token to every one of them. The workflow is now `contents: read` at the top
  and the write scope lives on a job that only reads the git log and calls the
  releases API.
- **A push carrying only docs, tests, CI or refactors publishes nothing.**
  Those get counted in one line inside the next release that has something to
  say. `scripts/release-notes.mjs` writes `has_visible` to `GITHUB_OUTPUT` and
  the publish step's `if:` reads it.

The first run has no previous tag, so its range would be the entire history —
two years of commits presented as one deploy. It falls back to `--since=14.days`
instead.

## Mistakes

The port started as "copy everything the sibling repo did today". Two of the
three candidate changes did not apply, and only checking said so:

- The **Web Analytics beacon fix** (`auto_install` vs `ruleset.enabled`) has no
  home here — `scripts/cf-setup.mjs` has no RUM step at all, and production
  serves zero `cloudflareinsights` / `/cdn-cgi/rum` references. Copying the fix
  would have added a step to disable something that was never on.
- The **SEO hydration fixes** were about client-rendered fallback routes putting
  `noindex` back after hydration. This site is a static export with real
  prerendered pages and has no such route.

Cost of not checking would have been two plausible-looking commits that changed
nothing.

## What worked

Running `node scripts/release-notes.mjs` locally against the real log before
wiring it into CI — the notes it printed for the last fortnight are the notes
the first release will carry, so the format was reviewed before it was public.

## Rules

- Before porting a sibling repo's fix, find the code it fixes *here* first. A
  fix with no matching call site is not a fix, it is a new feature nobody asked
  for.
- Job-level `permissions:` over workflow-level whenever one job needs write.
- Release notes read by scope, not by commit type — `**resolve** — …` is what a
  reader scans for; `fix:` is for the machine.
