export interface ImageData {
  id: string
  url: string
  thumbnail: string
  selected: boolean
}

export interface VideoMetadata {
  title: string
  author: string
  duration: number
  thumbnail: string
  images?: ImageData[]
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
  | { type: 'TOGGLE_PREVIEW' }
  | { type: 'TOGGLE_IMAGE_GALLERY' }
  | { type: 'TOGGLE_IMAGE_SELECTION'; payload: string }
  | { type: 'SELECT_ALL_IMAGES'; payload: boolean }
  | { type: 'RESET_DOWNLOAD_STATE' }
  | {
      type: 'SET_DOWNLOAD_SUCCESS'
      payload: {
        downloadUrl: string
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
      }

    case 'SET_DOWNLOAD_SUCCESS':
      return {
        ...state,
        message: 'Content processed successfully!',
        downloadUrl: action.payload.downloadUrl,
        audioUrl: action.payload.audioUrl || '',
        originalUrl: action.payload.originalUrl,
        videoMetadata: action.payload.metadata,
        showPreview: true,
      }

    default:
      return state
  }
}
