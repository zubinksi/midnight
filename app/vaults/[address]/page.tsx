'use client'

import { useState, useEffect, useMemo, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import LivelineChart from '@/components/LivelineChart'
import type { LivelinePoint } from '@/lib/hyperliquid'

// Actual vaultDetails response shape (from Hyperliquid info API)
interface PortfolioBucket {
  accountValueHistory: Array<[number, string]>
  pnlHistory: Array<[number, string]>
  vlm: string
}

interface VaultDetail {
  name: string
  leader: string
  description?: string
  apr: number
  // portfolio is an array of [periodName, bucketData] tuples
  portfolio: Array<[string, PortfolioBucket]>
  followers: Array<{ user: string; vaultEquity: string; pnl: string; allTimePnl: string }>
  maxDistributable: number
  maxWithdrawable: number
  isClosed: boolean
}

// clearinghouseState response for open positions
interface RawPosition {
  position: {
    coin: string
    szi: string
    entryPx: string
    positionValue: string
    unrealizedPnl: string
    returnOnEquity: string
    liquidationPx: string | null
    leverage: { type: string; value: number }
  }
}

interface ClearinghouseState {
  assetPositions: RawPosition[]
  marginSummary?: { accountValue: string }
}

const HL_INFO = 'https://api.hyperliquid.xyz/info'

function hlPost<T>(body: unknown): Promise<T> {
  return fetch(HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<T> })
}

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

function getBucket(portfolio: VaultDetail['portfolio'], ...names: string[]): PortfolioBucket | undefined {
  for (const name of names) {
    const found = portfolio.find(([p]) => p === name)?.[1]
    if (found) return found
  }
  return undefined
}

function bucketToPoints(bucket: PortfolioBucket | undefined): LivelinePoint[] {
  if (!bucket?.accountValueHistory?.length) return []
  return bucket.accountValueHistory
    .map(([t, v]) => {
      const val = typeof v === 'number' ? v : parseFloat(v as string)
      if (!t || isNaN(val)) return null
      const time = t > 1e10 ? Math.floor(t / 1000) : Math.floor(t)
      return { time, value: val }
    })
    .filter((p): p is LivelinePoint => p !== null)
}

function pnlToPoints(bucket: PortfolioBucket | undefined): LivelinePoint[] {
  if (!bucket?.pnlHistory?.length) return []
  return bucket.pnlHistory
    .map(([t, v]) => {
      const val = typeof v === 'number' ? v : parseFloat(v as string)
      if (!t || isNaN(val)) return null
      const time = t > 1e10 ? Math.floor(t / 1000) : Math.floor(t)
      return { time, value: val }
    })
    .filter((p): p is LivelinePoint => p !== null)
}

export default function VaultDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params)
  const router = useRouter()

  const [vault, setVault]         = useState<VaultDetail | null>(null)
  const [positions, setPositions] = useState<RawPosition[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(false)
  const [chartMode, setChartMode]  = useState<'tvl' | 'profit'>('tvl')
  const [scrubPrice, setScrub]     = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      hlPost<VaultDetail>({ type: 'vaultDetails', vaultAddress: address }),
      hlPost<ClearinghouseState>({ type: 'clearinghouseState', user: address }),
    ])
      .then(([detail, ch]) => {
        setVault(detail)
        setPositions(ch.assetPositions ?? [])
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [address])

  const allTimeBucket = useMemo(() => {
    if (!vault) return undefined
    return getBucket(vault.portfolio, 'allTime', 'all_time')
  }, [vault])

  const allTvlPoints = useMemo(() => bucketToPoints(allTimeBucket), [allTimeBucket])
  const allPnlPoints = useMemo(() => pnlToPoints(allTimeBucket),    [allTimeBucket])

  const chartData = chartMode === 'profit' ? allPnlPoints : allTvlPoints

  // Liveline defaults to a 30s window — pass the actual data span so it renders
  const chartWindowSecs = useMemo(() => {
    if (chartData.length < 2) return 30 * 86400
    return chartData.at(-1)!.time - chartData[0].time
  }, [chartData])

  const latestEquity = chartData.at(-1)?.value ?? 0
  const firstEquity  = chartData[0]?.value ?? latestEquity
  const windowDiff   = latestEquity - firstEquity
  const windowPct    = firstEquity > 0 ? (windowDiff / firstEquity) * 100 : 0
  const windowUp     = windowDiff >= 0
  const chartColor   = windowUp ? '#26ab83' : '#E84332'
  const displayEquity = scrubPrice ?? latestEquity

  const handleScrub = useCallback((p: number | null) => setScrub(p), [])

  const apr         = (vault?.apr ?? 0) * 100
  const allTimePnl  = vault?.followers
    ?.find(f => f.user === 'Leader')?.allTimePnl ?? null

  // Sum followers' vaultEquity as AUM
  const tvl = useMemo(() => {
    if (!vault) return 0
    return vault.followers.reduce((sum, f) => sum + parseFloat(f.vaultEquity || '0'), 0)
  }, [vault])

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

        {/* Equity / PNL display */}
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
            {displayEquity !== 0 ? (chartMode === 'profit' ? fmtUsd(displayEquity) : fmtTvl(displayEquity)) : '—'}
          </div>
          {!loading && !error && chartData.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: chartColor }}>{fmtUsd(windowDiff)}</span>
              <span style={{ color: chartColor }}>{windowUp ? '+' : ''}{windowPct.toFixed(2)}%</span>
            </div>
          )}
        </div>

        {/* Chart mode toggle */}
        <div style={{ margin: '12px 0 4px', padding: '0 24px' }}>
          <div style={{ display: 'inline-flex', gap: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 2 }}>
            {(['tvl', 'profit'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => { setChartMode(mode); setScrub(null) }}
                style={{
                  background: chartMode === mode ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: 'none', borderRadius: 4, padding: '3px 10px',
                  fontSize: 11, lineHeight: '16px',
                  fontFamily: 'Menlo,Monaco,monospace',
                  color: chartMode === mode ? '#F0EDE6' : '#46443D',
                  fontWeight: chartMode === mode ? 600 : 400,
                  cursor: 'pointer', transition: 'color 0.2s, background 0.15s',
                  textTransform: 'uppercase',
                }}
              >{mode === 'tvl' ? 'TVL' : 'PROFIT'}</button>
            ))}
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
            value={latestEquity}
            color={chartColor}
            loading={loading || chartData.length === 0}
            window={chartWindowSecs}
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
            <StatCell label="TVL" value={tvl > 0 ? fmtTvl(tvl) : '—'} />
            <StatCell label="30D RETURN (APR)" value={`${apr >= 0 ? '+' : ''}${apr.toFixed(1)}%`} color={apr >= 0 ? '#26ab83' : '#E84332'} />
            {allTimePnl !== null && (
              <StatCell
                label="ALL TIME PNL"
                value={fmtUsd(parseFloat(allTimePnl))}
                color={parseFloat(allTimePnl) >= 0 ? '#26ab83' : '#E84332'}
              />
            )}
          </div>
        )}

        {/* Open positions */}
        {!loading && !error && positions.length > 0 && (
          <div style={{ padding: '0 24px' }}>
            <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 12 }}>OPEN POSITIONS</div>
            {positions.map((entry, i) => {
              const pos    = entry.position
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
          <div style={{ padding: '24px 24px', borderTop: '1px solid #1C1C1A' }}>
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
