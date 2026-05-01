import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'

export const runtime = 'edge'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()
  const assetName   = getAssetName(upperTicker)

  let asset: AssetInfo | null = null
  try {
    const base = new URL(req.url).origin
    const res  = await fetch(`${base}/api/assets`, { next: { revalidate: 60 } })
    if (res.ok) {
      const list: AssetInfo[] = await res.json()
      asset = list.find(a => a.ticker === upperTicker) ?? null
    }
  } catch {}

  const price    = asset?.price ?? 0
  const decimals = priceDecimals(price)
  const priceStr = price > 0
    ? price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '—'

  const diff   = asset ? (asset.price - asset.prevDayPx) : 0
  const pct    = asset?.prevDayPx ? (diff / asset.prevDayPx) * 100 : 0
  const up     = diff >= 0
  const pctStr = asset?.prevDayPx ? `${up ? '+' : ''}${pct.toFixed(2)}%` : ''
  const changeColor = up ? '#26ab83' : '#E84332'

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#080807', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', fontFamily: 'monospace' }}>

        {/* Top: branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#26ab83' }} />
          <span style={{ fontSize: 14, color: '#46443D', letterSpacing: '0.12em' }}>NEUE.MARKETS · LIVE</span>
        </div>

        {/* Middle: ticker + price + change */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.08em', marginBottom: 8 }}>{upperTicker} · {assetName}</span>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32 }}>
            <span style={{ fontSize: 96, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.04em', lineHeight: 1 }}>
              {priceStr}
            </span>
            {pctStr && (
              <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 10 }}>
                <span style={{ fontSize: 40, fontWeight: 600, color: changeColor, lineHeight: 1 }}>{pctStr}</span>
                <span style={{ fontSize: 13, color: '#46443D', marginTop: 6, letterSpacing: '0.08em' }}>24H CHANGE</span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom: attribution */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.01em' }}>neue.markets</span>
          <span style={{ fontSize: 13, color: '#46443D', letterSpacing: '0.08em' }}>POWERED BY HYPERLIQUID</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
