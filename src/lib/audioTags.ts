/**
 * What to write into an extracted MP3's tags, decided from the card on screen.
 *
 * Separate from `id3` on purpose: that file knows byte layout and nothing about
 * this app, and this one knows the app and nothing about bytes. The judgement
 * worth testing lives here.
 */

import type { AudioTags } from './id3'
import type { VideoMetadata } from './appReducer'

/** Trimmed, or undefined — a frame holding a blank string is worse than none. */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Tags for the audio of one resolved post.
 *
 * The distinction that matters is whether the source named a *track*. Several
 * platforms attach one to a clip — the sound a video was made with — and when
 * they do, that is the song somebody is extracting, not the caption above it.
 * So the track's own title and artist lead, and the post's title becomes the
 * album, which is where a music player will show "where this came from"
 * without pretending it is the song's name.
 *
 * Without a named track there is only the post, and the honest reading is that
 * its title is the title and its uploader is the artist. No album then: an
 * invented one would sort a library into folders nobody asked for.
 */
export function audioTagsFor(
  metadata: VideoMetadata | null | undefined,
  sourceUrl?: string,
): AudioTags {
  if (!metadata) return {}
  const track = clean(metadata.musicTitle)
  if (track) {
    return {
      title: track,
      artist: clean(metadata.musicAuthor) ?? clean(metadata.author),
      album: clean(metadata.title),
      sourceUrl: sourceUrl || undefined,
    }
  }
  return {
    title: clean(metadata.title),
    artist: clean(metadata.author),
    sourceUrl: sourceUrl || undefined,
  }
}
