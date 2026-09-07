import { namedAuthor } from './byline'

/**
 * Whether a result should offer a listen before it offers a download.
 *
 * The player existed, but only for photo carousels — the one case where the
 * soundtrack is separate from anything else on the card. Everywhere else an
 * audio-only result was a title, a thumbnail and a Download button, with no way
 * to check it is the right track. That is now the dominant case rather than an
 * edge: YouTube video is unobtainable from this host, so a YouTube link resolves
 * to audio, and picking MP3 on any platform lands in the same place.
 *
 * The rule is "is there anything else here that can already be heard". A video
 * preview plays its own sound, and an embed plays the real thing on the
 * platform's own player, so in both cases a second player is noise.
 */

export interface AudioPreviewSubject {
  hasAudio: boolean
  /** A downloadable video stream, which the preview player already plays. */
  hasVideo: boolean
  /** A platform embed, which plays the original with sound. */
  hasEmbed: boolean
  isCarousel: boolean
  imageCount: number
}

/**
 * A carousel is the exception the player was built for and keeps it: its
 * soundtrack is a separate thing from the stills, so the gallery below cannot
 * stand in for hearing it.
 */
export function shouldOfferAudioPreview(subject: AudioPreviewSubject): boolean {
  if (!subject.hasAudio) return false
  if (subject.isCarousel) return true
  if (subject.hasVideo || subject.hasEmbed) return false
  return subject.imageCount === 0
}

export interface AudioPreviewLabel {
  title: string
  subtitle?: string
}

/**
 * What to call the track above the player.
 *
 * A named track wins over the post's caption for the same reason it wins in
 * the file's tags: when a platform names the sound a clip was made with, that
 * is the thing being listened to. The carousel fallback stays 'Slideshow
 * soundtrack' because a carousel's own title describes the pictures.
 */
export function audioPreviewLabel(
  metadata:
    | {
        title?: string
        author?: string
        musicTitle?: string
        musicAuthor?: string
        isPhotoCarousel?: boolean
      }
    | null
    | undefined,
  /**
   * What the card's own heading says, when the player sits under one.
   *
   * Without it the fallback branch prints the post's title a second line below
   * the post's title. Repeating it does not identify anything the reader is
   * missing, so the block says what it *is* instead.
   */
  cardTitle?: string,
): AudioPreviewLabel {
  const track = metadata?.musicTitle?.trim()
  // Both bylines go through `namedAuthor`, so an extractor's 'Unknown'
  // placeholder becomes no byline rather than a credit to nobody.
  const trackBy = namedAuthor(metadata?.musicAuthor)
  if (track) return { title: track, subtitle: trackBy }
  if (metadata?.isPhotoCarousel) {
    return { title: 'Slideshow soundtrack', subtitle: trackBy }
  }
  const title = metadata?.title?.trim()
  const echoesCard = !!title && title === cardTitle?.trim()
  return {
    title: pickFallbackTitle(title, echoesCard),
    subtitle: namedAuthor(metadata?.author),
  }
}

function pickFallbackTitle(
  title: string | undefined,
  echoesCard: boolean,
): string {
  if (echoesCard) return 'Preview'
  return title || 'Audio track'
}
