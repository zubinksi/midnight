import { NextResponse } from 'next/server'
import { getAssetCategory, TICKER_RENAMES } from '@/lib/assets'
import type { AssetInfo } from '@/lib/assets'

const HL_API = 'https://api.hyperliquid.xyz/info'

let cache: { data: unknown; ts: number } | null = null
const CACHE_TTL = 60_000

interface HLMeta {
  name: string
  szDecimals: number
  maxLeverage: number
  onlyIsolated: boolean
  isDelisted?: boolean
}

interface HLAssetCtx {
  dayNtlVlm: string
  openInterest: string
  prevDayPx: string
  markPx: string
  midPx: string | null
  funding: string
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data)
  try {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // dex: "xyz" scopes the request to the xyz DEX (HIP-3 real-world assets)
      body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`upstream ${res.status}`)

    // Response: [{ universe: HLMeta[] }, HLAssetCtx[]]
    const raw: [{ universe: HLMeta[] }, HLAssetCtx[]] = await res.json()
    const metas = raw[0]?.universe ?? []
    const ctxs  = raw[1] ?? []

    const assets: AssetInfo[] = []

    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i]
      const ctx  = ctxs[i]
      if (!meta || !ctx) continue
      if (meta.isDelisted) continue

      // When queried with dex: "xyz", names are the bare ticker (e.g. "NVDA").
      // The full coin ID for all API calls is "xyz:{name}".
      const rawTicker = meta.name.startsWith('xyz:') ? meta.name.slice(4) : meta.name
      const ticker    = TICKER_RENAMES[rawTicker] ?? rawTicker
      const coin      = meta.name.startsWith('xyz:') ? meta.name : `xyz:${rawTicker}`

      const price        = parseFloat(ctx.markPx ?? ctx.midPx ?? '0') || 0
      const prevDayPx    = parseFloat(ctx.prevDayPx)    || 0
      const volume24h    = parseFloat(ctx.dayNtlVlm)    || 0
      const openInterest = parseFloat(ctx.openInterest) || 0
      const funding      = parseFloat(ctx.funding)      || 0

      if (price === 0) continue

      assets.push({
        ticker,
        coin,
        volume24h,
        price,
        prevDayPx,
        openInterest,
        funding,
        szDecimals: meta.szDecimals,
        category: getAssetCategory(ticker),
      })
    }

    assets.sort((a, b) => b.volume24h - a.volume24h)

    cache = { data: assets, ts: Date.now() }
    return NextResponse.json(assets)
  } catch (err) {
    console.error('[/api/assets]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
