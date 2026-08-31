/**
 * Through the door: the script is spawned against a throwaway git repo, so the
 * test exercises the same path CI does — parse, group, count, tag — rather than
 * importing pieces that would then be free to drift from the executable.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./release-notes.mjs', import.meta.url))

let repo

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

/** One empty commit per subject, oldest first. */
function commit(...subjects) {
  for (const subject of subjects) git('commit', '--allow-empty', '-m', subject)
}

/** Runs the script the way the workflow does, and returns notes plus outputs. */
function run() {
  const outputFile = path.join(repo, 'github-output')
  writeFileSync(outputFile, '')
  const notes = execFileSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
      GITHUB_REPOSITORY: 'owner/repo',
    },
  })
  const outputs = Object.fromEntries(
    readFileSync(outputFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('='))
  )
  return { notes, outputs }
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'release-notes-'))
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

it('lists user-visible commits by scope and counts the rest in one line', () => {
  commit(
    'feat(download): add a thing',
    'fix: stop the other thing',
    'perf(worker): make it quicker',
    'docs(readme): explain it',
    'chore: bump a dependency',
    'not a conventional subject at all'
  )

  const { notes, outputs } = run()

  expect(notes).toContain('### New\n\n- **download** — add a thing')
  expect(notes).toContain('### Fixed\n\n- stop the other thing')
  expect(notes).toContain('### Faster\n\n- **worker** — make it quicker')
  // The unparseable subject is dropped rather than counted: it is not a commit
  // this repo's conventions can say anything about.
  expect(notes).toContain('_Plus 2 internal changes')
  expect(outputs.has_visible).toBe('true')
})

it('publishes nothing when the push carried only internal work', () => {
  commit('docs: write some words', 'test: assert something', 'ci: tweak a job')

  const { outputs } = run()

  expect(outputs.has_visible).toBe('false')
})

it('counts only the commits since the previous tag', () => {
  commit('feat: the released one')
  git('tag', 'v2020.01.01')
  commit('fix(scope): the new one')

  const { notes } = run()

  expect(notes).toContain('- **scope** — the new one')
  expect(notes).not.toContain('the released one')
  expect(notes).toContain('/compare/v2020.01.01...')
})

it('suffixes the tag when the date is already taken', () => {
  commit('feat: something')
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.')
  git('tag', `v${today}`)
  git('tag', `v${today}.1`)

  const { outputs } = run()

  expect(outputs.tag).toBe(`v${today}.2`)
})
