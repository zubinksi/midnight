import { NextRequest, NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

export interface VaultPosition {
  coin: string
  szi: string
  entryPx: string
  positionValue: string
  unrealizedPnl: string
  returnOnEquity: string
  liquidationPx: string | null
  leverage: { type: string; value: number }
  marginUsed?: string
}

export interface VaultDetail {
  name: string
  leader: string
  description?: string
  portfolio: Array<[number, { accountValue: string }]>
  openPositions: VaultPosition[]
  summary?: {
    vaultAddress: string
    tvl: number
    apr: number
    maxDrawdown: number
    followers: number
  }
  tvl?: string | number
  pnl?: string
  maxDrawdown?: number
  apr?: number
  followers?: Array<{ user: string; vaultEquity: string; pnl: string }>
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params
  try {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'vaultDetails', vaultAddress: address }),
      next: { revalidate: 60 },
    })
    if (!res.ok) throw new Error(`HL ${res.status}`)
    const data = await res.json() as VaultDetail
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60' },
    })
  } catch (err) {
    console.error('[vault detail]', err)
    return NextResponse.json({ error: 'Failed to fetch vault' }, { status: 500 })
  }
}
