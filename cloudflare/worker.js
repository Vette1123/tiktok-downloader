/**
 * Cloudflare Worker entrypoint.
 *
 * The site itself is static. `next build` exports every page, image, icon,
 * robots.txt and sitemap.xml to `out/`, wrangler uploads that as Workers Static
 * Assets, and Cloudflare matches those before this Worker is invoked at all —
 * so a page view runs no code here, costs nothing against the 10 ms per-request
 * CPU budget, and does not count toward the 100k requests/day free-plan cap.
 *
 * What is left for this file is the part that genuinely cannot be static: the
 * /api/* handlers, which resolve a pasted link with a live extractor call.
 *
 * The handlers come from src/lib/apiRoutes.ts, written against plain
 * Request/Response. The App Router files under src/app/api/ wrap those same
 * functions, so `next dev` and any Node host exercise exactly this code — the
 * two paths cannot drift.
 *
 * Deliberately plain JavaScript, not TypeScript: tsconfig.json includes
 * `**\/*.ts`, and a `.ts` entrypoint here would be type-checked as part of the
 * app while actually targeting the workerd runtime.
 */

import { API_ROUTES } from '../src/lib/apiRoutes'

/**
 * There is deliberately no 404 handling here.
 *
 * `not_found_handling: "404-page"` in wrangler.jsonc makes the asset router
 * answer every unmatched path with out/404.html directly, without invoking this
 * Worker — verified against the deployment, including the vulnerability scans
 * (/wp-login.php, /.env, /vendor/…) that make up most of a public site's 404s.
 * Those used to be the single most expensive thing this Worker did, at up to
 * 116 ms of CPU each; they now cost none at all.
 *
 * `run_worker_first: ["/api/*"]` is what keeps API requests from being
 * swallowed by that same rule, and is the only reason this Worker is reachable.
 */

/**
 * The one path the workers.dev hostname is allowed to serve.
 *
 * Cloudflare's Bot Fight Mode is a *zone* feature, so it challenges Creem's
 * webhook POSTs to the custom domain — they arrive from an AWS address with an
 * `axios` user agent, which is exactly what it is built to stop, and it offers
 * no per-path exception on the free plan. Every delivery came back as a
 * `managed_challenge` and never reached this Worker, which is why webhooks had
 * to be treated as unreliable and reconcile did all the real work.
 *
 * The workers.dev hostname is not in that zone, so it is not challenged. Creem
 * points at it instead. That is the whole reason it is load-bearing.
 *
 * But an origin that skips the zone's bot protection must not also be a second
 * front door to everything else: `/api/download` would be reachable with no
 * protection at all, and the entire static site would be served from a second
 * hostname as duplicate content. So this host serves the one endpoint that
 * verifies an HMAC over its own body before it trusts a single byte, and sends
 * everything else to the canonical origin.
 */
const WEBHOOK_PATH = '/api/billing/webhook'
function isWorkersDev(hostname) {
  return hostname.endsWith('.workers.dev')
}

/** HEAD is served by the GET handler, as it is for any ordinary route. */
function methodMatches(requestMethod, routeMethod) {
  if (requestMethod === routeMethod) return true
  return routeMethod === 'GET' && requestMethod === 'HEAD'
}

/**
 * 405 for a known path called with the wrong verb.
 *
 * Without this the request would fall through to the asset store and come back
 * as the 404 page, which is a confusing thing to hand an API client.
 */
function methodNotAllowed(routeMethod) {
  const allow = routeMethod === 'GET' ? 'GET, HEAD' : routeMethod
  return Response.json(
    { success: false, error: `Method not allowed. Use ${allow}.` },
    { status: 405, headers: { Allow: allow } },
  )
}

const worker = {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> } }} env
   * @param {{ waitUntil: (promise: Promise<unknown>) => void }} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Checked before routing, so nothing else on this hostname is ever
    // dispatched — see WEBHOOK_PATH. 301 rather than 404 so a crawler that has
    // already found the workers.dev copy is told where the real page lives.
    // The upstream project redirected its workers.dev hostname to the
    // upstream author's domain. A fork must stay usable on its own hostname.
    // Operators with a custom domain can opt back into that behaviour by
    // setting CANONICAL_ORIGIN in the Worker environment.
    const canonicalOrigin = String(env.CANONICAL_ORIGIN || '').replace(/\/$/, '')
    if (
      canonicalOrigin &&
      isWorkersDev(url.hostname) &&
      url.pathname !== WEBHOOK_PATH
    ) {
      return Response.redirect(`${canonicalOrigin}${url.pathname}${url.search}`, 301)
    }

    const route = API_ROUTES[url.pathname]
    if (route) {
      if (!methodMatches(request.method, route.method)) {
        return methodNotAllowed(route.method)
      }
      // `ctx` is forwarded so a handler can defer work past the response —
      // /api/download writes its edge-cache entry that way, keeping the cache
      // write off the client's critical path. Handlers that don't need it
      // ignore the extra argument.
      //
      // `env` carries the D1 binding. Handlers that do not need it ignore the
      // extra argument, exactly as they already do with `ctx`.
      return route.handler(request, ctx, env)
    }

    // An /api/* path with no handler — the only thing that reaches here, since
    // everything else is matched or 404'd by the asset router first. The
    // binding applies the same rules as the edge, so this is the styled 404
    // page with a 404 status.
    return env.ASSETS.fetch(request)
  },
}

export default worker
