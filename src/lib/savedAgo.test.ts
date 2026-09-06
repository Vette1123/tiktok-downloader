import { describe, expect, it } from 'vitest'
import { savedAgo } from './savedAgo'

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Pinned to `en` so the assertions read as English rather than as the runner's locale. */
const ago = (at: number) => savedAgo(at, NOW, 'en')

describe('how long ago a file was saved', () => {
  it('says something human for the moment just past', () => {
    expect(ago(NOW - 5_000)).toBe('this minute')
  })

  it('counts minutes, then hours, then days', () => {
    expect(ago(NOW - 3 * MINUTE)).toBe('3 minutes ago')
    expect(ago(NOW - 2 * HOUR)).toBe('2 hours ago')
    expect(ago(NOW - 3 * DAY)).toBe('3 days ago')
  })

  /**
   * The largest unit that fits, or "2 hours ago" renders as "120 minutes ago"
   * and nobody reads it.
   */
  it('does not report an hour in minutes', () => {
    expect(ago(NOW - 90 * MINUTE)).toBe('1 hour ago')
  })

  /** `numeric: 'auto'` is what gets the word instead of the count. */
  it('says yesterday', () => {
    expect(ago(NOW - DAY)).toBe('yesterday')
  })

  /** Past a week, a relative phrase stops helping; null means "show a date". */
  it('gives up past a week', () => {
    expect(ago(NOW - 7 * DAY)).toBeNull()
    expect(ago(NOW - 400 * DAY)).toBeNull()
  })

  /**
   * A device whose clock was corrected, or an entry imported from a machine an
   * hour ahead. "In 40 minutes" on a file you already have is worse than
   * saying nothing.
   */
  it('says nothing about a timestamp in the future', () => {
    expect(ago(NOW + MINUTE)).toBeNull()
  })

  it('speaks the language it is given', () => {
    expect(savedAgo(NOW - 2 * HOUR, NOW, 'es')).toContain('hace')
  })
})
