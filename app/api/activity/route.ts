import { NextRequest, NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

// Only surface trades above this notional threshold
const MIN_NOTIONAL = 25_000

export interface FeedItem {
  ticker: string
  coin: string
  side: 'buy' | 'sell'
  px: number
  sz: number
  notional: number
  time: number  // unix ms
}

interface HLTrade {
  side: string   // 'B' = buy, 'A' = sell
  px: string
  sz: string
  time: number
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { coins: string[] }
  const coins = (body.coins ?? []).slice(0, 15)

  const settled = await Promise.allSettled(
    coins.map(async (coin): Promise<FeedItem[]> => {
      const res = await fetch(HL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'recentTrades', coin }),
        next: { revalidate: 0 },
      })
      if (!res.ok) return []
      const trades = await res.json() as HLTrade[]
      if (!Array.isArray(trades)) return []
      const ticker = coin.includes(':') ? coin.split(':').pop()! : coin
      return trades.map(t => {
        const px = parseFloat(t.px)
        const sz = parseFloat(t.sz)
        return { ticker, coin, side: t.side === 'B' ? 'buy' : 'sell', px, sz, notional: px * sz, time: t.time }
      })
    })
  )

  const all: FeedItem[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }

  // Keep the largest trades (up to 30), then re-sort by time for display
  const items = all
    .filter(t => t.notional >= MIN_NOTIONAL && !isNaN(t.px) && !isNaN(t.sz))
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 30)
    .sort((a, b) => b.time - a.time)
    .slice(0, 20)

  return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } })
}
