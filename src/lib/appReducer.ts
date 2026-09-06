/**
 * One gallery slide as the client sees it. `kind` mirrors the server's
 * `types.ts` shape: a carousel can hold clips as well as stills, and absent
 * means image — which is what every entry meant before it could hold one.
 */
export interface ImageData {
  id: string
  url: string
  thumbnail: string
  selected: boolean
  kind?: 'image' | 'video'
}

// Single source of truth lives in validator.ts; re-exported here so existing
// imports from '@/lib/appReducer' keep working.
import type { SupportedPlatform } from './validator'
export type { SupportedPlatform }

export interface VideoMetadata {
  title: string
  author: string
  duration: number
  /** Bytes of the primary stream, when the source said. See types.ts. */
  sizeBytes?: number
  thumbnail: string
  images?: ImageData[]
  platform?: SupportedPlatform
  isPhotoCarousel?: boolean
  musicTitle?: string
  musicAuthor?: string
  rawMusicUrl?: string
  // Present (YouTube fallback) when the video can be played via an embedded
  // player but not downloaded. The UI shows the embed and hides download buttons.
  embedUrl?: string
  // Cobalt-tunnel URLs the browser can download DIRECTLY (Content-Disposition:
  // attachment, streams from any IP), bypassing our /api/video|audio proxy to
  // save the function's egress. When set, the download button navigates the
  // browser straight to this URL; when absent it falls back to the proxied
  // downloadUrl/audioUrl (fetch + progress bar). Preview always uses the proxy.
  directVideoUrl?: string
  directAudioUrl?: string
  // Whether the direct URL is served as `Content-Disposition: attachment`.
  // True for cobalt tunnels, which the browser's download manager can be handed
  // directly. False for a raw CDN URL (a browser-side tikwm resolve), where
  // navigating at it would display the file instead of saving it — so a failed
  // direct download must retry through the proxy rather than an iframe.
  directIsAttachment?: boolean
}

export interface AppState {
  url: string
  originalUrl: string
  loading: boolean
  downloading: boolean
  downloadingAudio: boolean
  downloadingImages: boolean
  message: string
  downloadUrl: string
  audioUrl: string
  videoMetadata: VideoMetadata | null
  showPreview: boolean
  showImageGallery: boolean
  downloadType: 'video' | 'audio'
  downloadImagesAsZip: boolean
  // Active-download progress: 0–100 when the stream reports a Content-Length,
  // null when indeterminate (chunked response) or no download is running.
  progress: number | null
}

export type AppAction =
  | { type: 'SET_URL'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_DOWNLOADING'; payload: boolean }
  | { type: 'SET_DOWNLOADING_AUDIO'; payload: boolean }
  | { type: 'SET_DOWNLOADING_IMAGES'; payload: boolean }
  | { type: 'SET_MESSAGE'; payload: string }
  | { type: 'SET_DOWNLOAD_URL'; payload: string }
  | { type: 'SET_AUDIO_URL'; payload: string }
  | { type: 'SET_VIDEO_METADATA'; payload: VideoMetadata | null }
  | { type: 'SET_DOWNLOAD_TYPE'; payload: 'video' | 'audio' }
  | { type: 'SET_DOWNLOAD_IMAGES_AS_ZIP'; payload: boolean }
  | { type: 'SET_PROGRESS'; payload: number | null }
  | { type: 'TOGGLE_PREVIEW' }
  | { type: 'TOGGLE_IMAGE_GALLERY' }
  | { type: 'TOGGLE_IMAGE_SELECTION'; payload: string }
  | { type: 'SELECT_ALL_IMAGES'; payload: boolean }
  | { type: 'RESET_DOWNLOAD_STATE' }
  | {
      type: 'SET_DOWNLOAD_SUCCESS'
      payload: {
        downloadUrl?: string
        metadata: VideoMetadata
        audioUrl?: string
        originalUrl: string
      }
    }

export const initialState: AppState = {
  url: '',
  originalUrl: '',
  loading: false,
  downloading: false,
  downloadingAudio: false,
  downloadingImages: false,
  message: '',
  downloadUrl: '',
  audioUrl: '',
  videoMetadata: null,
  showPreview: false,
  showImageGallery: false,
  downloadType: 'video',
  downloadImagesAsZip: false,
  progress: null,
}

/**
 * Whether a fresh result opens its player without being asked.
 *
 * Opening it is close to free on the ordinary path: the `<video>` is
 * `preload='none'`, so no media byte moves until the visitor presses play, and
 * the poster is the same URL as the thumbnail already painted in the card
 * above it — a cache hit, not a second fetch. So for a TikTok or an Instagram
 * reel, auto-opening costs nothing and saves a click.
 *
 * Three cases where it stays shut:
 *
 *   - An unknown payload shape (`platform === undefined`). That is an older or
 *     foreign result we genuinely know nothing about.
 *   - An embed (the YouTube fallback). That iframe is not `preload='none'` and
 *     cannot be: mounting it loads a megabyte of third-party player
 *     immediately, for a visitor who is usually about to click Download.
 *   - Carousels, which have no video to preview — the gallery is the content.
 *
 * A `generic` link used to sit in that list too, back when its extractor
 * returned whatever tag it happened to scrape. It no longer does: the server
 * only returns a generic downloadUrl after verifying the URL serves media and
 * not a web page (see verifyStreamReachable), so by the time this decision is
 * made the one thing worth waiting for — "is this actually a video" — has
 * already been answered. Staying shut now costs every long-tail site a click
 * for protection it no longer needs.
 */
export function autoOpensPreview({
  platform,
  hasVideo,
  hasEmbed,
  isCarousel,
}: {
  platform: SupportedPlatform | undefined
  hasVideo: boolean
  hasEmbed: boolean
  isCarousel: boolean
}): boolean {
  if (isCarousel) return false
  if (hasEmbed) return false
  if (!hasVideo) return false
  return platform !== undefined
}

/**
 * Whether the status line is reporting a win.
 *
 * `message` is a single string carrying both outcomes, so every reader has to
 * decide which one it is holding. There are two such readers — the banner,
 * which paints itself green or red, and the post-download Pro nudge, which may
 * only appear after something actually saved — and a second copy of this list
 * would drift the moment a new success path is added. One predicate, so a
 * message that reads as success reads that way everywhere.
 *
 * The sign-off emoji is the marker because it is what the success paths
 * already agreed on, and it is the only part of those strings that is not
 * prose someone will reword.
 */
const SAVED_MARKERS = ['🎉', '🎵', '🎬', '🖼️'] as const
const SUCCESS_MARKERS = ['success', ...SAVED_MARKERS] as const

export function isSuccessMessage(message: string): boolean {
  return SUCCESS_MARKERS.some((marker) => message.includes(marker))
}

/**
 * Whether a file actually reached the visitor's disk.
 *
 * Narrower than `isSuccessMessage`, and the difference is the whole point: a
 * finished *resolve* also reads as a success ("Content processed successfully!")
 * and it is not a download. The Recent list stamps a row as saved off this, so
 * treating the two alike would mark every link somebody merely pasted as one
 * they already have — which is the opposite of the question it answers.
 *
 * The emoji are the marker because they are what the eight completion paths
 * already agreed on, in five languages, and they are the only part of those
 * strings that is not prose somebody will reword.
 */
export function isSavedMessage(message: string): boolean {
  return SAVED_MARKERS.some((marker) => message.includes(marker))
}

/**
 * True while a link is being resolved or a file is actively transferring —
 * `state.loading` covers only the former; the latter is three independent
 * flags because video/audio/images can each be mid-transfer on their own.
 *
 * Two readers, which is why it lives here beside `isSuccessMessage` rather
 * than in the component: the promo slot (which must stay off-screen for the
 * whole paste-to-download path), and the banner's retry offer. The banner
 * needs it because its own text cannot say — "Preparing your download…"
 * carries no success marker, so on message alone it is indistinguishable from
 * a failure, and a retry is only ever meaningful once nothing is in flight.
 */
export function isResolvingOrDownloading(
  state: Pick<
    AppState,
    'loading' | 'downloading' | 'downloadingAudio' | 'downloadingImages'
  >,
): boolean {
  return (
    state.loading ||
    state.downloading ||
    state.downloadingAudio ||
    state.downloadingImages
  )
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_URL':
      return { ...state, url: action.payload }

    case 'SET_LOADING':
      return { ...state, loading: action.payload }

    case 'SET_DOWNLOADING':
      return { ...state, downloading: action.payload }

    case 'SET_DOWNLOADING_AUDIO':
      return { ...state, downloadingAudio: action.payload }

    case 'SET_DOWNLOADING_IMAGES':
      return { ...state, downloadingImages: action.payload }

    case 'SET_MESSAGE':
      return { ...state, message: action.payload }

    case 'SET_DOWNLOAD_URL':
      return { ...state, downloadUrl: action.payload }

    case 'SET_AUDIO_URL':
      return { ...state, audioUrl: action.payload }

    case 'SET_VIDEO_METADATA':
      return { ...state, videoMetadata: action.payload }

    case 'SET_DOWNLOAD_TYPE':
      return { ...state, downloadType: action.payload }

    case 'SET_DOWNLOAD_IMAGES_AS_ZIP':
      return { ...state, downloadImagesAsZip: action.payload }

    case 'SET_PROGRESS':
      return { ...state, progress: action.payload }

    case 'TOGGLE_PREVIEW':
      return { ...state, showPreview: !state.showPreview }

    case 'TOGGLE_IMAGE_GALLERY':
      return { ...state, showImageGallery: !state.showImageGallery }

    case 'TOGGLE_IMAGE_SELECTION':
      return {
        ...state,
        videoMetadata: state.videoMetadata
          ? {
              ...state.videoMetadata,
              images: state.videoMetadata.images?.map((img) =>
                img.id === action.payload
                  ? { ...img, selected: !img.selected }
                  : img,
              ),
            }
          : null,
      }

    case 'SELECT_ALL_IMAGES':
      return {
        ...state,
        videoMetadata: state.videoMetadata
          ? {
              ...state.videoMetadata,
              images: state.videoMetadata.images?.map((img) => ({
                ...img,
                selected: action.payload,
              })),
            }
          : null,
      }

    case 'RESET_DOWNLOAD_STATE':
      return {
        ...state,
        message: '',
        downloadUrl: '',
        audioUrl: '',
        originalUrl: '',
        videoMetadata: null,
        showPreview: false,
        showImageGallery: false,
        progress: null,
      }

    case 'SET_DOWNLOAD_SUCCESS': {
      const payloadMeta = action.payload.metadata
      const hasImages = !!payloadMeta.images && payloadMeta.images.length > 0
      // Everything in a carousel starts selected. The gallery opens by itself
      // on a post that has one, and it used to open with nothing ticked — so
      // its only action read "Download selected (0)" and was disabled, and
      // every visitor had to find the "All" button before the panel did
      // anything. Somebody who pasted a carousel wants the carousel.
      const meta = hasImages
        ? {
            ...payloadMeta,
            images: payloadMeta.images?.map((img) => ({
              ...img,
              selected: true,
            })),
          }
        : payloadMeta
      return {
        ...state,
        message: 'Content processed successfully!',
        downloadUrl: action.payload.downloadUrl || '',
        audioUrl: action.payload.audioUrl || '',
        originalUrl: action.payload.originalUrl,
        videoMetadata: meta,
        showPreview: autoOpensPreview({
          platform: meta.platform,
          hasVideo: !!action.payload.downloadUrl,
          hasEmbed: !!meta.embedUrl,
          isCarousel: meta.isPhotoCarousel || hasImages,
        }),
        showImageGallery: hasImages,
      }
    }

    default:
      return state
  }
}
