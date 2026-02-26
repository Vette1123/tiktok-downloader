export interface ImageData {
  id: string
  url: string
  thumbnail: string
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
}

export interface ProcessedVideo {
  id: string
  url: string
  size?: number
  format: string
  quality?: string
  watermarkRemoved: boolean
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

export interface DownloadResponse {
  success: boolean
  message: string
  downloadUrl?: string
  audioUrl?: string
  video?: ProcessedVideo
  audio?: AudioData
}
