import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * The Worker bundle must stay free of import cycles.
 *
 * This is a CPU test wearing a lint test's clothes. wrangler emits one file, so
 * V8 parses the whole bundle on every new isolate — and at this traffic level
 * nearly every request creates one, which is why the deployed cpuTimeP50 sat
 * within noise of the locally measured startup cost. When esbuild meets a cycle
 * it stops flattening those modules into the bundle's top level and wraps them
 * in init closures instead; V8 pre-parses a closure body at startup and then
 * fully compiles it the moment it is called, so a cycle whose entry is called
 * at top level gets paid for twice.
 *
 * Measured when `requireDb` still lived in apiRoutes.ts and put it in a cycle
 * with auth/routes and the billing handlers (median of 31 interleaved runs of
 * the real bundle):
 *
 *   in a cycle   106.0 KiB   compile 2.85   evaluate 2.44   5.29 ms
 *   flat         104.9 KiB   compile 3.02   evaluate 0.46   3.48 ms
 *
 * A third of isolate startup, for two declarations sitting in the wrong file.
 * Nothing else in the toolchain notices — types, tests, lint and the byte
 * budget were all green with the cycle in place — so the check lives here.
 */

const ROOT = resolve(__dirname, '..', '..')
const ENTRY = 'src/lib/apiRoutes.ts'

/** Static `import ... from './x'` specifiers only — a dynamic import is exactly the escape hatch that makes a cycle harmless. */
function staticImports(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const withoutDynamic = source.replace(/\bimport\s*\(/g, 'DYNAMIC(')
  const specifiers: string[] = []
  // Statement-shape agnostic. An earlier line-anchored regex walked straight
  // past every multi-line import list, which is most of them in this codebase —
  // it reported a clean graph while the cycle it exists to catch was in place.
  for (const match of withoutDynamic.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
    specifiers.push(match[1])
  }
  return specifiers
}

/** Resolve a relative specifier to a repo-relative .ts path, or null for a package. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = join(dirname(join(ROOT, fromFile)), specifier)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate.slice(ROOT.length + 1).split(String.fromCharCode(92)).join('/')
  }
  return null
}

function findCycle(entry: string): string[] | null {
  const onStack: string[] = []
  const inStack = new Set<string>()
  const done = new Set<string>()

  function walk(file: string): string[] | null {
    if (inStack.has(file)) return [...onStack.slice(onStack.indexOf(file)), file]
    if (done.has(file)) return null
    onStack.push(file)
    inStack.add(file)
    for (const specifier of staticImports(file)) {
      const target = resolveSpecifier(file, specifier)
      if (!target) continue
      const cycle = walk(target)
      if (cycle) return cycle
    }
    onStack.pop()
    inStack.delete(file)
    done.add(file)
    return null
  }

  return walk(entry)
}

describe('worker bundle imports', () => {
  it('has no static import cycle reachable from the API route table', () => {
    const cycle = findCycle(ENTRY)
    expect(cycle?.join(' -> ') ?? null).toBe(null)
  })
})
