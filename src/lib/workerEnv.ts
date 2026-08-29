/**
 * The Worker's `env` bindings, and the guard every binding-backed handler uses.
 *
 * This lives in its own leaf module rather than in apiRoutes.ts — where it used
 * to be — for a reason that is entirely about startup CPU, not about tidiness.
 *
 * auth/routes.ts and the four billing handlers need `requireDb`, and
 * apiRoutes.ts imports all of them to build API_ROUTES. That was a cycle, and
 * esbuild answers a cycle by wrapping the modules in `__esm(...)` init
 * closures instead of flattening them into the bundle's top level. A closure
 * body is lazily parsed and then fully compiled the moment it is called — and
 * `init_apiRoutes()` is called at top level, so the bundle paid for the same
 * ~28 KiB twice: once pre-parsed at compile, once compiled at evaluation.
 *
 * Measured on the real bundle (median of 31 interleaved runs):
 *
 *   in the cycle    99.5 KiB   compile 2.86   evaluate 2.08   4.94 ms
 *   flat            (see lessons/2026-08-29-worker-cpu-seo-marketing.md)
 *
 * Every new isolate pays that, and at this traffic level nearly every request
 * creates one — prod cpuTimeP50 was 5.76 ms against a locally measured 5.76 ms
 * of pure startup. So a cycle here is not a style question.
 *
 * Keep this module a leaf: no imports except types.
 */
import type { D1Database } from '@cloudflare/workers-types'

/**
 * D1 and any other binding live on the Worker's `env`, which is only available
 * to the Cloudflare entrypoint. The Next App Router wrappers under src/app/api
 * call these same functions with no `env`, so a handler that needs a binding
 * must degrade rather than throw — see `requireDb`.
 */
export interface WorkerEnv {
  DB?: D1Database
}

/**
 * The 503 a binding-backed route answers when it is running somewhere without
 * that binding — `next dev`, or a misconfigured deployment. Mirrors the shape
 * `nativeMediaUnavailable` uses for the same class of "not available here".
 */
export function requireDb(env?: WorkerEnv): D1Database | Response {
  if (!env?.DB) {
    return Response.json(
      { success: false, error: 'Accounts are not configured on this deployment.' },
      { status: 503 },
    )
  }
  return env.DB
}
