'use client'

import { useState, useEffect, useMemo, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import LivelineChart from '@/components/LivelineChart'
import type { LivelinePoint } from '@/lib/hyperliquid'
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
  summary?: { vaultAddress: string; tvl: number; apr: number; maxDrawdown: number; followers: number }
  tvl?: string | number
  pnl?: string
  maxDrawdown?: number
  apr?: number
  followers?: Array<{ user: string; vaultEquity: string; pnl: string }>
}

type Window = '7D' | '30D' | '3M' | 'ALL'

const WINDOWS: { label: Window; days: number | null }[] = [
  { label: '7D',  days: 7 },
  { label: '30D', days: 30 },
  { label: '3M',  days: 90 },
  { label: 'ALL', days: null },
]

function fmtTvl(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : '+'
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(2)}`
}

function truncAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function parsePortfolio(raw: VaultDetail['portfolio']): LivelinePoint[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(entry => {
      const t = Array.isArray(entry) ? entry[0] : (entry as Record<string, number>).t
      const obj = Array.isArray(entry) ? entry[1] : (entry as Record<string, unknown>)
      const av = (obj as Record<string, string>)?.accountValue
      const v = parseFloat(av ?? '0')
      if (!t || isNaN(v)) return null
      return { time: Math.floor((t as number) / 1000), value: v }
    })
    .filter((p): p is LivelinePoint => p !== null)
}

export default function VaultDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params)
  const router = useRouter()

  const [vault, setVault]       = useState<VaultDetail | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [timeWindow, setTimeWindow] = useState<Window>('30D')
  const [scrubPrice, setScrub]  = useState<number | null>(null)

  useEffect(() => {
    // Fetch directly client-side — avoids server-side IP restrictions on HL APIs
    fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'vaultDetails', vaultAddress: address }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<VaultDetail> })
      .then(d => { setVault(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [address])

  const allPoints  = useMemo(() => parsePortfolio(vault?.portfolio ?? []), [vault])

  const chartData  = useMemo(() => {
    const cfg = WINDOWS.find(w => w.label === timeWindow)
    if (!cfg || cfg.days === null || allPoints.length === 0) return allPoints
    const cutoff = (Date.now() / 1000) - cfg.days * 86400
    return allPoints.filter(p => p.time >= cutoff)
  }, [allPoints, timeWindow])

  const latestEquity = chartData.at(-1)?.value ?? 0
  const firstEquity  = chartData[0]?.value ?? latestEquity
  const windowDiff   = latestEquity - firstEquity
  const windowPct    = firstEquity > 0 ? (windowDiff / firstEquity) * 100 : 0
  const windowUp     = windowDiff >= 0
  const chartColor   = windowUp ? '#26ab83' : '#E84332'

  const displayEquity = scrubPrice ?? latestEquity

  const handleScrub = useCallback((p: number | null) => setScrub(p), [])

  const summary = vault?.summary
  const tvl         = summary?.tvl ?? (typeof vault?.tvl === 'number' ? vault.tvl : parseFloat(String(vault?.tvl ?? 0)))
  const apr         = summary?.apr ?? vault?.apr ?? 0
  const maxDrawdown = summary?.maxDrawdown ?? vault?.maxDrawdown ?? 0
  const followers   = summary?.followers ?? (vault?.followers?.length ?? 0)
  const pnl         = parseFloat(vault?.pnl ?? '0')

  const positions: VaultPosition[] = vault?.openPositions ?? []

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'calc(env(safe-area-inset-top) + 60px) 24px 0' }}>
          <button
            onClick={() => router.push('/vaults')}
            style={{ background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 28, cursor: 'pointer', padding: '4px 0', lineHeight: 1 }}
          >←</button>
        </div>

        {/* Vault identity */}
        <div style={{ padding: '24px 24px 0' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '-0.01em', lineHeight: 1.2, marginBottom: 4 }}>
            {loading ? <span style={{ color: '#1C1C1A' }}>Loading…</span> : (vault?.name ?? 'Vault')}
          </div>
          {vault?.leader && (
            <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em' }}>
              {truncAddr(vault.leader)}
            </div>
          )}
        </div>

        {/* Equity display */}
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
            {displayEquity > 0 ? fmtTvl(displayEquity) : '—'}
          </div>
          {!loading && !error && chartData.length > 0 && scrubPrice === null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: chartColor }}>{fmtUsd(windowDiff)}</span>
              <span style={{ color: chartColor }}>{windowUp ? '+' : ''}{windowPct.toFixed(2)}%</span>
            </div>
          )}
        </div>

        {/* Timeframe selector */}
        <div style={{ margin: '12px 0 4px', padding: '0 24px' }}>
          <div style={{ display: 'inline-flex', gap: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 2 }}>
            {WINDOWS.map(w => {
              const active = timeWindow === w.label
              return (
                <button
                  key={w.label}
                  onClick={() => setTimeWindow(w.label)}
                  style={{
                    background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: 'none', borderRadius: 4, padding: '3px 10px',
                    fontSize: 11, lineHeight: '16px',
                    fontFamily: 'Menlo,Monaco,monospace',
                    color: active ? '#F0EDE6' : '#46443D',
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer', transition: 'color 0.2s, background 0.15s',
                  }}
                >{w.label}</button>
              )
            })}
          </div>
        </div>

        {/* Chart */}
        {error ? (
          <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#E84332', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>FAILED TO LOAD VAULT</div>
          </div>
        ) : (
          <LivelineChart
            data={chartData}
            value={displayEquity}
            color={chartColor}
            loading={loading || chartData.length === 0}
            onScrub={handleScrub}
            formatTime={(t: number) => {
              const d = new Date(t * 1000)
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              return `${months[d.getMonth()]} ${d.getDate()}`
            }}
            padding={{ left: 24 }}
          />
        )}

        {/* Stats grid */}
        {!loading && !error && (
          <div style={{ borderTop: '1px solid #1C1C1A', margin: '0 24px', padding: '28px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 24px' }}>
            <StatCell label="AUM" value={fmtTvl(tvl)} />
            <StatCell label="APR" value={`${(apr * 100).toFixed(1)}%`} color={(apr * 100) >= 0 ? '#26ab83' : '#E84332'} />
            <StatCell label="MAX DRAWDOWN" value={`${(maxDrawdown * 100).toFixed(1)}%`} color="#E84332" />
            <StatCell label="FOLLOWERS" value={String(followers)} />
            {pnl !== 0 && <StatCell label="ALL TIME PNL" value={fmtUsd(pnl)} color={pnl >= 0 ? '#26ab83' : '#E84332'} />}
          </div>
        )}

        {/* Open positions */}
        {!loading && !error && positions.length > 0 && (
          <div style={{ padding: '0 24px' }}>
            <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 12 }}>OPEN POSITIONS</div>
            {positions.map((pos, i) => {
              const size   = parseFloat(pos.szi)
              const isLong = size >= 0
              const uPnl   = parseFloat(pos.unrealizedPnl)
              const pnlUp  = uPnl >= 0
              const roe    = parseFloat(pos.returnOnEquity) * 100
              const entryP = parseFloat(pos.entryPx)
              const posVal = parseFloat(pos.positionValue)

              return (
                <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid #1C1C1A' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{pos.coin}</span>
                        <span style={{
                          fontSize: 10, fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em',
                          padding: '2px 6px', borderRadius: 3,
                          color: isLong ? '#26ab83' : '#E84332',
                          background: isLong ? '#26ab8318' : '#E8433218',
                        }}>{isLong ? 'LONG' : 'SHORT'}</span>
                        {pos.leverage && (
                          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>{pos.leverage.value}×</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>
                        Entry ${entryP.toLocaleString(undefined, { maximumFractionDigits: 4 })} · Size {Math.abs(size).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, color: pnlUp ? '#26ab83' : '#E84332', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtUsd(uPnl)}
                      </div>
                      <div style={{ fontSize: 11, color: pnlUp ? '#26ab83' : '#E84332', fontFamily: 'Menlo,Monaco,monospace', marginTop: 2 }}>
                        {roe >= 0 ? '+' : ''}{roe.toFixed(2)}% ROE
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                    <div>
                      <div style={{ fontSize: 9, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', marginBottom: 2 }}>VALUE</div>
                      <div style={{ fontSize: 11, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>{fmtTvl(posVal)}</div>
                    </div>
                    {pos.liquidationPx && parseFloat(pos.liquidationPx) > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', marginBottom: 2 }}>LIQ PRICE</div>
                        <div style={{ fontSize: 11, color: '#E84332', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
                          ${parseFloat(pos.liquidationPx).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && !error && positions.length === 0 && (
          <div style={{ padding: '24px 24px', borderTop: '1px solid #1C1C1A', margin: '0 0' }}>
            <div style={{ fontSize: 11, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', textAlign: 'center' }}>NO OPEN POSITIONS</div>
          </div>
        )}

        <div style={{ height: 'max(env(safe-area-inset-bottom), 40px)' }} />
      </div>
    </div>
  )
}

function StatCell({ label, value, color = '#F0EDE6' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}
