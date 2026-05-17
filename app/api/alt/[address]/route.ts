import { NextRequest, NextResponse } from 'next/server'
import { fetchAltTokenList, fetchAltTokenDetails } from '@/lib/altfun'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params
    const tokens = await fetchAltTokenList()
    const token  = tokens.find(t => t.address.toLowerCase() === address.toLowerCase())
    if (!token) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const details = await fetchAltTokenDetails(token)
    return NextResponse.json(details, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    })
  } catch (err) {
    console.error('[alt token details]', err)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
