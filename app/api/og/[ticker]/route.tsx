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
    const res  = await fetch(`${base}/api/assets`)
    if (res.ok) {
      const list: AssetInfo[] = await res.json()
      asset = list.find(a => a.ticker === upperTicker) ?? null
    }
  } catch {}

  // Fetch 1D candles for sparkline
  let sparkPath = ''
  let sparkColor = '#26ab83'
  try {
    const endTime   = Date.now()
    const startTime = endTime - 24 * 60 * 60 * 1000
    const candleRes = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: `xyz:${upperTicker}`, interval: '15m', startTime, endTime },
      }),
    })
    if (candleRes.ok) {
      const candles: Array<{ t: number; c: string }> = await candleRes.json()
      if (Array.isArray(candles) && candles.length > 1) {
        const values = candles.map(c => parseFloat(c.c)).filter(v => !isNaN(v))
        if (values.length > 1) {
          const min = Math.min(...values)
          const max = Math.max(...values)
          const range = max - min || 1
          const W = 1088; const H = 100; const pad = 4
          const pts = values.map((v, i) => {
            const x = (i / (values.length - 1)) * W
            const y = pad + (H - pad * 2) - ((v - min) / range) * (H - pad * 2)
            return `${x},${y}`
          })
          sparkPath  = 'M' + pts.join('L')
          sparkColor = values[values.length - 1] >= values[0] ? '#26ab83' : '#E84332'
        }
      }
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

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#080807', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '52px 56px 48px', fontFamily: 'monospace' }}>

        {/* Top: ticker + name / pct */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 15, color: '#46443D', letterSpacing: '0.1em' }}>{upperTicker}</span>
            <span style={{ fontSize: 22, color: '#46443D', marginTop: 4 }}>{assetName}</span>
            <span style={{ fontSize: 80, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.03em', marginTop: 16, lineHeight: 1 }}>
              {priceStr}
            </span>
          </div>
          {pctStr && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingTop: 4 }}>
              <span style={{ fontSize: 32, color: up ? '#26ab83' : '#E84332', fontWeight: 600 }}>{pctStr}</span>
              <span style={{ fontSize: 13, color: '#46443D', marginTop: 8, letterSpacing: '0.06em' }}>24H CHANGE</span>
            </div>
          )}
        </div>

        {/* Sparkline */}
        {sparkPath && (
          <div style={{ display: 'flex', marginBottom: 8 }}>
            <svg width={1088} height={100} viewBox="0 0 1088 100">
              <path d={sparkPath} stroke={sparkColor} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {/* Bottom: branding */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 24, fontWeight: 700, color: '#F0EDE6', letterSpacing: '-0.01em' }}>neue.markets</span>
          <span style={{ fontSize: 13, color: '#46443D', letterSpacing: '0.08em' }}>POWERED BY HYPERLIQUID</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
