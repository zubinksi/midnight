import { NextRequest, NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

// Short dedup cache for allMids calls — many concurrent users share one upstream fetch.
const midsCaches: Record<string, { data: unknown; ts: number }> = {}
const MIDS_TTL = 1_000

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body?.type === 'allMids') {
      const key = body.dex ?? '__perp__'
      const cached = midsCaches[key]
      if (cached && Date.now() - cached.ts < MIDS_TTL) {
        return NextResponse.json(cached.data, { headers: { 'Access-Control-Allow-Origin': '*' } })
      }
      const upstream = await fetch(HL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        next: { revalidate: 0 },
      })
      if (!upstream.ok) return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
      const data = await upstream.json()
      midsCaches[key] = { data, ts: Date.now() }
      return NextResponse.json(data, { headers: { 'Access-Control-Allow-Origin': '*' } })
    }

    const upstream = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      next: { revalidate: 0 },
    })
    if (!upstream.ok) return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
    const data = await upstream.json()
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('[hl proxy]', err)
    return NextResponse.json({ error: 'proxy error' }, { status: 500 })
  }
}
