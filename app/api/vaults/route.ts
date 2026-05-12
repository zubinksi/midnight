import { NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

async function hlPost<T>(body: unknown, revalidate = 300): Promise<T> {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    next: { revalidate },
  })
  if (!res.ok) throw new Error(`HL ${res.status}`)
  return res.json() as Promise<T>
}

export interface VaultSummary {
  vaultAddress: string
  name: string
  leader: string
  description?: string
  tvl: number
  apr: number
  maxDrawdown: number
  followers: number
  isClosed?: boolean
  allTimePnl?: number
}

export async function GET() {
  try {
    const data = await hlPost<VaultSummary[]>({ type: 'vaultSummaries' })
    const vaults = Array.isArray(data)
      ? data.filter(v => !v.isClosed).map(v => ({
          vaultAddress: v.vaultAddress,
          name: v.name ?? 'Unnamed Vault',
          leader: v.leader ?? '',
          description: v.description ?? '',
          tvl: typeof v.tvl === 'number' ? v.tvl : parseFloat(String(v.tvl ?? 0)),
          apr: typeof v.apr === 'number' ? v.apr : parseFloat(String(v.apr ?? 0)),
          maxDrawdown: typeof v.maxDrawdown === 'number' ? v.maxDrawdown : parseFloat(String(v.maxDrawdown ?? 0)),
          followers: v.followers ?? 0,
          allTimePnl: v.allTimePnl ?? 0,
        }))
      : []
    return NextResponse.json(vaults, {
      headers: { 'Cache-Control': 'public, s-maxage=300' },
    })
  } catch (err) {
    console.error('[vaults]', err)
    return NextResponse.json([], { status: 200 })
  }
}
