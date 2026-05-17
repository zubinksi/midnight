'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { LivelineSeries } from 'liveline'
import type { LivelinePoint, Timeframe } from '@/lib/hyperliquid'
import { fetchCandles } from '@/lib/hyperliquid'
import type { AssetInfo } from '@/lib/assets'
import { COMPARE_COLORS } from '@/components/CompareModal'
import { getAssetName } from '@/lib/assetNames'

const Liveline = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

const STORAGE_KEY = 'neue-saved-compares'
interface SavedCompare { tickers: string[]; savedAt: number }
function loadSaved(): SavedCompare[] {
  try { const v = localStorage.getItem(STORAGE_KEY); return v ? JSON.parse(v) : [] } catch { return [] }
}
function writeSaved(list: SavedCompare[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch {}
}

const WINDOW_SECS: Partial<Record<Timeframe, number>> = {
  '7D': 604800, '1M': 2592000, '3M': 7776000, '6M': 15552000,
}

const WINDOWS: { label: string; tf: Timeframe }[] = [
  { label: '7D',  tf: '7D'  },
  { label: '1M',  tf: '1M'  },
  { label: '3M',  tf: '3M'  },
  { label: '6M',  tf: '6M'  },
  { label: 'ALL', tf: 'ALL' },
]

function normalize(pts: LivelinePoint[]): LivelinePoint[] {
  if (pts.length === 0) return []
  const base = pts[0].value
  if (base === 0) return pts
  return pts.map(p => ({ time: p.time, value: ((p.value / base) - 1) * 100 }))
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export default function ComparePage({ params }: { params: Promise<{ tickers: string }> }) {
  const { tickers: raw } = use(params)
  const tickers = raw.split('_').map(t => t.toUpperCase()).slice(0, 4)
  const router  = useRouter()

  const [timeframe, setTimeframe]   = useState<Timeframe>('7D')
  const [coinMap, setCoinMap]       = useState<Record<string, string>>({})
  const [seriesData, setSeriesData] = useState<Record<string, LivelinePoint[]>>({})
  const [loading, setLoading]       = useState(true)
  const [mounted, setMounted]       = useState(false)
  const [starred, setStarred]       = useState(false)

  // Sync starred state from localStorage on mount
  useEffect(() => {
    const key = [...tickers].sort().join('_')
    setStarred(loadSaved().some(s => [...s.tickers].sort().join('_') === key))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    Promise.all([
      fetch('/api/assets').then(r => r.json() as Promise<AssetInfo[]>),
      fetch('/api/crypto').then(r => r.json() as Promise<AssetInfo[]>),
    ]).then(([xyz, crypto]) => {
      const map: Record<string, string> = {}
      for (const a of [...xyz, ...crypto]) map[a.ticker] = a.coin
      setCoinMap(map)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (Object.keys(coinMap).length === 0) return
    let cancelled = false
    setLoading(true)
    Promise.all(
      tickers.map(async ticker => {
        const coin = coinMap[ticker] ?? ticker
        const pts  = await fetchCandles(coin, timeframe).catch(() => [] as LivelinePoint[])
        return { ticker, pts: normalize(pts) }
      })
    ).then(results => {
      if (cancelled) return
      const next: Record<string, LivelinePoint[]> = {}
      for (const { ticker, pts } of results) next[ticker] = pts
      setSeriesData(next)
      setLoading(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinMap, timeframe, raw])

  const toggleStar = useCallback(() => {
    const key     = [...tickers].sort().join('_')
    const current = loadSaved()
    const exists  = current.some(s => [...s.tickers].sort().join('_') === key)
    const next    = exists
      ? current.filter(s => [...s.tickers].sort().join('_') !== key)
      : [{ tickers, savedAt: Date.now() }, ...current].slice(0, 20)
    writeSaved(next)
    setStarred(!exists)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  const primaryData  = seriesData[tickers[0]] ?? []
  const primaryValue = primaryData.at(-1)?.value ?? 0

  const chartWindow = timeframe === 'ALL' && primaryData.length > 1
    ? Math.ceil((primaryData.at(-1)!.time - primaryData[0].time) * 1.02)
    : WINDOW_SECS[timeframe]

  const allSeries: LivelineSeries[] = tickers.map((ticker, i) => {
    const data = seriesData[ticker] ?? []
    return { id: ticker, data, value: data.at(-1)?.value ?? 0, color: COMPARE_COLORS[i], label: ticker }
  })

  const isLoading = !mounted || loading

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'calc(env(safe-area-inset-top) + 60px) 24px 0' }}>
          <button
            onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
            style={S.backBtn}
          >←</button>
          <button
            onClick={toggleStar}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: starred ? '#F0C84A' : '#2C2C2A', padding: '4px 0', lineHeight: 1, transition: 'color 0.15s' }}
          >★</button>
        </div>

        {/* Legend */}
        <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tickers.map((ticker, i) => {
            const pts   = seriesData[ticker] ?? []
            const pct   = pts.at(-1)?.value ?? 0
            const color = pct >= 0 ? '#26ab83' : '#E84332'
            return (
              <div key={ticker} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[i], flexShrink: 0, marginBottom: 1 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', width: 90, flexShrink: 0 }}>{ticker}</span>
                <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', flex: 1 }}>{getAssetName(ticker)}</span>
                {pts.length > 0 && !loading && (
                  <span style={{ fontSize: 13, color, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtPct(pct)}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Time window selector */}
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ display: 'inline-flex', gap: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 2 }}>
            {WINDOWS.map(w => {
              const active = timeframe === w.tf
              return (
                <button
                  key={w.tf}
                  onClick={() => setTimeframe(w.tf)}
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
        <div style={{ marginTop: 12 }}>
          {mounted && (
            <Liveline
              data={primaryData}
              value={primaryValue}
              color={COMPARE_COLORS[0]}
              series={allSeries}
              theme="dark"
              grid
              scrub
              loading={isLoading}
              lineWidth={1.5}
              window={chartWindow}
              formatValue={fmtPct}
              formatTime={timeframe !== '1D' ? (t: number) => {
                const d = new Date(t * 1000)
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                return `${months[d.getMonth()]} ${d.getDate()}`
              } : undefined}
              padding={{ left: 24 }}
              style={{ width: '100%', height: 360 }}
            />
          )}
        </div>

        {/* Attribution */}
        <div style={{ padding: '8px 24px 40px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
            LIVE · POWERED BY HYPERLIQUID
          </span>
        </div>

        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>
    </div>
  )
}

const S = {
  backBtn: { background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 28, cursor: 'pointer', padding: '4px 0', lineHeight: 1 } as React.CSSProperties,
}
