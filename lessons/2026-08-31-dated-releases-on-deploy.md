# Dated releases on deploy, and the audit that followed

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

## The audit that followed

`pnpm cf:health` was read after the release shipped, and its output was
misread — which turned out to be the report's fault, not the reader's.

**The challenges that looked like users were headless browsers.** Four rows,
14 events, four IPs, `/api/download` — reported as
`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (`, which is what a desktop
Chrome looks like. The full string ends `HeadlessChrome/151.0.0.0`, and the
report cut the line at 52 characters — one character before the only token that
mattered. Every browser user agent opens with the same forty characters of
history, so a plain cut is guaranteed to keep the part that says nothing.

`shortAgent()` in `scripts/cf-setup.mjs` now strips the boilerplate
(`Mozilla/5.0`, the AppleWebKit/KHTML clause, the trailing `Safari/…`) and
elides what is left from the middle. The same rows now read
`(X11; Linux x86_64) HeadlessChrome/151.0.0.0`. No WAF rule changed: every
challenge in the window was a scripted client, exactly what the rule is for.

**The remaining 21 challenges are empty-UA requests** from Cloudflare and Google
egress IPs, 19 of them to `/api/download`. Nothing here fetches our own origin
server-side (`src/lib/resolve.ts` calls `/api/download` from the browser, where
a UA is always sent), so these are somebody else's script. Left challenged.

**`@vercel/og` was an unused dependency.** The OG, Twitter-card and icon routes
all import `next/og`, which ships inside Next. Nothing in the repo imported
`@vercel/og`; `pnpm cf:build` is identical without it.

**The README told contributors to deploy to Vercel.** Production has been on
Cloudflare Workers for weeks — the tech-stack table two hundred lines above the
Deployment section already said so. `deploy/cobalt/README.md`,
`deploy/resolver/README.md`, `deploy/resolver/OPERATIONS.md`, `render.yaml` and
`deploy/cobalt/fly.toml` all still pointed at a Vercel dashboard for env vars
too, and now name the Worker secret commands instead — with the keys named,
because a bare `pnpm cf:setup secrets` pushes `PRO_TOKEN_SECRET` and logs every
user out.

## Rules (from the audit)

- A report that truncates its evidence will be believed. If a field is cut to
  fit a terminal, cut the boring end, not the identifying one.
- Grep for a dependency's import before assuming the package.json entry means
  it is used. `next/og` and `@vercel/og` are different packages.
- Hosting facts rot in the least-read half of a README first. When the platform
  changes, grep the whole repo for the old one — including YAML and Dockerfiles.
