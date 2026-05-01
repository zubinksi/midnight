'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { LivelineSeries, WindowOption } from 'liveline'
import type { LivelinePoint, Timeframe } from '@/lib/hyperliquid'
import { fetchCandles } from '@/lib/hyperliquid'
import type { AssetInfo } from '@/lib/assets'
import { COMPARE_COLORS } from '@/components/CompareModal'
import { getAssetName } from '@/lib/assetNames'

const Liveline = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

const WINDOWS: WindowOption[] = [
  { label: '1D', secs: 86400 },
  { label: '7D', secs: 604800 },
  { label: '1M', secs: 2592000 },
  { label: '3M', secs: 7776000 },
  { label: '6M', secs: 15552000 },
]

const SECS_TO_TF: Record<number, Timeframe> = {
  86400: '1D', 604800: '7D', 2592000: '1M', 7776000: '3M', 15552000: '6M',
}
const TF_TO_SECS: Record<Timeframe, number> = {
  '1D': 86400, '7D': 604800, '1M': 2592000, '3M': 7776000, '6M': 15552000,
}

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

  const [timeframe, setTimeframe]   = useState<Timeframe>('1D')
  const [coinMap, setCoinMap]       = useState<Record<string, string>>({})
  const [seriesData, setSeriesData] = useState<Record<string, LivelinePoint[]>>({})
  const [loading, setLoading]       = useState(true)
  const [mounted, setMounted]       = useState(false)

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

  const handleWindowChange = useCallback((secs: number) => {
    const tf = SECS_TO_TF[secs]
    if (tf) setTimeframe(tf)
  }, [])

  const primaryData  = seriesData[tickers[0]] ?? []
  const primaryValue = primaryData.at(-1)?.value ?? 0

  const additionalSeries: LivelineSeries[] = tickers.slice(1).map((ticker, i) => {
    const data = seriesData[ticker] ?? []
    return { id: ticker, data, value: data.at(-1)?.value ?? 0, color: COMPARE_COLORS[i + 1], label: ticker }
  })

  const isLoading = !mounted || loading

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ padding: 'max(env(safe-area-inset-top), 56px) 24px 0' }}>
          <button
            onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
            style={S.backBtn}
          >← WATCHLIST</button>
        </div>

        {/* Legend */}
        <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tickers.map((ticker, i) => {
            const pts      = seriesData[ticker] ?? []
            const pct      = pts.at(-1)?.value ?? 0
            const hasData  = pts.length > 0
            const color    = pct >= 0 ? '#26ab83' : '#E84332'
            return (
              <div key={ticker} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[i], flexShrink: 0, marginBottom: 1 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', width: 90, flexShrink: 0 }}>{ticker}</span>
                <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', flex: 1 }}>{getAssetName(ticker)}</span>
                {hasData && !loading && (
                  <span style={{ fontSize: 13, color, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtPct(pct)}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Chart */}
        <div style={{ marginTop: 28, height: 280 }}>
          {mounted && (
            <Liveline
              data={primaryData}
              value={primaryValue}
              color={COMPARE_COLORS[0]}
              series={additionalSeries.length > 0 ? additionalSeries : undefined}
              theme="dark"
              grid
              scrub
              padding={{ bottom: 0 }}
              loading={isLoading}
              lineWidth={1.5}
              window={TF_TO_SECS[timeframe]}
              windows={WINDOWS}
              onWindowChange={handleWindowChange}
              formatValue={fmtPct}
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </div>

        {/* Attribution */}
        <div style={{ padding: '16px 24px 40px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
            % CHANGE FROM WINDOW OPEN · POWERED BY HYPERLIQUID
          </span>
        </div>

        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>
    </div>
  )
}

const S = {
  backBtn: { background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer', padding: 0 } as React.CSSProperties,
}
