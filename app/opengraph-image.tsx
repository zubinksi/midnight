import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#080807',
          display: 'flex',
          padding: 48,
        }}
      >
        <div
          style={{
            flex: 1,
            background: '#0F0F0E',
            borderRadius: 24,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#1C1C1A',
            padding: '48px 64px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {/* Top: branding */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#26ab83', marginRight: 12 }} />
            <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.1em' }}>NEUE.MARKETS</span>
          </div>

          {/* Main headline */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 88, fontWeight: 700, color: '#46443D', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              A watchlist for
            </span>
            <span style={{ fontSize: 88, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              24/7 markets
            </span>
            <span style={{ fontSize: 88, fontWeight: 700, color: '#46443D', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              on Hyperliquid.
            </span>
          </div>

          {/* Bottom */}
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.08em' }}>
              LIVE · POWERED BY HYPERLIQUID
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
