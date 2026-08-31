import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Mostly the pure modules: offer selection, license tokens, the batch queue,
// billing. Components are still covered by `pnpm lint && pnpm build` plus
// scripts/cf-smoke.mjs rather than a renderer — there is deliberately no jsdom
// environment and no React plugin, so the runner stays instant.
//
// The `@` alias is resolved because a couple of pure functions worth testing sit
// in a component file and it imports its siblings that way. Importing such a
// module only evaluates its top level, which is why this needs no DOM: a test
// that actually rendered one would need jsdom, and none does.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    passWithNoTests: true,
  },
})
