/**
 * What "save it without asking me" actually saves.
 *
 * A supporter can turn off the second tap: paste a link, and the file is
 * already downloading by the time the card finishes painting. The whole
 * question is which file, and the honest answer is "the one the visitor would
 * have tapped" — which is not always the video, and is sometimes nothing at
 * all.
 *
 * Kept out of the component because the interesting cases are the ones where
 * the answer is `null`, and those are exactly the ones nobody would think to
 * click through by hand.
 */

export interface AutoSaveInput {
  /** The visitor's format toggle, which is a stated intent, not a guess. */
  format: 'video' | 'audio'
  hasVideo: boolean
  hasAudio: boolean
  /** A carousel or gallery: several files, and a selection to make first. */
  isGallery: boolean
}

export type AutoSaveTarget = 'video' | 'audio' | null

/**
 * The one file to start saving, or null to leave the card alone.
 *
 * Three rules, in order:
 *
 *   1. A gallery is never auto-saved. It is a set, the visitor picks from it,
 *      and firing twenty downloads at a browser that just resolved a link is
 *      not "less standing over it" — it is a mess to clean up.
 *   2. Audio mode means audio. Somebody who set the toggle to MP3 and turned
 *      this on has said what they want twice.
 *   3. Video mode takes the video, and falls back to the audio when there is no
 *      video. That last case is not a technicality: a YouTube link that could
 *      not be extracted still resolves with its audio track, and the MP3 is
 *      then the only thing there is to save.
 */
export function autoSaveTarget(input: AutoSaveInput): AutoSaveTarget {
  if (input.isGallery) return null
  if (input.format === 'audio') return input.hasAudio ? 'audio' : null
  if (input.hasVideo) return 'video'
  return input.hasAudio ? 'audio' : null
}
