import { NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

// Max leverage threshold that separates tradfi assets from crypto on Hyperliquid.
// Stocks/indices/commodities are capped at 5-10x; crypto is 20-100x.
const MAX_LEVERAGE_TRADFI = 10

interface HLMeta {
  name: string
  szDecimals: number
  maxLeverage: number
  onlyIsolated?: boolean
}

interface HLAssetCtx {
  dayNtlVlm: string
  openInterest: string
  prevDayPx: string   // price at UTC midnight — perfect 24hr open
  markPx: string
  midPx: string | null
  funding: string
}

export interface AssetInfo {
  ticker: string
  volume24h: number     // USD notional
  price: number         // current mark price
  prevDayPx: number     // UTC-midnight open — use for 24hr change
  openInterest: number
  funding: number
  szDecimals: number
}

export async function GET() {
  try {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`upstream ${res.status}`)

    const [metas, ctxs]: [HLMeta[], HLAssetCtx[]] = await res.json()

    const assets: AssetInfo[] = []
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i]
      const ctx  = ctxs[i]
      if (!meta || !ctx) continue

      // Skip crypto perps — they have much higher leverage limits
      if (meta.maxLeverage > MAX_LEVERAGE_TRADFI) continue

      const volume24h    = parseFloat(ctx.dayNtlVlm)  || 0
      const price        = parseFloat(ctx.markPx ?? ctx.midPx ?? '0') || 0
      const prevDayPx    = parseFloat(ctx.prevDayPx)  || 0
      const openInterest = parseFloat(ctx.openInterest) || 0
      const funding      = parseFloat(ctx.funding)    || 0

      // Skip assets with no price or volume data
      if (price === 0) continue

      assets.push({
        ticker: meta.name,
        volume24h,
        price,
        prevDayPx,
        openInterest,
        funding,
        szDecimals: meta.szDecimals,
      })
    }

    // Sort by 24h volume, highest first
    assets.sort((a, b) => b.volume24h - a.volume24h)

    return NextResponse.json(assets, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[/api/assets]', err)
    return NextResponse.json({ error: 'failed to fetch assets' }, { status: 500 })
  }
}
