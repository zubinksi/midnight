import { NextResponse } from 'next/server'
import { fetchAltTokenList } from '@/lib/altfun'
import type { AltToken } from '@/lib/altfun'

let cache: { tokens: AltToken[]; ts: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function GET() {
  try {
    const now = Date.now()
    if (cache && now - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.tokens, {
        headers: { 'Cache-Control': 'public, max-age=300' },
      })
    }
    const tokens = await fetchAltTokenList()
    cache = { tokens, ts: now }
    return NextResponse.json(tokens, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch (err) {
    console.error('[alt tokens]', err)
    return NextResponse.json([], { status: 200 })
  }
}
