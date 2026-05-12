import { NextResponse } from 'next/server'

const STATS_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/vaults'

// Shape returned by the stats-data endpoint
interface StatsVault {
  vaultAddress: string
  name: string
  leader: string
  description?: string
  isClosed?: boolean
  apr: number
  // pnl history arrays for different windows
  portfolio?: {
    day?:     { pnlHistory?: Array<[number, number]>; accountValueHistory?: Array<[number, number]> }
    week?:    { pnlHistory?: Array<[number, number]> }
    month?:   { pnlHistory?: Array<[number, number]>; accountValueHistory?: Array<[number, number]> }
    allTime?: { pnlHistory?: Array<[number, number]>; accountValueHistory?: Array<[number, number]> }
  }
  followers?: unknown[]
  // TVL may come in as a string or number
  tvl?: string | number
  maxDrawdown?: number
}

export interface VaultSummary {
  vaultAddress: string
  name: string
  leader: string
  description: string
  tvl: number
  apr: number
  maxDrawdown: number
  followers: number
  allTimePnl: number
  dayPnl: number
  weekPnl: number
  monthPnl: number
}

function safeNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseFloat(v) || 0
  return 0
}

// Extract last pnl value from a pnlHistory array (each entry is [timestamp, cumPnl])
function lastPnl(arr?: Array<[number, number]>): number {
  if (!arr || arr.length === 0) return 0
  const last = arr[arr.length - 1]
  return Array.isArray(last) ? (last[1] ?? 0) : 0
}

// Approximate TVL from last accountValueHistory entry
function lastAV(arr?: Array<[number, number]>): number {
  if (!arr || arr.length === 0) return 0
  const last = arr[arr.length - 1]
  return Array.isArray(last) ? (last[1] ?? 0) : 0
}

export async function GET() {
  try {
    const res = await fetch(STATS_URL, {
      next: { revalidate: 300 },  // 5 min server cache
    })
    if (!res.ok) throw new Error(`stats-data ${res.status}`)

    const data = (await res.json()) as StatsVault[]
    if (!Array.isArray(data)) throw new Error('unexpected shape')

    const vaults: VaultSummary[] = data
      .filter(v => !v.isClosed && v.vaultAddress)
      .map(v => {
        const p = v.portfolio
        const tvl = safeNum(v.tvl) || lastAV(p?.allTime?.accountValueHistory) || lastAV(p?.month?.accountValueHistory)
        const allTimePnl = lastPnl(p?.allTime?.pnlHistory)
        const monthPnl   = lastPnl(p?.month?.pnlHistory)
        const weekPnl    = lastPnl(p?.week?.pnlHistory)
        const dayPnl     = lastPnl(p?.day?.pnlHistory)
        return {
          vaultAddress: v.vaultAddress,
          name:         v.name ?? 'Unnamed Vault',
          leader:       v.leader ?? '',
          description:  v.description ?? '',
          tvl,
          apr:          safeNum(v.apr),
          maxDrawdown:  safeNum(v.maxDrawdown),
          followers:    Array.isArray(v.followers) ? v.followers.length : 0,
          allTimePnl,
          monthPnl,
          weekPnl,
          dayPnl,
        }
      })
      .filter(v => v.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 200)  // cap at top 200 by TVL to keep response lean

    return NextResponse.json(vaults, {
      headers: { 'Cache-Control': 'public, s-maxage=300' },
    })
  } catch (err) {
    console.error('[vaults]', err)
    return NextResponse.json([], { status: 200 })
  }
}
