'use client'

import { useCallback, useState } from 'react'
import { saveBlob } from '@/lib/blobSaver'
import { usePrefs, setSubtitleLang } from '@/lib/prefs'
import { useProToken, useTier } from '@/lib/entitlements'
import type { CaptionTrack } from '@/lib/subtitles'
import { ChevronDownIcon } from '@/components/icons'

type SubtitleFormat = 'srt' | 'vtt'

const FMT_KEY = 'smd:subtitle-format'

function loadFormat(): SubtitleFormat {
  try {
    return window.localStorage.getItem(FMT_KEY) === 'vtt' ? 'vtt' : 'srt'
  } catch {
    return 'srt'
  }
}

/**
 * The YouTube subtitle picker, shown on a resolved YouTube result for
 * supporters. Two lazy steps, both POSTing to /api/subtitles with the pro
 * token in a header (a navigable download link could not carry it):
 *   list  → the track names, so nobody downloads a language blind;
 *   one   → the converted SRT, saved client-side from the text body.
 * Rendered as nothing for free visitors — the panel is an extra, not an ad.
 */
export function SubtitlePicker({ videoId }: { videoId: string }) {
  const tier = useTier()
  const proToken = useProToken()
  const { subtitleLang } = usePrefs()

  const [open, setOpen] = useState(false)
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [tracks, setTracks] = useState<CaptionTrack[] | null>(null)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // Same shape for everyone until they say otherwise; the choice persists so a
  // Premiere user is not re-offered SRT every visit.
  const [format, setFormat] = useState<SubtitleFormat>(loadFormat)

  const chooseFormat = useCallback((next: SubtitleFormat) => {
    setFormat(next)
    try {
      window.localStorage.setItem(FMT_KEY, next)
    } catch {
      // storage disabled — the choice just does not outlive the tab.
    }
  }, [])

  const loadTracks = useCallback(async () => {
    if (loadingTracks || tracks) return
    setLoadingTracks(true)
    setError('')
    try {
      const response = await fetch('/api/subtitles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(proToken ? { 'X-Pro-Token': proToken } : {}),
        },
        body: JSON.stringify({ videoId, list: true }),
      })
      const data = (await response.json().catch(() => null)) as {
        success?: boolean
        error?: string
        tracks?: CaptionTrack[]
      } | null
      if (!response.ok || !data?.success) {
        setError(data?.error || 'Could not load subtitles.')
        return
      }
      // The remembered language floats to the front so it is one tap, not a
      // scan — but nothing is auto-downloaded; the choice stays the visitor's.
      const all = data.tracks ?? []
      const preferred = subtitleLang
        ? all.filter((track) => track.languageCode.startsWith(subtitleLang.split('-')[0]))
        : []
      const rest = preferred.length
        ? all.filter((track) => !preferred.includes(track))
        : all
      setTracks([...preferred, ...rest])
    } catch {
      setError('Network error while loading subtitles.')
    } finally {
      setLoadingTracks(false)
    }
  }, [loadingTracks, proToken, subtitleLang, tracks, videoId])

  const downloadTrack = useCallback(
    async (track: CaptionTrack) => {
      const key = `${track.languageCode}:${track.auto}`
      if (busyKey) return
      setBusyKey(key)
      setError('')
      try {
        const response = await fetch('/api/subtitles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(proToken ? { 'X-Pro-Token': proToken } : {}),
          },
          body: JSON.stringify({
            videoId,
            lang: track.languageCode,
            auto: track.auto,
            fmt: format,
          }),
        })
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string
          } | null
          setError(data?.error || 'Could not fetch that subtitle track.')
          return
        }
        const content = await response.text()
        const disposition = response.headers.get('Content-Disposition') ?? ''
        const match = /filename="([^"]+)"/.exec(disposition)
        saveBlob(new Blob([content], { type: 'text/plain' }), match?.[1] ?? `${videoId}.${format}`)
        // Remember it: next time this language leads the list (and syncs to
        // the account through prefs).
        setSubtitleLang(track.languageCode)
      } catch {
        setError('Network error while fetching the track.')
      } finally {
        setBusyKey(null)
      }
    },
    [busyKey, format, proToken, videoId],
  )

  if (tier !== 'pro') return null

  return (
    <div className='mt-2'>
      <button
        type='button'
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void loadTracks()
        }}
        aria-expanded={open}
        className='inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:text-white'
      >
        Subtitles
        <ChevronDownIcon
          className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className='animate-section-in mt-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3'>
          {/* Format choice sits above the tracks so it reads as applying to
              all of them, and persists — see FMT_KEY. */}
          <div className='mb-2 flex items-center gap-2'>
            <span className='text-[11px] text-white/45'>Format</span>
            <div
              role='group'
              aria-label='Subtitle format'
              className='inline-flex rounded-full border border-white/10 bg-white/[0.03] p-0.5'
            >
              {(['srt', 'vtt'] as const).map((f) => (
                <button
                  key={f}
                  type='button'
                  onClick={() => chooseFormat(f)}
                  aria-pressed={format === f}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase transition-colors ${
                    format === f
                      ? 'bg-cyan-400/90 text-[#04171b]'
                      : 'text-white/55 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          {loadingTracks && <p className='text-xs text-white/50'>Loading tracks…</p>}
          {error && <p className='text-xs text-red-300/90'>{error}</p>}
          {tracks && tracks.length === 0 && (
            <p className='text-xs text-white/50'>This video has no subtitle tracks.</p>
          )}
          {tracks && tracks.length > 0 && (
            <ul className='flex flex-wrap gap-1.5'>
              {tracks.map((track) => {
                const key = `${track.languageCode}:${track.auto}`
                return (
                  <li key={key}>
                    <button
                      type='button'
                      onClick={() => void downloadTrack(track)}
                      disabled={busyKey !== null}
                      className='rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      {busyKey === key ? 'Saving…' : `${track.name} · ${format.toUpperCase()}`}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
