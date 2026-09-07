import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forgetSaved,
  getSavedServerSnapshot,
  getSavedSnapshot,
  noteShareFailed,
  rememberSaved,
  subscribeSaved,
} from './lastSaved'

const clip = (name = 'clip.mp4') =>
  new File([new Uint8Array([1])], name, { type: 'video/mp4' })

afterEach(() => forgetSaved())

describe('the last saved file', () => {
  it('starts empty and comes back empty', () => {
    expect(getSavedSnapshot()).toEqual({ file: null, failed: false })
    rememberSaved(clip())
    forgetSaved()
    expect(getSavedSnapshot().file).toBeNull()
  })

  it('holds the file it was given', () => {
    const file = clip()
    rememberSaved(file)
    expect(getSavedSnapshot().file).toBe(file)
  })

  /**
   * `useSyncExternalStore` compares snapshots by reference, so an unchanged
   * write must return the very same object or the component re-renders forever.
   */
  it('is identity-stable when nothing changed', () => {
    const before = getSavedSnapshot()
    forgetSaved()
    expect(getSavedSnapshot()).toBe(before)
    expect(getSavedServerSnapshot()).toBe(before)
  })

  it('notifies subscribers, and stops when they leave', () => {
    const seen = vi.fn()
    const stop = subscribeSaved(seen)
    rememberSaved(clip())
    expect(seen).toHaveBeenCalledTimes(1)
    stop()
    rememberSaved(clip('other.mp4'))
    expect(seen).toHaveBeenCalledTimes(1)
  })

  describe('the failure mark', () => {
    it('rides along with the file, and a new save clears it', () => {
      rememberSaved(clip())
      noteShareFailed()
      expect(getSavedSnapshot().failed).toBe(true)
      rememberSaved(clip('next.mp4'))
      expect(getSavedSnapshot().failed).toBe(false)
    })

    /** Nothing to blame a failure on once the file is gone. */
    it('does not resurrect a forgotten file', () => {
      noteShareFailed()
      expect(getSavedSnapshot()).toEqual({ file: null, failed: false })
    })
  })
})
