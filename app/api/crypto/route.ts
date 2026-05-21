import { NextResponse } from 'next/server'
import type { AssetInfo } from '@/lib/assets'

const HL_API = 'https://api.hyperliquid.xyz/info'

let cache: { data: unknown; ts: number } | null = null
const CACHE_TTL = 60_000

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
  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data)
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

      const price        = parseFloat(ctx.markPx ?? ctx.midPx ?? '0') || 0
      const prevDayPx    = parseFloat(ctx.prevDayPx)    || 0
      const volume24h    = parseFloat(ctx.dayNtlVlm)    || 0
      const openInterest = parseFloat(ctx.openInterest) || 0
      const funding      = parseFloat(ctx.funding)      || 0

      if (price === 0) continue

      assets.push({
        ticker:      meta.name,
        coin:        meta.name,
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

    const result = assets.slice(0, 50)
    cache = { data: result, ts: Date.now() }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/crypto]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

