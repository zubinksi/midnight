import { ImageResponse } from 'next/og'
import { getAssetName } from '@/lib/assetNames'

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const COLORS = ['#26ab83', '#F0C84A', '#60a5fa', '#e879f9']

export default async function Image({ params }: { params: Promise<{ tickers: string }> }) {
  const { tickers: raw } = await params
  const tickers = raw.split('_').map(t => t.toUpperCase()).slice(0, 4)

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
          {/* Top row: compare label (left) | branding (right) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.1em' }}>COMPARE</span>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, background: '#26ab83', marginRight: 12 }} />
              <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.1em' }}>NEUE.MARKETS</span>
            </div>
          </div>

          {/* Ticker rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {tickers.map((ticker, i) => {
              const name = getAssetName(ticker)
              const fontSize = tickers.length <= 2 ? 100 : tickers.length === 3 ? 80 : 68
              return (
                <div
                  key={ticker}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: tickers.length <= 2 ? 16 : 8,
                  }}
                >
                  <div
                    style={{
                      width: fontSize * 0.18,
                      height: fontSize * 0.18,
                      borderRadius: fontSize * 0.09,
                      background: COLORS[i],
                      marginRight: 28,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize,
                      fontWeight: 700,
                      color: '#F0EDE6',
                      letterSpacing: '-0.02em',
                      lineHeight: 1.1,
                      marginRight: 28,
                    }}
                  >
                    {ticker}
                  </span>
                  <span
                    style={{
                      fontSize: fontSize * 0.38,
                      color: '#46443D',
                      letterSpacing: '0.02em',
                      lineHeight: 1.1,
                    }}
                  >
                    {name}
                  </span>
                </div>
              )
            })}
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
