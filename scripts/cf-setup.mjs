/**
 * One-command Cloudflare setup: everything the deploy needs that isn't already
 * in wrangler.jsonc or the GitHub workflow.
 *
 *   node scripts/cf-setup.mjs check     verify the token, resolve the account,
 *                                       report zone + Worker status
 *   node scripts/cf-setup.mjs deploy    build the Worker bundle and upload it
 *   node scripts/cf-setup.mjs secrets   push Worker secrets from .env. Takes
 *                                       key names to push only those — see
 *                                       stepSecrets for why that matters
 *   node scripts/cf-setup.mjs zone      add the domain to Cloudflare, print the
 *                                       nameservers to set at the registrar
 *   node scripts/cf-setup.mjs domain    attach apex + www to the Worker
 *   node scripts/cf-setup.mjs waf       zone protection: WAF rules, rate limit,
 *                                       Bot Fight Mode off, TLS. See stepWaf —
 *                                       this is the step that decides whether
 *                                       search crawlers reach the site
 *   node scripts/cf-setup.mjs health    who the edge stopped in the last 24h,
 *                                       and whether any of it was a crawler or
 *                                       one of our own senders. Run it after
 *                                       every change to the WAF rules — nothing
 *                                       else can see traffic that dies there
 *   node scripts/cf-setup.mjs all       every step above, in order, skipping
 *                                       whatever is already done
 *
 * Credentials come from `.env` (gitignored — see .env.sample). That is the
 * single env file for this repo: Next reads it for `next dev` and `next build`,
 * wrangler reads it for `wrangler dev`, and this script uploads the parts of it
 * the deployed Worker needs. Nothing here reads or writes wrangler.jsonc, which
 * is committed and must stay free of secrets.
 *
 * The REST API is used directly rather than `wrangler secret put` etc. because
 * those prompt on a TTY and behave differently under CI; plain fetch calls are
 * the same everywhere and give usable errors.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, '.env')
const API = 'https://api.cloudflare.com/client/v4'

// Keys that authenticate the tooling. Most of what is left in .env is a Worker
// secret and gets uploaded; see isLocalOnly for the rest.
const CREDENTIAL_KEYS = new Set(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])

/**
 * Whether a key stays on this machine instead of being uploaded.
 *
 * A `_TEST` twin of a live secret exists so this repo can drive the payment
 * provider's test store from a terminal — buy something, replay a webhook,
 * check a status — without touching real money. The Worker must never hold
 * one. It reads `CREEM_API_KEY`, so an uploaded `CREEM_API_KEY_TEST` would do
 * nothing except leave a second, live-adjacent credential sitting in the
 * deployment for no reason, and make "which store is this thing pointed at"
 * a question with two answers.
 *
 * `NEXT_PUBLIC_*` is the other kind of not-a-secret. Next inlines those at
 * build time, so the value that matters was already frozen into the bundle
 * before this script runs; uploading one puts a public string in the secret
 * store where it can only mislead the next person reading the dashboard.
 */
function isLocalOnly(key) {
  return CREDENTIAL_KEYS.has(key) || key.endsWith('_TEST') || key.startsWith('NEXT_PUBLIC_')
}

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.socialdownloader.space'
).replace(/\/+$/, '')
// e.g. www.socialdownloader.space -> apex socialdownloader.space. The zone is
// always registered at the apex; both hostnames get attached to the Worker so
// a visitor typing the bare domain doesn't hit a dead name after the DNS move.
const WWW_HOSTNAME = new URL(SITE_URL).host
const APEX = WWW_HOSTNAME.replace(/^www\./, '')

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
}

const ok = (msg) => console.log(`${C.green('✓')} ${msg}`)
const info = (msg) => console.log(`${C.dim('·')} ${C.dim(msg)}`)
const warn = (msg) => console.log(`${C.yellow('!')} ${msg}`)
const step = (msg) => console.log(`\n${C.bold(msg)}`)

class SetupError extends Error {}

/** Minimal dotenv parser — avoids a dependency for ~15 lines of work. */
function readEnvFile(file) {
  if (!existsSync(file)) return null
  const out = {}
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Strip one matching pair of surrounding quotes, if present.
    if (value.length >= 2 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

/** The Worker name, read from the committed wrangler.jsonc (which has comments). */
function workerName() {
  const source = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
  const match = source.match(/^\s*"name":\s*"([^"]+)"/m)
  if (!match) throw new SetupError('Could not read "name" from wrangler.jsonc')
  return match[1]
}

/**
 * Calls the Cloudflare API and unwraps the standard envelope.
 * `allowFailure` returns the raw envelope instead of throwing, for the cases
 * where a 404/"already exists" is a normal outcome rather than an error.
 */
async function cf(token, endpoint, { method = 'GET', body, allowFailure = false } = {}) {
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new SetupError(`${method} ${endpoint} returned non-JSON (HTTP ${response.status})`)
  }

  if (allowFailure) return payload
  if (!payload.success) {
    const detail = (payload.errors ?? [])
      .map((e) => `[${e.code}] ${e.message}`)
      .join('; ')
    throw new SetupError(`${method} ${endpoint} failed: ${detail || `HTTP ${response.status}`}`)
  }
  return payload.result
}

/** Runs a local command, streaming its output, and fails the script on error. */
function run(command, args, env) {
  info(`$ ${command} ${args.join(' ')}`)
  // shell:true because pnpm/wrangler are .cmd shims on Windows, which
  // spawnSync cannot execute directly.
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    throw new SetupError(`\`${command} ${args.join(' ')}\` exited with code ${result.status}`)
  }
}

// --- steps ----------------------------------------------------------------

async function resolveContext() {
  // No .env is normal in CI, where the token arrives as a repository secret and
  // there is nothing to upload from a file. It is only fatal for `secrets`,
  // which is the one step that reads the file for its payload — and that step
  // says so itself. Everything else works from the environment alone.
  const env = readEnvFile(ENV_FILE) ?? {}
  if (!existsSync(ENV_FILE) && !process.env.CLOUDFLARE_API_TOKEN) {
    throw new SetupError(
      `Missing ${path.relative(ROOT, ENV_FILE)} and no CLOUDFLARE_API_TOKEN in the environment.\n` +
        '  Copy .env.sample to .env and paste your API token into it.',
    )
  }

  const token = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
  if (!token) {
    throw new SetupError(
      'CLOUDFLARE_API_TOKEN is empty in .env.\n' +
        '  Create one at https://dash.cloudflare.com/profile/api-tokens\n' +
        '  (see .env.sample for the exact permissions needed).',
    )
  }

  const verify = await cf(token, '/user/tokens/verify', { allowFailure: true })
  if (!verify.success) {
    const detail = (verify.errors ?? []).map((e) => e.message).join('; ')
    throw new SetupError(`API token rejected by Cloudflare: ${detail || 'unknown reason'}`)
  }
  ok(`API token valid (status: ${verify.result.status})`)

  let accountId = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID
  if (!accountId) {
    const accounts = await cf(token, '/accounts?per_page=50')
    if (accounts.length === 0) {
      throw new SetupError('Token has no account access. Re-create it with Account Resources set.')
    }
    if (accounts.length > 1) {
      const names = accounts.map((a) => `${a.name} (${a.id})`).join('\n    ')
      throw new SetupError(
        `Token can see ${accounts.length} accounts. Set CLOUDFLARE_ACCOUNT_ID in .env to one of:\n    ${names}`,
      )
    }
    accountId = accounts[0].id
    ok(`Account: ${accounts[0].name} (${accountId})`)
  } else {
    // Named honestly: in CI there is no .env and both values arrive as
    // repository secrets, where "(from .env)" reads as a file that does not
    // exist and sends the next person looking for it.
    ok(`Account: ${accountId} (from ${env.CLOUDFLARE_ACCOUNT_ID ? '.env' : 'the environment'})`)
  }

  return { env, token, accountId, script: workerName() }
}

/** Looks up the zone without creating it. Returns null when absent. */
async function findZone(token, accountId) {
  const zones = await cf(token, `/zones?name=${encodeURIComponent(APEX)}&account.id=${accountId}`)
  return zones[0] ?? null
}

async function stepCheck(ctx) {
  step('Status')

  const zone = await findZone(ctx.token, ctx.accountId)
  if (!zone) {
    warn(`Zone ${APEX} is not on this Cloudflare account yet — run the \`zone\` step.`)
  } else if (zone.status === 'active') {
    ok(`Zone ${APEX} is active`)
  } else {
    warn(`Zone ${APEX} exists but is "${zone.status}" — nameservers not switched yet.`)
    info(`Set these at your registrar: ${(zone.name_servers ?? []).join(', ')}`)
  }

  // `/workers/scripts/<name>` returns the deployed script's JavaScript, not a
  // JSON envelope, so asking for it here reported a false failure on a Worker
  // that was in fact live. The settings sub-resource answers with JSON.
  const settings = await cf(
    ctx.token,
    `/accounts/${ctx.accountId}/workers/scripts/${ctx.script}/settings`,
    { allowFailure: true },
  )
  const deployed = settings?.success !== false
  if (deployed) ok(`Worker "${ctx.script}" is deployed`)
  else warn(`Worker "${ctx.script}" not deployed yet — run the \`deploy\` step.`)

  return { zone, deployed }
}

async function stepDeploy(ctx) {
  step('Deploy')
  const env = {
    CLOUDFLARE_API_TOKEN: ctx.token,
    CLOUDFLARE_ACCOUNT_ID: ctx.accountId,
    // NEXT_PUBLIC_* is inlined by the bundler, so it has to be present for the
    // build rather than supplied as a Worker var at runtime.
    NEXT_PUBLIC_SITE_URL: SITE_URL,
    YOUTUBE_DL_SKIP_PYTHON_CHECK: '1',
  }
  run('pnpm', ['cf:build'], env)
  run('pnpm', ['exec', 'wrangler', 'deploy'], env)
  ok('Worker deployed')
}

/**
 * Upload secrets from `.env`, or only the ones named on the command line:
 *
 *   node scripts/cf-setup.mjs secrets GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
 *
 * The filter is not a convenience. Since the env files were collapsed into one
 * `.env`, a bare `secrets` pushes everything in it — including
 * `PRO_TOKEN_SECRET`, whose deployed value was set by hand and is not the one
 * on this machine. Uploading that rotates the key every session cookie and
 * access token is signed with, so every signed-in user is logged out by a
 * command that was meant to add an unrelated credential. Naming the keys is how
 * you add one secret without touching the others.
 *
 * `wrangler secret put` is the other single-key route, but it prompts on a TTY
 * and its stdin handling differs across shells; this goes through the same REST
 * call as every other step here, which behaves the same everywhere.
 */
async function stepSecrets(ctx, only = []) {
  step('Secrets')

  const wanted = new Set(only)
  const missing = only.filter((key) => !(key in ctx.env))
  if (missing.length > 0) {
    throw new SetupError(`Not in .env: ${missing.join(', ')}`)
  }

  const entries = Object.entries(ctx.env).filter(
    ([key, value]) =>
      !isLocalOnly(key) && value !== '' && (wanted.size === 0 || wanted.has(key)),
  )

  if (wanted.size > 0) {
    info(`Only: ${only.join(', ')} — nothing else in .env is touched.`)
  } else {
    warn('Pushing every secret in .env. Name keys after `secrets` to push just those.')
  }

  if (entries.length === 0) {
    info('No Worker secrets set in .env — skipping.')
    info('The site runs without them; cobalt falls back to the public instance.')
    return
  }

  for (const [name, text] of entries) {
    await cf(ctx.token, `/accounts/${ctx.accountId}/workers/scripts/${ctx.script}/secrets`, {
      method: 'PUT',
      body: { name, text, type: 'secret_text' },
    })
    // Never echo the value — this output can end up in a shared terminal log.
    ok(`${name} uploaded (${text.length} chars)`)
  }
}

async function stepZone(ctx) {
  step('Zone')

  const existing = await findZone(ctx.token, ctx.accountId)
  const zone =
    existing ??
    (await cf(ctx.token, '/zones', {
      method: 'POST',
      body: { name: APEX, account: { id: ctx.accountId }, type: 'full' },
    }))

  if (existing) ok(`Zone ${APEX} already on the account (status: ${zone.status})`)
  else ok(`Zone ${APEX} created`)

  if (zone.status === 'active') {
    ok('Nameservers already point at Cloudflare')
    return zone
  }

  console.log(
    `\n${C.bold('ACTION REQUIRED')} — at your registrar (the domain is on Namecheap:\n` +
      '  Domain List -> Manage -> Nameservers -> Custom DNS), replace both\n' +
      '  dns1/dns2.registrar-servers.com entries with:\n',
  )
  for (const ns of zone.name_servers ?? []) console.log(`      ${C.bold(ns)}`)
  console.log(
    `\n  Propagation is usually minutes, up to 24h. Cloudflare emails you when the\n` +
      `  zone goes active. Then run: ${C.bold('node scripts/cf-setup.mjs domain')}\n`,
  )
  return zone
}

async function stepDomain(ctx) {
  step('Custom domains')

  const zone = await findZone(ctx.token, ctx.accountId)
  if (!zone) {
    throw new SetupError(`Zone ${APEX} is not on this account. Run the \`zone\` step first.`)
  }
  if (zone.status !== 'active') {
    warn(`Zone ${APEX} is "${zone.status}" — Cloudflare can only attach a Worker to an active zone.`)
    info(`Waiting on the nameserver switch at the registrar: ${(zone.name_servers ?? []).join(', ')}`)
    return
  }

  // Both hostnames point at the same Worker so the bare domain stays alive
  // after the DNS move. The apex does not serve the site, though — the redirect
  // rule below sends it to www before the Worker is ever consulted.
  for (const hostname of [APEX, WWW_HOSTNAME]) {
    await cf(ctx.token, `/accounts/${ctx.accountId}/workers/domains`, {
      method: 'PUT',
      body: {
        environment: 'production',
        hostname,
        service: ctx.script,
        zone_id: zone.id,
      },
    })
    ok(`${hostname} -> Worker "${ctx.script}"`)
  }

  await stepApexRedirect(ctx, zone)

  console.log(
    `\n  Cloudflare manages the DNS records for these automatically — no manual\n` +
      '  A/CNAME needed, and the old Vercel CNAME is superseded.\n',
  )
}

/**
 * 301 the apex to www with a zone-level redirect rule.
 *
 * Serving identical content on both hostnames splits ranking signals and makes
 * every page a duplicate of itself. A rel=canonical asks search engines to
 * ignore that; a 301 means only one URL ever exists, which is strictly better
 * and also what users' bookmarks and inbound links end up storing.
 *
 * A redirect rule rather than a check inside the Worker: the
 * http_request_dynamic_redirect phase runs before Workers, so the redirect
 * costs no Worker invocation and no CPU. A Worker check could not do the job
 * anyway — static assets are matched ahead of the Worker, so an apex request
 * for a page would be answered from the asset store without the Worker ever
 * seeing it.
 *
 * The entrypoint ruleset is replaced wholesale (PUT), which is idempotent:
 * re-running produces the same single rule rather than stacking duplicates.
 */
async function stepApexRedirect(ctx, zone) {
  const rule = {
    action: 'redirect',
    description: `301 ${APEX} -> ${WWW_HOSTNAME}`,
    enabled: true,
    expression: `(http.host eq "${APEX}")`,
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: {
          expression: `concat("https://${WWW_HOSTNAME}", http.request.uri.path)`,
        },
        preserve_query_string: true,
      },
    },
  }

  try {
    await cf(
      ctx.token,
      `/zones/${zone.id}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,
      { method: 'PUT', body: { rules: [rule] } },
    )
    ok(`${APEX} 301s to ${WWW_HOSTNAME} (zone redirect rule, no Worker CPU)`)
    return
  } catch (error) {
    // The Rulesets API sits behind its own token scope ("Dynamic Redirect"),
    // which a token with plain Zone:Edit does NOT include — it answers 10000
    // Authentication error rather than 403. Fall through to Page Rules, which
    // are covered by a different scope most Workers tokens already carry.
    warn(`Redirect rule unavailable (${error.message}) — falling back to a Page Rule.`)
  }

  await apexRedirectViaPageRule(ctx, zone)
}

/**
 * The same 301, expressed as a legacy Page Rule.
 *
 * Page Rules are superseded by Redirect Rules but not deprecated, and a
 * `forwarding_url` rule is evaluated at the edge before the request reaches the
 * Worker — so this keeps the "no Worker invocation" property that made a
 * zone-level rule the right answer in the first place. The free plan allows
 * three, and this uses one.
 *
 * `$1` in the target is the Page Rules wildcard capture, so the path and query
 * carry over.
 */
async function apexRedirectViaPageRule(ctx, zone) {
  const target = `${APEX}/*`
  try {
    const existing = await cf(ctx.token, `/zones/${zone.id}/pagerules`)
    const already = (existing || []).find((r) =>
      (r.targets || []).some((t) => t?.constraint?.value === target),
    )
    if (already) {
      ok(`${APEX} 301s to ${WWW_HOSTNAME} (page rule already present)`)
      return
    }

    await cf(ctx.token, `/zones/${zone.id}/pagerules`, {
      method: 'POST',
      body: {
        targets: [
          { target: 'url', constraint: { operator: 'matches', value: target } },
        ],
        actions: [
          {
            id: 'forwarding_url',
            value: { url: `https://${WWW_HOSTNAME}/$1`, status_code: 301 },
          },
        ],
        status: 'active',
        priority: 1,
      },
    })
    ok(`${APEX} 301s to ${WWW_HOSTNAME} (page rule, no Worker CPU)`)
  } catch (error) {
    // Not fatal: the site works on both hostnames either way, and every page
    // still carries a canonical pointing at www.
    warn(`Could not create the apex redirect: ${error.message}`)
    info('Add it by hand under Rules -> Redirect Rules.')
  }
}

// --- WAF, bots and TLS ----------------------------------------------------

/**
 * Zone-level protection, ported from the sibling movies project's WAF script.
 *
 * The headline is what it turns OFF. Free-plan **Bot Fight Mode runs before the
 * WAF phases**, so no skip/allow rule can exempt anything from it — it decides
 * on its own whether a client looks automated and serves a managed challenge.
 * A challenged request never reaches this Worker and never reaches the asset
 * store either, which on this zone has already cost us, twice, in ways that
 * took a day each to diagnose:
 *
 *   - every payment-provider webhook delivery (docs/buymeacoffee-setup.md),
 *     worked around with an IP Access Rule whitelist for one AWS /24;
 *   - Google's OAuth brand-verification fetch (lessons/2026-08-15-…).
 *
 * The same mechanism challenges a crawler that Cloudflare has not verified by
 * reverse DNS, and a challenge served to Googlebot or to Search Console's
 * sitemap fetch is an unindexed page. That is the SEO cost, and it is invisible
 * — nothing in `wrangler tail` records a request that was stopped at the edge.
 *
 * What replaces it: the three custom rules below plus one rate limit, all in
 * the WAF phases, where an allowlist actually applies. Crawlers and unfurlers
 * are skipped past every product; scripted clients are challenged; the one
 * genuinely expensive endpoint is rate limited.
 *
 * Idempotent: rules are tagged with WAF_TAG in their description and replaced
 * on every run. Any hand-made rule in the zone without that prefix is kept.
 */
const WAF_TAG = '[smd-waf]'

/**
 * The crawler policy, read from the same file src/app/robots.tsx renders.
 *
 * robots.txt is a request and the WAF is the enforcement, so the two have to
 * agree: inviting a crawler in one and stopping it in the other is invisible
 * until the traffic never arrives. One file, two readers.
 *
 * Read rather than imported: this script is plain .mjs run by node with no
 * bundler and no path aliases, and it already reads wrangler.jsonc the same way.
 */
const CRAWLERS = JSON.parse(readFileSync(path.join(ROOT, 'src/config/crawlers.json'), 'utf8'))

/**
 * Never challenge these.
 *
 * `cf.client.bot` covers what Cloudflare has verified by reverse DNS — the
 * search crawlers proper. Naming them as well costs nothing and covers the lag
 * before a new crawler IP is verified. The unfurlers are never verified at all:
 * they are what renders a preview card when someone shares a page in a chat app.
 *
 * `robotsOnlyTokens` is deliberately absent — `Google-Extended` and friends are
 * policy names for robots.txt and never appear as a real user agent.
 */
const ALLOWED_BOT_UAS = [
  ...CRAWLERS.unfurlers,
  ...CRAWLERS.searchCrawlers,
  ...CRAWLERS.aiCrawlers,
]

/**
 * Scripted clients, challenged rather than blocked.
 *
 * These are the defence Bot Fight Mode was providing, expressed where it can be
 * scoped. `managed_challenge` and not `block`: a misclassified real client gets
 * a puzzle and still gets in.
 */
const JUNK_UAS = [
  'python-requests',
  'scrapy',
  'Go-http-client',
  'node-fetch',
  'axios/',
  'HeadlessChrome',
  'PhantomJS',
  'wget/',
  'curl/',
]

/**
 * `okhttp` was on that list for three hours and is deliberately not on it now.
 *
 * It challenged 58 requests to /api/download from 19 distinct residential IPs
 * across Canada, Brazil and France, at about three requests each — the shape of
 * people downloading a couple of videos, not of a scraper. okhttp is the default
 * HTTP client on Android, so anything wrapping this site in an app reaches us
 * with it, and those are users. `pnpm cf:setup health` is what surfaced it; run
 * that after touching this list.
 *
 * The abuse case okhttp was meant to cover is the rate limit's job instead.
 */

/**
 * Paths this rule must never touch: the webhook senders are exactly the kind of
 * client it describes. Buy Me a Coffee posts from AWS as `BMC-HTTPS-ROBOT` and
 * the other provider posts with an `axios` user agent, and both verify an HMAC
 * over their own body before a byte is trusted — they do not need UA screening
 * and cannot survive it.
 */
const WEBHOOK_PATH_PREFIX = '/api/billing/'

/**
 * Extensions nothing here serves. `out/` contains no .php/.asp/.jpg at all —
 * checked, not assumed — so no real request can match, and every hit is a
 * vulnerability scan.
 *
 * This saves no Worker CPU: `not_found_handling: "404-page"` already answers
 * these from the asset store without invoking the Worker (see
 * cloudflare/worker.js). It is here to keep the scans out of the analytics that
 * the rest of these rules are read against.
 */
const PROBE_EXTENSIONS = ['.php', '.asp', '.aspx', '.cgi', '.env', '.sql', '.bak']

const orUserAgent = (fragments) =>
  fragments.map((f) => `(http.user_agent contains "${f}")`).join(' or ')

const WAF_RULES = [
  {
    description: `${WAF_TAG} block extensions this site never serves`,
    expression: PROBE_EXTENSIONS.map(
      (ext) => `ends_with(http.request.uri.path, "${ext}")`,
    ).join(' or '),
    action: 'block',
  },
  {
    // The other half of robots.txt's Disallow list. Those lines are a request,
    // and the crawlers worth naming there are precisely the ones known for
    // ignoring it — CCBot and Bytespider most of all. This is the same list,
    // enforced. `block` rather than a challenge: none of them can solve one, so
    // a challenge is only a slower block that costs the edge more work.
    //
    // Ahead of the allow rule, and that ordering is load-bearing. Cloudflare
    // verifies several of these by reverse DNS — Amazonbot, AhrefsBot,
    // SemrushBot and Bytespider are all "verified bots" — so `cf.client.bot`
    // below is TRUE for them, and behind the allow rule this would never fire on
    // most of the list it was written for. Verified means "who it claims to be",
    // not "welcome here".
    description: `${WAF_TAG} block the scrapers robots.txt disallows`,
    expression: orUserAgent(CRAWLERS.disallowedScrapers),
    action: 'block',
  },
  {
    // Skips the rest of the ruleset: everything below only ever sees traffic
    // that is not already trusted.
    description: `${WAF_TAG} allow verified bots, unfurlers and search crawlers`,
    expression: `(cf.client.bot) or ${orUserAgent(ALLOWED_BOT_UAS)}`,
    action: 'skip',
    action_parameters: {
      ruleset: 'current',
      phases: ['http_ratelimit', 'http_request_sbfm'],
      products: ['bic', 'hot', 'rateLimit', 'securityLevel', 'uaBlock', 'waf', 'zoneLockdown'],
    },
  },
  {
    description: `${WAF_TAG} challenge scripted clients`,
    expression:
      `((${orUserAgent(JUNK_UAS)}) or (http.user_agent eq ""))` +
      ` and not starts_with(http.request.uri.path, "${WEBHOOK_PATH_PREFIX}")`,
    action: 'managed_challenge',
  },
]

/**
 * The only endpoint worth rate limiting.
 *
 * A page view is a static asset and costs nothing; /api/download is the one
 * that spends an extractor call, an upstream quota and real Worker CPU per hit.
 * 30 requests per 10 s per IP is far above any human — a person pastes one link
 * at a time — and well below what makes the endpoint someone else's free API.
 *
 * Free-plan limits shape the rest: one rate-limit rule per zone (so this
 * replaces whatever is there, including Cloudflare's default "leaked
 * credentials" rule), a 10 s window, `block` as the only action, and no regex
 * in the expression — `starts_with` is what there is.
 */
const RATE_LIMIT_RULE = {
  description: `${WAF_TAG} rate limit the extractor endpoint`,
  expression: 'starts_with(http.request.uri.path, "/api/download")',
  action: 'block',
  ratelimit: {
    characteristics: ['ip.src', 'cf.colo.id'],
    period: 10,
    requests_per_period: 30,
    mitigation_timeout: 10,
  },
}

/** A phase entrypoint is created on first use; Cloudflare 404s it until then. */
async function phaseEntrypoint(token, zoneId, phase) {
  const existing = await cf(token, `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, {
    allowFailure: true,
  })
  if (existing.success) return existing.result

  return cf(token, `/zones/${zoneId}/rulesets`, {
    method: 'POST',
    body: { name: `smd-${phase}`, kind: 'zone', phase, rules: [] },
  })
}

/** Strips the fields the API returns but rejects on write (id, version, ref…). */
function writableRule(rule) {
  return {
    description: rule.description,
    expression: rule.expression,
    action: rule.action,
    enabled: rule.enabled !== false,
    ...(rule.action_parameters ? { action_parameters: rule.action_parameters } : {}),
    ...(rule.ratelimit ? { ratelimit: rule.ratelimit } : {}),
  }
}

/**
 * Replaces our tagged rules in a phase, keeping every other rule in place.
 * `replaceAll` is for the rate-limit phase, where the free plan allows exactly
 * one rule and an untagged leftover would take the slot.
 */
async function putPhaseRules(token, zoneId, phase, rules, { replaceAll = false } = {}) {
  const ruleset = await phaseEntrypoint(token, zoneId, phase)
  const kept = replaceAll
    ? []
    : (ruleset.rules ?? [])
        .filter((r) => !(r.description ?? '').startsWith(WAF_TAG))
        .map(writableRule)

  await cf(token, `/zones/${zoneId}/rulesets/${ruleset.id}`, {
    method: 'PUT',
    body: {
      name: ruleset.name,
      description: ruleset.description ?? '',
      kind: ruleset.kind,
      phase: ruleset.phase,
      rules: [...rules.map(writableRule), ...kept],
    },
  })
}

async function stepWaf(ctx) {
  step('WAF, bots and TLS')

  const zone = await findZone(ctx.token, ctx.accountId)
  if (!zone) throw new SetupError(`Zone ${APEX} is not on this account. Run the \`zone\` step first.`)

  // Each group below needs a different token permission, so one missing scope
  // must not stop the others — a gap in the TLS scope should not cost the WAF
  // rules. But a gap in the WAF or bot scopes is different in kind: the whole
  // point of the step is that those get applied, so `core` groups also decide
  // the exit code. Warning and exiting 0 would let the weekly workflow report
  // success while applying nothing, which is exactly how a token edit that
  // silently dropped two permissions went unnoticed for an hour.
  const failed = []
  const coreFailed = []
  const task = async (label, fn, { core = false } = {}) => {
    try {
      await fn()
      ok(label)
      return true
    } catch (error) {
      warn(`${label} — skipped: ${error.message}`)
      failed.push({ label, message: error.message })
      if (core) coreFailed.push(label)
      return false
    }
  }

  /**
   * A permission gap and a failed request read the same in the log, and the
   * advice for them is opposite: widen the token, or just run it again. A run
   * that lost TLS and the purge to two `fetch failed` errors was reported as a
   * missing scope, which is a wrong turn worth not repeating.
   */
  const looksLikeScope = (message) => /10000|Authentication|403|permission/i.test(message)

  await task(
    'Custom rules: probes blocked, crawlers allowed, scripts challenged',
    () => putPhaseRules(ctx.token, zone.id, 'http_request_firewall_custom', WAF_RULES),
    { core: true },
  )

  await task(
    'Rate limit: 30 req/10s per IP on /api/download',
    () => putPhaseRules(ctx.token, zone.id, 'http_ratelimit', [RATE_LIMIT_RULE], { replaceAll: true }),
    { core: true },
  )

  // Bot Fight Mode off, and two settings that ride along with it.
  //
  // `enable_js` (JavaScript Detections) injects /cdn-cgi/challenge-platform/…
  // /jsd/main.js into every HTML response to compute a bot score. Nothing here
  // reads that score — the rules above classify on user agent and
  // `cf.client.bot` — and the score itself is a paid Bot Management feature. It
  // is a script every real visitor downloads and executes to feed a signal no
  // rule consults, on a site whose whole performance story is that a page view
  // runs no code. It also cannot be removed by toggling alone: the tag is baked
  // into cached HTML, so purge the cache after this runs.
  //
  // `is_robots_txt_managed` is on by default and does not merge: the edge
  // serves Cloudflare's own /robots.txt in place of the exported one, so
  // src/app/robots.tsx might as well not exist — and Cloudflare's version has no
  // `Sitemap:` line, which is most of why robots.txt is served at all.
  const botsOk = await task(
    'Bot Fight Mode, JS detections and managed robots.txt off',
    () =>
      cf(ctx.token, `/zones/${zone.id}/bot_management`, {
        method: 'PUT',
        body: { fight_mode: false, enable_js: false, is_robots_txt_managed: false },
      }),
    { core: true },
  )

  // Separate call on purpose: `ai_bots_protection` is newer than the three
  // above and a rejection of this field must not take Bot Fight Mode's `false`
  // down with it.
  //
  // Set to `disabled`, which is the opposite of what the movies project does,
  // because this site wants AI crawlers: robots.tsx allows GPTBot,
  // PerplexityBot and ClaudeBot by name and there is an /llms.txt. Edge
  // enforcement here would silently overrule both.
  await task('AI crawler blocking off (this site invites them — see robots.tsx)', () =>
    cf(ctx.token, `/zones/${zone.id}/bot_management`, {
      method: 'PUT',
      body: { ai_bots_protection: 'disabled' },
    }),
  )

  // TLS. All three are free-plan zone settings and idempotent.
  //   min_tls_version 1.2 — the default keeps TLS 1.0/1.1 handshakes alive for
  //     a site with no legacy clients.
  //   ssl 'strict' — Full (Strict). The origin is this Worker on a Custom
  //     Domain, so strict cannot break the origin leg.
  //   HSTS 6 months + includeSubDomains, deliberately without preload: max_age
  //     is what browsers latch onto and preload is the part that is genuinely
  //     hard to undo.
  await task('TLS: min 1.2, Full (Strict), HSTS 6mo', async () => {
    const settings = [
      ['min_tls_version', '1.2'],
      ['ssl', 'strict'],
      [
        'security_header',
        {
          strict_transport_security: {
            enabled: true,
            max_age: 15552000,
            include_subdomains: true,
            preload: false,
            nosniff: true,
          },
        },
      ],
    ]
    for (const [id, value] of settings) {
      await cf(ctx.token, `/zones/${zone.id}/settings/${id}`, { method: 'PATCH', body: { value } })
    }
  })

  // Cloudflare bakes the JS-detections script into the HTML it has already
  // stored, so turning the setting off changes nothing a visitor sees until the
  // cache is dropped. That cost a day once (see the OAuth brand-verification
  // lesson), which is why this is a step and not a sentence in a README.
  if (botsOk) {
    const purged = await task('Zone cache purged (the JS-detections tag lives in cached HTML)', () =>
      cf(ctx.token, `/zones/${zone.id}/purge_cache`, {
        method: 'POST',
        body: { purge_everything: true },
      }),
    )
    if (!purged) info('Purge by hand: dashboard -> Caching -> Configuration -> Purge Everything.')
  }

  const scopeGaps = failed.filter((f) => looksLikeScope(f.message))
  if (scopeGaps.length > 0) {
    warn(`${scopeGaps.length} of the above need a token scope this token does not have.`)
    info('Per group: Zone WAF: Edit, Bot Management: Edit, Zone Settings: Edit, Cache Purge.')
    info('Editing a token in the dashboard REPLACES its permission set — re-check every row.')
  }
  if (failed.length > scopeGaps.length) {
    warn(`${failed.length - scopeGaps.length} failed for another reason — re-run before reading anything into it.`)
  }
  info('Now run `pnpm cf:health` — it is the only thing that can see who the edge stopped.')

  if (coreFailed.length > 0) {
    // Non-zero so the weekly workflow goes red. The rules already on the zone
    // keep working — this says they could not be re-applied, not that they are
    // gone.
    warn(`${coreFailed.length} of those were the point of this step. Nothing was re-applied.`)
    process.exitCode = 1
  }
}

// --- edge health ----------------------------------------------------------

/**
 * What the WAF rules actually did, read back from the zone's firewall events.
 *
 * This exists because a rule that stops the wrong client leaves no trace
 * anywhere else. The request never reaches the Worker, so `wrangler tail` is
 * silent; it never reaches the asset store, so there is no access log; and the
 * sender sees a Cloudflare challenge page rather than an error worth reporting.
 * The zone's own event log is the only witness, and nothing consults it unless
 * asked.
 *
 * It has already earned its place. The first run after the rules went live
 * showed `okhttp/4.12.0` — the default Android HTTP client — challenged 58 times
 * on /api/download from 19 residential IPs in three countries. That was real
 * people, stopped by a user-agent list written from a scraper's point of view.
 *
 * `firewallEventsAdaptiveGroups` (the aggregated dataset) is not available on
 * the free plan and the raw query is capped at a 24 hour span, so this fetches
 * raw events and counts them here.
 */
const HEALTH_HOURS = 23.5

/**
 * Clients whose challenge or block is a defect, not a defence.
 *
 * Search crawlers first: a challenge to one of these is an unindexed page. Then
 * this project's own senders — `indexnow` submits the deployed sitemap after
 * every deploy and swallows its own failures, so it fails silently by design;
 * the webhook robots pay for support that never gets granted.
 */
const HEALTH_MUST_PASS = [
  /googlebot/i,
  /google-inspectiontool|googleagent|^google$/i,
  /bingbot|duckduckbot|yandexbot|applebot|baiduspider/i,
  /gptbot|oai-searchbot|chatgpt-user|perplexity|claudebot|anthropic/i,
  /facebookexternalhit|twitterbot|telegrambot|whatsapp|discordbot|linkedinbot|slackbot/i,
  /socialdownloader-indexnow/i,
  /bmc-https-robot|creem/i,
]

/**
 * Every browser user agent is mostly the same forty characters of history, and
 * the one token that identifies the client is buried in the middle of them.
 * Cutting the string to fit a terminal keeps the boilerplate and drops the
 * identity: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like
 * Gecko) HeadlessChrome/151.0.0.0 Safari/537.36` was read here as an ordinary
 * desktop Chrome for a whole session, and `HeadlessChrome` is the entire
 * reason the rule fired on it.
 *
 * So the boilerplate goes first and the remainder is elided from the middle,
 * because the platform is at the front and the client at the tail.
 */
const UA_BOILERPLATE = [
  /^Mozilla\/5\.0 /,
  / AppleWebKit\/[\d.]+ \(KHTML, like Gecko\)/,
  / Safari\/[\d.]+$/,
  / Version\/[\d.]+/,
]

function shortAgent(agent, width = 64) {
  let short = agent
  for (const pattern of UA_BOILERPLATE) short = short.replace(pattern, '')
  short = short.trim() || agent
  if (short.length <= width) return short
  return `${short.slice(0, width - 29)}…${short.slice(-28)}`
}

const STOPPED_ACTIONS = new Set(['block', 'managed_challenge', 'challenge', 'jschallenge', 'drop'])

/**
 * Mechanisms that are switched off, so their events can only predate the switch.
 *
 * `botFight` is the whole reason stepWaf exists. Its events are still the most
 * useful thing in the window — they are the evidence of what it was stopping —
 * but they cannot recur, so they are printed as history rather than counted as
 * failures. If one ever appears with a timestamp after the last `waf` run,
 * something turned Bot Fight Mode back on in the dashboard.
 */
const HISTORICAL_SOURCES = new Set(['botFight'])

async function graphql(token, query) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const payload = await response.json()
  if (payload.errors?.length) {
    const detail = payload.errors.map((e) => e.message).join('; ')
    throw new SetupError(
      `${detail}\n  Needs Zone -> Analytics: Read on the token — a scope of its own, ` +
        'separate from the WAF ones.',
    )
  }
  return payload.data
}

async function stepHealth(ctx) {
  step('Edge health (last 24h of firewall events)')

  const zone = await findZone(ctx.token, ctx.accountId)
  if (!zone) throw new SetupError(`Zone ${APEX} is not on this account.`)

  const since = new Date(Date.now() - HEALTH_HOURS * 3600_000).toISOString()
  const data = await graphql(
    ctx.token,
    `query { viewer { zones(filter: { zoneTag: "${zone.id}" }) {
        firewallEventsAdaptive(
          limit: 1000
          filter: { datetime_gt: "${since}" }
          orderBy: [datetime_DESC]
        ) { datetime action source clientRequestPath userAgent clientIP }
      } } }`,
  )

  const events = data.viewer.zones[0]?.firewallEventsAdaptive ?? []
  if (events.length === 0) {
    ok('No firewall events at all in the window — nothing was stopped at the edge.')
    return
  }
  info(`${events.length} events (the raw dataset caps at 1000; older ones fall off first)`)

  // Grouped by what a human would act on: who was stopped, by which mechanism,
  // and from how many distinct addresses. The IP count is the tell — a handful
  // of datacenter addresses is a scraper, dozens of residential ones are users.
  const groups = new Map()
  for (const event of events) {
    const agent = event.userAgent || '(no user agent)'
    const key = `${event.action} ${event.source} ${agent}`
    const group = groups.get(key) ?? { action: event.action, source: event.source, agent, ips: new Set(), paths: new Set(), count: 0 }
    group.count += 1
    group.ips.add(event.clientIP)
    group.paths.add(event.clientRequestPath)
    groups.set(key, group)
  }

  const stopped = [...groups.values()]
    .filter((g) => STOPPED_ACTIONS.has(g.action))
    .sort((a, b) => b.count - a.count)

  if (stopped.length === 0) {
    ok('Nothing was blocked or challenged in the window.')
  }

  const mustPass = []
  let historical = 0
  for (const group of stopped) {
    const line =
      `${String(group.count).padStart(4)}  ${group.action.padEnd(18)} ${group.source.padEnd(15)} ` +
      `${group.ips.size} IP${group.ips.size === 1 ? ' ' : 's'}  ${shortAgent(group.agent).padEnd(64)}  ` +
      C.dim([...group.paths].slice(0, 2).join(' '))
    const shouldPass = HEALTH_MUST_PASS.some((pattern) => pattern.test(group.agent))

    if (HISTORICAL_SOURCES.has(group.source)) {
      historical += 1
      console.log(C.dim(`  ${line}  (before Bot Fight Mode was turned off)`))
      continue
    }
    if (shouldPass) {
      mustPass.push(group)
      console.log(`${C.red('✗')} ${line}`)
      continue
    }
    console.log(`  ${line}`)
  }

  console.log('')
  if (historical > 0) {
    info(`${historical} group(s) dimmed above are Bot Fight Mode's, from before it was disabled.`)
  }
  if (mustPass.length > 0) {
    warn(`${mustPass.length} of those must never be stopped — crawler or first-party sender.`)
    info('Fix the rule that names them (WAF_RULES / JUNK_UAS above), then re-run `waf`.')
    process.exitCode = 1
    return
  }
  ok('No search crawler and no first-party sender was stopped by a live rule.')
  info('Residential IP counts in double digits are users, not scrapers — check before shrugging.')
}

// --- entry point ----------------------------------------------------------

async function main() {
  const command = process.argv[2] ?? 'check'
  const ctx = await resolveContext()

  if (command === 'check') {
    await stepCheck(ctx)
    return
  }
  if (command === 'deploy') {
    await stepDeploy(ctx)
    return
  }
  if (command === 'secrets') {
    await stepSecrets(ctx, process.argv.slice(3))
    return
  }
  if (command === 'zone') {
    await stepZone(ctx)
    return
  }
  if (command === 'domain') {
    await stepDomain(ctx)
    return
  }
  if (command === 'waf') {
    await stepWaf(ctx)
    return
  }
  if (command === 'health') {
    await stepHealth(ctx)
    return
  }
  if (command === 'all') {
    const status = await stepCheck(ctx)
    // Deploy before secrets: the secrets endpoint targets a script that has to
    // exist. Redeploying later does not clear them.
    if (!status.deployed) await stepDeploy(ctx)
    else info('Worker already deployed — skipping build. Use `deploy` to force one.')
    await stepSecrets(ctx)
    const zone = await stepZone(ctx)
    if (zone.status === 'active') {
      await stepDomain(ctx)
      await stepWaf(ctx)
    }
    return
  }

  throw new SetupError(
    `Unknown command "${command}". Expected one of: check, deploy, secrets, zone, domain, waf, all`,
  )
}

main().catch((error) => {
  const message = error instanceof SetupError ? error.message : (error.stack ?? String(error))
  console.error(`\n${C.red('✗')} ${message}\n`)
  process.exitCode = 1
})
