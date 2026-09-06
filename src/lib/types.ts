/**
 * One item of a post's gallery.
 *
 * Named for what it started as. It carries videos too now, because a carousel
 * can mix clips and stills and the old shape could only describe the stills:
 * the first clip became the post's single `downloadUrl` and every clip after it
 * was silently dropped, so a post of three videos downloaded as one. `kind`
 * tells the gallery which proxy to fetch through and which extension to name
 * the file — absent means image, which is what every pre-existing caller meant.
 */
export interface ImageData {
  id: string
  url: string
  thumbnail: string
  kind?: 'image' | 'video'
}

export interface VideoData {
  id: string
  title: string
  url: string
  thumbnail: string
  duration: number
  author: string
  description: string
  downloadUrl: string
  images?: ImageData[]
  isPhotoCarousel?: boolean
  musicUrl?: string
  musicTitle?: string
  musicAuthor?: string
  // True when downloadUrl / musicUrl is a Cobalt *tunnel* (Cobalt streams the
  // media through its own server with Content-Disposition: attachment, from any
  // IP). Such a URL can be handed straight to the browser for download instead
  // of being re-streamed through our /api/video|audio proxy — saving the
  // function's egress. Only set for `status:'tunnel'`, never for a raw CDN
  // `redirect` URL (those need our proxy for referer/content-type).
  tunnel?: boolean
  // Set when no downloadable stream could be extracted but the video can still
  // be played via an embedded player (used for YouTube, which bot-blocks free
  // extraction from datacenters). The UI shows the embed and hides the
  // download/audio buttons.
  embedUrl?: string
}

export interface AudioData {
  id: string
  url: string
  size?: number
  format: string
  quality?: string
  duration: number
  title: string
  author: string
}
