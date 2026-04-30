import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'

export const runtime = 'edge'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()

  // Fetch live asset info from our own assets API
  let asset: AssetInfo | null = null
  try {
    const base = new URL(req.url).origin
    const res  = await fetch(`${base}/api/assets`)
    if (res.ok) {
      const list: AssetInfo[] = await res.json()
      asset = list.find(a => a.ticker === upperTicker) ?? null
    }
  } catch { /* proceed without live data */ }

  const price    = asset?.price ?? 0
  const decimals = priceDecimals(price)
  const priceStr = price > 0
    ? price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '—'

  const diff = asset ? (asset.price - asset.prevDayPx) : 0
  const pct  = asset?.prevDayPx ? (diff / asset.prevDayPx) * 100 : 0
  const up   = diff >= 0
  const pctStr = asset?.prevDayPx
    ? `${up ? '+' : ''}${pct.toFixed(2)}%`
    : ''

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#080807', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px 56px', fontFamily: 'monospace' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.1em' }}>
              {upperTicker} · HYPERLIQUID
            </span>
            <span style={{ fontSize: 72, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.03em', marginTop: 12 }}>
              ${priceStr}
            </span>
          </div>
          {pctStr && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: 28, color: up ? '#26ab83' : '#E84332' }}>{pctStr}</span>
              <span style={{ fontSize: 14, color: '#46443D', marginTop: 8 }}>24H CHANGE</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.01em' }}>MIDNIGHT</span>
          <span style={{ fontSize: 14, color: '#46443D', letterSpacing: '0.08em' }}>After Hours. 24/7.</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
