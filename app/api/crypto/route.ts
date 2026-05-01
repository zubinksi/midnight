import { NextResponse } from 'next/server'
import type { AssetInfo } from '@/lib/assets'

const HL_API = 'https://api.hyperliquid.xyz/info'

// Crypto assets to surface (Hyperliquid perp tickers)
const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK', 'ADA', 'SUI', 'HYPE', 'TON', 'ARB',
])

interface HLMeta {
  name: string
  szDecimals: number
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
  try {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`upstream ${res.status}`)

    const raw: [{ universe: HLMeta[] }, HLAssetCtx[]] = await res.json()
    const metas = raw[0]?.universe ?? []
    const ctxs  = raw[1] ?? []

    const assets: AssetInfo[] = []

    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i]
      const ctx  = ctxs[i]
      if (!meta || !ctx) continue
      if (meta.isDelisted) continue
      if (!CRYPTO_TICKERS.has(meta.name)) continue

      const price        = parseFloat(ctx.markPx ?? ctx.midPx ?? '0') || 0
      const prevDayPx    = parseFloat(ctx.prevDayPx)    || 0
      const volume24h    = parseFloat(ctx.dayNtlVlm)    || 0
      const openInterest = parseFloat(ctx.openInterest) || 0
      const funding      = parseFloat(ctx.funding)      || 0

      if (price === 0) continue

      assets.push({
        ticker:      meta.name,
        coin:        meta.name,  // no prefix — Hyperliquid perp uses bare ticker
        volume24h,
        price,
        prevDayPx,
        openInterest,
        funding,
        szDecimals:  meta.szDecimals,
        category:    'crypto',
      })
    }

    assets.sort((a, b) => b.volume24h - a.volume24h)

    return NextResponse.json(assets, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[/api/crypto]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
