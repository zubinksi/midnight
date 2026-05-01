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
      <div style={{ width: '100%', height: '100%', background: '#080807', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', fontFamily: 'monospace' }}>

        {/* Top: live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#26ab83' }} />
          <span style={{ fontSize: 14, color: '#46443D', letterSpacing: '0.12em' }}>NEUE.MARKETS · LIVE</span>
        </div>

        {/* Middle: ticker + name */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 20, color: '#46443D', letterSpacing: '0.08em', marginBottom: 16 }}>{assetName}</span>
          <span style={{ fontSize: 120, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.04em', lineHeight: 1 }}>
            {upperTicker}
          </span>
        </div>

        {/* Bottom: branding */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.01em' }}>neue.markets</span>
          <span style={{ fontSize: 13, color: '#46443D', letterSpacing: '0.08em' }}>POWERED BY HYPERLIQUID</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
