import { ImageResponse } from 'next/og'
import { siteConfig } from '@/config/site'

/**
 * Share card for the support page. Hand-rolled rather than reusing the
 * platform OG renderer because /pro is not a platform — it has its own
 * headline and its own job (turn goodwill into a membership).
 */
export const dynamic = 'force-static'
export const alt = `Support ${siteConfig.name} — free downloads, supporter extras`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #04171b 0%, #07242b 55%, #0a3240 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
          padding: 72,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 26,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: '#67e8f9',
          }}
        >
          <span>☕</span>
          <span>Support the project</span>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 68,
            fontWeight: 700,
            textAlign: 'center',
            marginTop: 28,
            lineHeight: 1.15,
          }}
        >
          Free forever. Not free to run.
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 14,
            marginTop: 40,
          }}
        >
          {['Batch queue', 'Collection import', 'Subtitles', 'Priority', 'ZIP bundles', 'Ad-free'].map(
            (chip) => (
              <div
                key={chip}
                style={{
                  display: 'flex',
                  padding: '10px 22px',
                  borderRadius: 999,
                  border: '1px solid rgba(103,232,249,0.35)',
                  background: 'rgba(103,232,249,0.08)',
                  fontSize: 24,
                  color: '#a5f3fc',
                }}
              >
                {chip}
              </div>
            ),
          )}
        </div>
        <div style={{ display: 'flex', marginTop: 44, fontSize: 24, color: 'rgba(255,255,255,0.6)' }}>
          {siteConfig.url.replace(/^https:\/\//, '')}/pro
        </div>
      </div>
    ),
    size,
  )
}
