import { ImageResponse } from '@vercel/og'
import { getAssetName } from '@/lib/assetNames'
import { priceDecimals } from '@/lib/assets'

export const runtime = 'edge'

const HL_API = 'https://api.hyperliquid.xyz/info'

async function fetchPrice(ticker: string): Promise<{ price: number; prevDayPx: number } | null> {
  try {
    // Try xyz DEX first
    const xyzRes = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids', dex: 'xyz' }),
    })
    if (xyzRes.ok) {
      const raw = await xyzRes.json() as { mids?: Record<string, string> } | Record<string, string>
      const mids = (raw as { mids?: Record<string, string> }).mids ?? (raw as Record<string, string>)
      if (mids[ticker]) {
        const price = parseFloat(mids[ticker])
        if (!isNaN(price) && price > 0) return { price, prevDayPx: 0 }
      }
    }
    // Fall back to main Hyperliquid perp allMids
    const perpRes = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    })
    if (perpRes.ok) {
      const raw = await perpRes.json() as { mids?: Record<string, string> } | Record<string, string>
      const mids = (raw as { mids?: Record<string, string> }).mids ?? (raw as Record<string, string>)
      if (mids[ticker]) {
        const price = parseFloat(mids[ticker])
        if (!isNaN(price) && price > 0) return { price, prevDayPx: 0 }
      }
    }
  } catch {}
  return null
}

function fmt(price: number): string {
  const d = priceDecimals(price)
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()
  const assetName   = getAssetName(upperTicker)

  const priceData = await fetchPrice(upperTicker)
  const price     = priceData?.price ?? 0
  const priceStr  = price > 0 ? fmt(price) : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#080807',
          display: 'flex',
          flexDirection: 'column',
          padding: '56px 64px',
        }}
      >
        {/* Card — mirrors share modal preview card */}
        <div
          style={{
            flex: 1,
            background: '#0F0F0E',
            border: '1px solid #1C1C1A',
            borderRadius: '20px',
            padding: '48px 56px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {/* Top row: ticker+name / branding */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 22, color: '#46443D', letterSpacing: '0.08em' }}>
                {upperTicker}
              </span>
              <span style={{ fontSize: 18, color: '#46443D', marginTop: 6 }}>
                {assetName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#26ab83', marginRight: 10 }} />
              <span style={{ fontSize: 16, color: '#46443D', letterSpacing: '0.08em' }}>NEUE.MARKETS</span>
            </div>
          </div>

          {/* Price */}
          {priceStr ? (
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <span style={{ fontSize: 110, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.04em', lineHeight: 1 }}>
                {priceStr}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex' }}>
              <span style={{ fontSize: 110, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.04em', lineHeight: 1 }}>
                {upperTicker}
              </span>
            </div>
          )}

          {/* Bottom: attribution */}
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
