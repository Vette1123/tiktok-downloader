import { describe, expect, it } from 'vitest'
import {
  describeProgress,
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
  it('joins received/total and a rate from the transfer window', () => {
    // 10 MB in 5 s → 2.0 MB/s.
    const text = describeProgress(detail(10 * 1024 * 1024), START + 5_000)
    expect(text).toBe('10 MB / 20 MB · 2.0 MB/s')
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
