import { NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

interface HLMeta {
  name: string        // e.g. "xyz:NVDA", "BTC", "ETH"
  szDecimals: number
  maxLeverage: number
  onlyIsolated: boolean
  isDelisted?: boolean
}

interface HLAssetCtx {
  dayNtlVlm: string
  openInterest: string
  prevDayPx: string   // price at start of UTC day — use for 24hr change
  markPx: string
  midPx: string | null
  funding: string
}

export interface AssetInfo {
  ticker: string      // display name, e.g. "NVDA"
  coin: string        // Hyperliquid coin ID, e.g. "xyz:NVDA" — use for all API calls
  volume24h: number
  price: number
  prevDayPx: number
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

    // Response shape: [{ universe: HLMeta[] }, HLAssetCtx[]]
    const raw: [{ universe: HLMeta[] }, HLAssetCtx[]] = await res.json()
    const metas = raw[0]?.universe ?? []
    const ctxs  = raw[1] ?? []

    const assets: AssetInfo[] = []

    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i]
      const ctx  = ctxs[i]
      if (!meta || !ctx) continue
      if (meta.isDelisted) continue

      // xyz DEX assets have names prefixed with "xyz:" (e.g. "xyz:NVDA")
      if (!meta.name.startsWith('xyz:')) continue

      const ticker = meta.name.slice(4)   // strip "xyz:" for display
      const coin   = meta.name            // keep full ID for API calls

      const price        = parseFloat(ctx.markPx ?? ctx.midPx ?? '0') || 0
      const prevDayPx    = parseFloat(ctx.prevDayPx)    || 0
      const volume24h    = parseFloat(ctx.dayNtlVlm)    || 0
      const openInterest = parseFloat(ctx.openInterest) || 0
      const funding      = parseFloat(ctx.funding)      || 0

      if (price === 0) continue

      assets.push({ ticker, coin, volume24h, price, prevDayPx, openInterest, funding, szDecimals: meta.szDecimals })
    }

    // Sort by 24h notional volume, highest first
    assets.sort((a, b) => b.volume24h - a.volume24h)

    return NextResponse.json(assets, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[/api/assets]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
