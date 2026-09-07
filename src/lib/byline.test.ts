import { describe, expect, it } from 'vitest'
import { namedAuthor } from './byline'

describe('deciding whether there is an author to print', () => {
  it('keeps a real name', () => {
    expect(namedAuthor('Rick Astley')).toBe('Rick Astley')
    expect(namedAuthor('  nasa  ')).toBe('nasa')
  })

  /**
   * The extractors' own placeholder. Sensible inside a data structure, strange
   * on a card: "by Unknown" claims to name somebody and then does not.
   */
  it('drops the placeholders the extractors write', () => {
    for (const value of ['Unknown', 'unknown', 'N/A', '-', '—', 'null']) {
      expect(namedAuthor(value), value).toBeUndefined()
    }
  })

  it('drops nothing at all', () => {
    expect(namedAuthor('')).toBeUndefined()
    expect(namedAuthor('   ')).toBeUndefined()
    expect(namedAuthor(null)).toBeUndefined()
    expect(namedAuthor(undefined)).toBeUndefined()
  })

  /**
   * A substring match would have eaten this, which is a real band and exactly
   * the kind of name a music-oriented downloader sees.
   */
  it('does not eat a name that merely contains one', () => {
    expect(namedAuthor('Unknown Mortal Orchestra')).toBe(
      'Unknown Mortal Orchestra',
    )
  })
})
