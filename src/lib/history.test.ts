import { describe, expect, it } from 'vitest'
import { mergeEntries } from './history'
import type { HistoryEntry } from './history'

function entry(url: string, ts: number): HistoryEntry {
  return { url, title: `t-${url}`, author: '', ts }
}

describe('mergeEntries', () => {
  it('adds incoming entries and sorts newest-first', () => {
    const existing = [entry('a', 100)]
    const { list, added } = mergeEntries(existing, [entry('b', 300), entry('c', 200)])
    expect(added).toBe(2)
    expect(list.map((e) => e.url)).toEqual(['b', 'c', 'a'])
  })

  it('lets an imported entry win a URL collision', () => {
    const existing = [entry('a', 100)]
    const { list, added } = mergeEntries(existing, [entry('a', 999)])
    // The URL was already there, but the row itself is new — count it.
    expect(added).toBe(1)
    expect(list[0].ts).toBe(999)
  })

  it('counts a re-import of the same file as zero additions', () => {
    const current = [entry('a', 300), entry('b', 100)]
    const { added } = mergeEntries(current, [...current])
    expect(added).toBe(0)
  })

  it('caps the merged list and drops the oldest overflow', () => {
    const existing = [entry('a', 100), entry('b', 90), entry('c', 80)]
    const { list } = mergeEntries(existing, [entry('d', 50)], 3)
    expect(list.map((e) => e.url)).toEqual(['a', 'b', 'c'])
  })

  it('ignores malformed rows instead of failing the whole import', () => {
    const { list, added } = mergeEntries([], [
      { url: 7 },
      'junk',
      null,
      { url: 'ok', title: 'fine', ts: 5 },
    ])
    expect(added).toBe(1)
    expect(list.map((e) => e.url)).toEqual(['ok'])
  })

  it('returns unchanged when nothing valid arrives', () => {
    const existing = [entry('a', 1)]
    const { list, added } = mergeEntries(existing, [null, 42])
    expect(added).toBe(0)
    expect(list).toBe(existing) // same reference — callers can skip a write
  })
})

/**
 * The saved mark: whether a file for this link actually reached the disk, as
 * opposed to `ts`, which only says when the link was last looked up.
 *
 * The rule that matters is that looking a post up again must not un-download
 * it. The first version of this got that wrong in the one case where the mark
 * is most useful — pasting a link you already have — because `addHistory`
 * dedupes by URL and the fresh entry carried no `savedAt`.
 */
describe('the saved mark', () => {
  const OLDER = { url: 'https://x.test/a', title: 'A', author: '', ts: 100 }
  const NEWER = { url: 'https://x.test/b', title: 'B', author: '', ts: 200 }

  it('survives the same link being resolved again', () => {
    const stamped = { ...OLDER, savedAt: 555 }
    const { list } = mergeEntries([stamped], [{ ...OLDER, ts: 900 }])
    expect(list[0].savedAt).toBe(555)
    expect(list[0].ts).toBe(900)
  })

  /** An incoming entry that knows about a save wins over one that does not. */
  it('takes an incoming mark when there was none', () => {
    const { list } = mergeEntries([OLDER], [{ ...OLDER, savedAt: 777 }])
    expect(list[0].savedAt).toBe(777)
  })

  it('leaves rows it does not touch alone', () => {
    const { list } = mergeEntries([{ ...NEWER, savedAt: 42 }], [OLDER])
    expect(list.find((e) => e.url === NEWER.url)?.savedAt).toBe(42)
    expect(list.find((e) => e.url === OLDER.url)?.savedAt).toBeUndefined()
  })
})
