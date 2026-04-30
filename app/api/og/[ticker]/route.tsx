import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'
import { getAsset } from '@/lib/assets'

export const runtime = 'edge'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()
  const asset = getAsset(upperTicker)

  if (!asset) {
    return new Response('Not found', { status: 404 })
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#080807',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px 56px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.1em' }}>
              {upperTicker} · {asset.name}
            </span>
            <span style={{ fontSize: 72, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.03em', marginTop: 12 }}>
              ${asset.seedPrice.toLocaleString('en-US', { minimumFractionDigits: asset.decimals, maximumFractionDigits: asset.decimals })}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: 18, color: '#26ab83' }}>LIVE</span>
            <span style={{ fontSize: 18, color: '#46443D', marginTop: 8 }}>HYPERLIQUID</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.01em' }}>
            MIDNIGHT
          </span>
          <span style={{ fontSize: 14, color: '#46443D', letterSpacing: '0.08em' }}>
            After Hours. 24/7.
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
