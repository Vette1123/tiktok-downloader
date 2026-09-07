import { describe, expect, it } from 'vitest'
import {
  describeProgress,
  describeRemaining,
  formatBytes,
  reportProgress,
  subscribeProgress,
  getProgressSnapshot,
} from './downloadProgress'

const START = 1_000_000

function detail(received: number, total = 20 * 1024 * 1024) {
  return { received, total, startedAt: START }
}

describe('formatBytes', () => {
  it('renders megabytes with one decimal only when needed', () => {
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB')
    expect(formatBytes(8.44 * 1024 * 1024)).toBe('8.4 MB')
  })

  it('falls back to KB under a megabyte', () => {
    expect(formatBytes(640 * 1024)).toBe('640 KB')
    expect(formatBytes(0)).toBe('0 KB')
  })
})

describe('describeProgress', () => {
  it('joins received/total, a rate from the transfer window, and the wait', () => {
    // 10 MB in 5 s → 2.0 MB/s, with 10 MB still to come.
    const text = describeProgress(detail(10 * 1024 * 1024), START + 5_000)
    expect(text).toBe('10 MB / 20 MB · 2.0 MB/s · about 5s left')
  })

  it('drops to KB/s for very slow transfers instead of reading 0.0 MB/s', () => {
    const text = describeProgress(detail(200 * 1024), START + 10_000)
    expect(text).toContain('KB/s')
  })

  it('clamps the elapsed floor so an instant read cannot divide by ~0', () => {
    const text = describeProgress(detail(1024), START + 1)
    expect(text).toContain('/s')
  })

  it('says nothing without a detail or a known total', () => {
    expect(describeProgress(null, START)).toBe('')
    expect(describeProgress({ ...detail(5), total: 0 }, START)).toBe('')
  })
})

describe('reportProgress store', () => {
  it('notifies subscribers and clears immediately on null', () => {
    let snapshot: ReturnType<typeof getProgressSnapshot> = null
    const unsubscribe = subscribeProgress(() => {
      snapshot = getProgressSnapshot()
    })

    const fast = START + 100 // inside the throttle window of the first emit? no — first emit always lands
    reportProgress(detail(1), fast)
    expect(snapshot).toEqual(detail(1))

    // Inside the throttle window: state updates but nobody is told yet.
    reportProgress(detail(2), fast + 100)
    expect(snapshot).toEqual(detail(1))
    expect(getProgressSnapshot()).toEqual(detail(2))

    // Clearing is never throttled.
    reportProgress(null, fast + 150)
    expect(snapshot).toBeNull()
    expect(getProgressSnapshot()).toBeNull()

    unsubscribe()
  })

  it('emits again after the throttle window passes', () => {
    const seen: number[] = []
    const unsubscribe = subscribeProgress(() => {
      seen.push(getProgressSnapshot()?.received ?? -1)
    })
    reportProgress(detail(1), START)
    reportProgress(detail(2), START + 100) // swallowed
    reportProgress(detail(3), START + 300) // past the window
    expect(seen).toEqual([1, 3])
    unsubscribe()
  })
})

/**
 * The one number somebody watching a download actually wants.
 *
 * Bytes and a rate are the inputs to a sum nobody should be doing while they
 * wait. The interesting cases are all the ones where it says nothing, because
 * a wrong estimate is worse than none.
 */
describe('how much longer', () => {
  const START = 1_000_000
  const detail = (received: number, total: number) => ({
    received,
    total,
    startedAt: START,
  })

  it('reads in seconds, then minutes', () => {
    // 1 MB in 10s, 3 MB to go → 30s.
    expect(describeRemaining(detail(1_000_000, 4_000_000), START + 10_000)).toBe(
      'about 30s left',
    )
    // 1 MB in 10s, 18 MB to go → 180s.
    expect(describeRemaining(detail(1_000_000, 19_000_000), START + 10_000)).toBe(
      'about 3 min left',
    )
  })

  /**
   * The opening seconds are TLS setup and the instance's own startup. An
   * estimate built on them is wildly pessimistic — the same reason the download
   * path waits before judging the rate at all.
   */
  it('says nothing until the rate has settled', () => {
    expect(describeRemaining(detail(100_000, 50_000_000), START + 500)).toBe('')
  })

  /** Under five seconds the number changes faster than it can be read. */
  it('says nothing when it is nearly done', () => {
    expect(describeRemaining(detail(9_500_000, 10_000_000), START + 10_000)).toBe('')
  })

  /**
   * Past an hour the rate has collapsed, and "about 4 hours" is a guess about a
   * transfer that is going to fail rather than finish.
   */
  it('says nothing when the answer is hours', () => {
    expect(describeRemaining(detail(10_000, 900_000_000), START + 10_000)).toBe('')
  })

  it('says nothing without a transfer to measure', () => {
    expect(describeRemaining(null)).toBe('')
    expect(describeRemaining(detail(0, 10_000_000), START + 10_000)).toBe('')
    expect(describeRemaining(detail(1_000, 0), START + 10_000)).toBe('')
  })

  /** It rides the same line as the bytes and the rate, not a second one. */
  it('joins the readout', () => {
    expect(describeProgress(detail(2_000_000, 8_000_000), START + 10_000)).toBe(
      '1.9 MB / 7.6 MB · 0.2 MB/s · about 30s left',
    )
  })
})
