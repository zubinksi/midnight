'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

// stats-data endpoint — the same one the HL app uses client-side
const STATS_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/vaults'

// Actual structure from stats-data.hyperliquid.xyz/Mainnet/vaults:
// { apr: number, pnls: [["day", [str,...]], ["week",[...]], ["month",[...]], ...], summary: {...} }

interface RawSummary {
  // could be camelCase or snake_case
  vaultAddress?: string
  vault_address?: string
  name?: string
  leader?: string
  tvl?: string | number
  isClosed?: boolean
  is_closed?: boolean
  followers?: unknown[]
  maxDrawdown?: number
  max_drawdown?: number
}

interface RawVault {
  apr?: number | string
  // pnls is an array of [periodName, valuesArray] tuples
  pnls?: Array<[string, string[]]>
  summary?: RawSummary
}

export interface VaultSummary {
  vaultAddress: string
  name: string
  leader: string
  tvl: number
  apr: number
  monthPnl: number
  followers: number
}

function safeNum(v: unknown): number {
  if (typeof v === 'number' && !isNaN(v)) return v
  if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n }
  return 0
}

// pnls entries are [periodName, valuesArray] — last element of values is current cumulative PNL
function pnlForPeriod(pnls: Array<[string, string[]]> | undefined, period: string): number {
  if (!pnls) return 0
  const entry = pnls.find(([p]) => p === period)
  if (!entry || !entry[1] || entry[1].length === 0) return 0
  return safeNum(entry[1][entry[1].length - 1])
}

function parseVaults(raw: RawVault[]): VaultSummary[] {
  return raw
    .map(v => {
      const s = v.summary ?? {}
      const addr   = s.vaultAddress ?? s.vault_address ?? ''
      const closed = s.isClosed     ?? s.is_closed     ?? false
      if (closed || !addr) return null

      const tvl = safeNum(s.tvl)
      if (tvl <= 0) return null

      const monthPnl = pnlForPeriod(v.pnls, 'month')

      return {
        vaultAddress: addr,
        name:         s.name    ?? 'Unnamed Vault',
        leader:       s.leader  ?? '',
        tvl,
        apr:          safeNum(v.apr),
        monthPnl,
        followers:    Array.isArray(s.followers) ? s.followers.length : 0,
      }
    })
    .filter((v): v is VaultSummary => v !== null)
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 200)
}

type SortKey = 'apr' | 'tvl' | 'monthPnl'

function fmtTvl(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function truncAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function VaultsPage() {
  const router = useRouter()
  const [vaults, setVaults]     = useState<VaultSummary[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [sortBy, setSortBy]     = useState<SortKey>('monthPnl')
  const [showSort, setShowSort] = useState(false)

  const [rawSample, setRawSample] = useState<string>('')

  useEffect(() => {
    fetch(STATS_URL)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<RawVault[]> })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const first = data[0]
          const topKeys = Object.keys(first)
          const summaryKeys = first.summary ? Object.keys(first.summary) : []
          setRawSample(`total=${data.length} topKeys=[${topKeys}] summaryKeys=[${summaryKeys}] sample=${JSON.stringify(first.summary).slice(0, 200)}`)
        }
        setVaults(parseVaults(data))
        setLoading(false)
      })
      .catch(err => { setRawSample(String(err)); setError(true); setLoading(false) })
  }, [])

  const sorted = useMemo(() => {
    return [...vaults].sort((a, b) => {
      if (sortBy === 'apr')      return b.apr - a.apr
      if (sortBy === 'monthPnl') return b.monthPnl - a.monthPnl
      return b.tvl - a.tvl
    })
  }, [vaults, sortBy])

  const sortLabels: Record<SortKey, string> = {
    apr:      'APR',
    tvl:      'AUM',
    monthPnl: '30D PNL',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#080807', overflow: 'hidden' }}>
      <div style={{ maxWidth: 430, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ flexShrink: 0, padding: '0 24px', paddingTop: 'calc(env(safe-area-inset-top) + 62px)' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={S.hero}>Custom Vaults</div>
            <div style={{ ...S.hero, color: '#46443D' }}>On Hyperliquid.</div>
          </div>
        </div>

        {/* Sort row */}
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 24px' }}>
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Inter,sans-serif', letterSpacing: '0.08em' }}>
            {loading ? '…' : error ? 'ERROR' : `${vaults.length} VAULTS`}
          </span>
          <button
            onClick={() => setShowSort(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 4px 8px', color: '#46443D', fontFamily: 'Inter,sans-serif', fontSize: 10, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {sortLabels[sortBy]}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="2" y1="3.5" x2="12" y2="3.5" />
              <line x1="2" y1="7"   x2="9"  y2="7"   />
              <line x1="2" y1="10.5" x2="6" y2="10.5" />
              <polyline points="11,5 13,7 11,9" />
            </svg>
          </button>
        </div>

        <div style={{ flexShrink: 0, borderTop: '1px solid #1C1C1A' }} />

        {/* Sort sheet */}
        {showSort && (
          <div
            onClick={() => setShowSort(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000000BB', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' } as React.CSSProperties}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="slide-up"
              style={{ width: '100%', maxWidth: 430, background: '#0F0F0E', borderTop: '1px solid #1C1C1A', borderRadius: '20px 20px 0 0', padding: '28px 24px', paddingBottom: 'max(32px, env(safe-area-inset-bottom))' }}
            >
              <div style={{ width: 36, height: 4, background: '#46443D', borderRadius: 2, margin: '0 auto 24px' }} />
              <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Inter,sans-serif', letterSpacing: '0.1em', marginBottom: 16 }}>SORT BY</div>
              {(['tvl', 'apr', 'monthPnl'] as SortKey[]).map(key => (
                <button
                  key={key}
                  onClick={() => { setSortBy(key); setShowSort(false) }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #1C1C1A', padding: '16px 0', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 14, color: '#F0EDE6', fontFamily: 'Inter,sans-serif' }}>{sortLabels[key]}</span>
                  {sortBy === key && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83' }} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Vault list */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <div style={{ padding: '0 24px' }}>
            {loading ? (
              <VaultLoadingRows />
            ) : error ? (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 11, color: '#E84332', fontFamily: 'Inter,sans-serif', letterSpacing: '0.08em' }}>FAILED TO LOAD VAULTS</span>
              </div>
            ) : sorted.length === 0 ? (
              <div style={{ padding: '24px 0' }}>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <span style={{ fontSize: 11, color: '#2C2C2A', fontFamily: 'Inter,sans-serif', letterSpacing: '0.08em' }}>NO VAULTS FOUND</span>
                </div>
                {rawSample && (
                  <div style={{ fontSize: 9, color: '#46443D', fontFamily: 'Inter,sans-serif', wordBreak: 'break-all', lineHeight: 1.5 }}>
                    {rawSample}
                  </div>
                )}
              </div>
            ) : (
              sorted.map(vault => (
                <VaultRow
                  key={vault.vaultAddress}
                  vault={vault}
                  sortBy={sortBy}
                  onClick={() => router.push(`/vaults/${vault.vaultAddress}`)}
                />
              ))
            )}
          </div>
          <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
        </div>

      </div>
    </div>
  )
}

function fmtPnl(v: number): string {
  const abs = Math.abs(v)
  const sign = v >= 0 ? '+' : '-'
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function VaultRow({ vault, sortBy, onClick }: { vault: VaultSummary; sortBy: SortKey; onClick: () => void }) {
  const aprPct   = vault.apr * 100
  const aprUp    = aprPct >= 0
  const monthUp  = vault.monthPnl >= 0

  const badge = sortBy === 'apr'
    ? { label: `${aprUp ? '+' : ''}${aprPct.toFixed(1)}%`, color: aprUp ? '#26ab83' : '#E84332', bg: aprUp ? '#26ab8322' : '#E8433218' }
    : sortBy === 'monthPnl'
    ? { label: fmtPnl(vault.monthPnl), color: monthUp ? '#26ab83' : '#E84332', bg: monthUp ? '#26ab8322' : '#E8433218' }
    : null

  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1C1C1A', cursor: 'pointer', gap: 10 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Inter,sans-serif', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {vault.name}
        </div>
        <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Inter,sans-serif', marginTop: 3 }}>
          {truncAddr(vault.leader)}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 15, color: '#F0EDE6', fontFamily: 'Inter,sans-serif', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
          {fmtTvl(vault.tvl)}
        </div>
        {badge ? (
          <div style={{ marginTop: 3 }}>
            <span style={{
              display: 'inline-block', padding: '2px 7px', borderRadius: 4,
              fontSize: 11, fontFamily: 'Inter,sans-serif',
              fontVariantNumeric: 'tabular-nums', color: badge.color, background: badge.bg,
            }}>{badge.label}</span>
          </div>
        ) : (
          <div style={{ marginTop: 3 }}>
            <span style={{
              display: 'inline-block', padding: '2px 7px', borderRadius: 4,
              fontSize: 11, fontFamily: 'Inter,sans-serif',
              fontVariantNumeric: 'tabular-nums', color: aprUp ? '#26ab83' : '#E84332',
              background: aprUp ? '#26ab8322' : '#E8433218',
            }}>{aprUp ? '+' : ''}{aprPct.toFixed(1)}% APR</span>
          </div>
        )}
      </div>
      <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke="#2C2C2A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="1,1 6,6 1,11" />
      </svg>
    </div>
  )
}

function VaultLoadingRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1C1C1A', gap: 10, opacity: 1 - i * 0.1 }}>
          <div style={{ flex: 1 }}>
            <div style={{ width: 140, height: 15, background: '#1C1C1A', borderRadius: 3, marginBottom: 5 }} />
            <div style={{ width: 80, height: 11, background: '#1C1C1A', borderRadius: 3 }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ width: 64, height: 15, background: '#1C1C1A', borderRadius: 3, marginBottom: 5 }} />
            <div style={{ width: 50, height: 18, background: '#1C1C1A', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </>
  )
}

const S = {
  hero: { fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: '#F0EDE6', fontFamily: 'Inter,sans-serif' } as React.CSSProperties,
}
