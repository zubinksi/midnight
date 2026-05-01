import { ImageResponse } from '@vercel/og'
import { getAssetName } from '@/lib/assetNames'

export const runtime = 'edge'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()
  const assetName   = getAssetName(upperTicker)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#080807',
          display: 'flex',
          flexDirection: 'column',
          padding: '48px 56px',
        }}
      >
        {/* Card */}
        <div
          style={{
            flex: 1,
            background: '#0F0F0E',
            borderRadius: 20,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#1C1C1A',
            padding: '48px 56px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {/* Top: ticker + branding */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 20, color: '#46443D', letterSpacing: '0.08em' }}>
                {upperTicker}
              </span>
              <span style={{ fontSize: 18, color: '#46443D', marginTop: 8 }}>
                {assetName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: '#26ab83',
                  marginRight: 10,
                }}
              />
              <span style={{ fontSize: 16, color: '#46443D', letterSpacing: '0.08em' }}>
                NEUE.MARKETS
              </span>
            </div>
          </div>

          {/* Middle: large ticker */}
          <div style={{ display: 'flex' }}>
            <span
              style={{
                fontSize: upperTicker.length > 5 ? 80 : 110,
                fontWeight: 700,
                color: '#F0EDE6',
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              {upperTicker}
            </span>
          </div>

          {/* Bottom */}
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 16, color: '#46443D', letterSpacing: '0.08em' }}>
              LIVE ON HYPERLIQUID
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
