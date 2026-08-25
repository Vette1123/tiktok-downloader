#!/usr/bin/env node
/**
 * Guards the Worker's isolate-startup CPU cost.
 *
 * Cloudflare bills startup — parsing, compiling and evaluating the entire
 * bundle — to whichever request happened to create the isolate, and a new
 * isolate is created constantly rather than once per deploy. So it is not a
 * cold-start cost that amortises: it is a tax charged at random to real
 * visitors, against a 10 ms per-request budget on the free plan.
 *
 * Two things follow, and this script checks both.
 *
 *   1. **Bundle bytes are the lever.** wrangler emits one file, so V8 compiles
 *      everything on startup whether or not a request ever calls into it — a
 *      dynamic `import()` defers evaluation but not compilation. Trimming the
 *      bundle is therefore the only thing that reliably moves startup, and the
 *      byte budget below is what keeps a dependency from quietly undoing it.
 *      (This is not hypothetical: `arctic` shipped a client for every OAuth
 *      provider it supports to give us Google, 123 KB — 41% of the bundle —
 *      and cost 1.8 ms of every cold isolate.)
 *
 *   2. **The measurement needs no deploy.** workerd and Node run the same V8,
 *      so compiling the real deployed bundle here is a good proxy. The
 *      milliseconds are reported but never gated: CI runners are too noisy for
 *      a timing threshold, and a flaky deploy gate is worse than none.
 *
 * Run: pnpm cf:startup [outdir]
 */

import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

/**
 * 231 KiB against 230.4 KiB shipped by the private-access + Facebook Cookie
 * build.
 *
 * The signed web session, protected Shortcuts API, request throttles and
 * platform-specific Cookie gate add no dependencies. The current bundle
 * measured 3.61 ms total startup in CI (2026-08-25), still comfortably inside
 * the free plan's 10 ms request CPU budget. The remaining margin continues to
 * catch an accidental dependency or a large parser table.
 */
const MAX_BUNDLE_BYTES = 231 * 1024

/** wrangler rejects the upload past this on the free plan. */
const MAX_GZIPPED_BYTES = 3 * 1024 * 1024

const outDir = process.argv[2] ?? '.worker-size-check'
const entry = readdirSync(outDir).find((name) => name.endsWith('.js'))
if (!entry) {
  console.error(`  worker-startup: no bundle in ${outDir}/ — run wrangler deploy --dry-run first.`)
  process.exit(1)
}

const source = readFileSync(join(outDir, entry), 'utf8')
const bytes = Buffer.byteLength(source)
const gzipped = gzipSync(source, { level: 9 }).length

/**
 * Compile and evaluate the bundle the way an isolate would.
 *
 * The globals are stubs, and deliberately so: nothing here runs a request, it
 * only pays the module-scope cost. The median of several runs drops the first
 * one, which carries V8's own warm-up.
 */
async function measure(runs = 7) {
  const context = vm.createContext({
    console, URL, Response, Request, Headers, fetch, crypto, performance,
    TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout,
    caches: { default: { match: async () => undefined, put: async () => {} } },
    process: { env: {} },
  })

  // The only externals are the node: built-ins nodejs_compat provides.
  const link = async (specifier) => {
    const real = await import(specifier)
    const names = Object.keys(real)
    const stub = new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, real[name])
    }, { context })
    await stub.link(() => {})
    await stub.evaluate()
    return stub
  }

  const compile = []
  const evaluate = []
  for (let run = 0; run < runs; run++) {
    const start = performance.now()
    const bundle = new vm.SourceTextModule(source, { context, identifier: `worker-${run}.js` })
    const compiled = performance.now()

    // Linking is timed out of the result deliberately. It resolves the bundle's
    // `node:*` imports by pulling the real built-ins through Node's ESM loader
    // and wrapping each in a SyntheticModule — pure harness overhead, and the
    // dominant cost here. workerd has those built-ins already; it does no such
    // work. Counting it (as an earlier version of this script did) inflated
    // "evaluate" from ~0.1 ms to ~1.3 ms and invented a hotspot that a CPU
    // profile then failed to find anywhere in our own modules.
    await bundle.link(link)

    const linked = performance.now()
    await bundle.evaluate()
    compile.push(compiled - start)
    evaluate.push(performance.now() - linked)
  }

  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  return { compile: median(compile), evaluate: median(evaluate) }
}

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`
const { compile, evaluate } = await measure()

console.log(
  [
    '',
    `  Worker startup (${outDir}/${entry})`,
    `    bundle    ${kib(bytes)} raw, ${kib(gzipped)} gzipped`,
    `    compile   ${compile.toFixed(2)} ms`,
    `    evaluate  ${evaluate.toFixed(2)} ms`,
    `    startup   ${(compile + evaluate).toFixed(2)} ms  (billed to the request that creates the isolate)`,
    '',
  ].join('\n'),
)

if (gzipped > MAX_GZIPPED_BYTES) {
  console.error(`::error::Worker bundle is ${kib(gzipped)} gzipped, over the ${kib(MAX_GZIPPED_BYTES)} free-plan upload limit.`)
  process.exit(1)
}

if (bytes > MAX_BUNDLE_BYTES) {
  console.error(
    `::error::Worker bundle is ${kib(bytes)}, over the ${kib(MAX_BUNDLE_BYTES)} startup-CPU budget. ` +
      'Every byte here is compiled on each new isolate and billed to a real request.',
  )
  process.exit(1)
}
