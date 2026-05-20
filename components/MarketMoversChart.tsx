'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import type { LivelineSeries } from 'liveline'
import type { AssetInfo } from '@/lib/assets'
import { fetchCandles, fetchNYSEClosePrice, getNYSESessionLabel } from '@/lib/hyperliquid'
import type { LivelinePoint } from '@/lib/hyperliquid'
import CompareModal, { COMPARE_COLORS } from '@/components/CompareModal'
import { getAssetName } from '@/lib/assetNames'

const Liveline = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

function normalizeFrom(pts: LivelinePoint[], base: number): LivelinePoint[] {
  if (pts.length === 0 || base === 0) return []
  return pts.map(p => ({ time: p.time, value: ((p.value / base) - 1) * 100 }))
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

interface MoverInfo {
  ticker: string
  coin: string
  base: number
  seedPct: number
  data: LivelinePoint[]
}

interface Props {
  xyzAssets: AssetInfo[]
  prices: Record<string, number>
  allAssets: AssetInfo[]
  onCompare: (tickers: string[]) => void
}

export default function MarketMoversChart({ xyzAssets, prices, allAssets, onCompare }: Props) {
  const [mounted, setMounted]   = useState(false)
  const [movers, setMovers]     = useState<MoverInfo[]>([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => setMounted(true), [])

  const sessionLabel = getNYSESessionLabel()
  const isOpen = sessionLabel === null

  useEffect(() => {
    if (xyzAssets.length === 0) return
    let cancelled = false
    setLoading(true)

    const top15 = xyzAssets.slice(0, 15)

    async function compute() {
      let candidates: Array<{ ticker: string; coin: string; pct: number; base: number }>

      if (isOpen) {
        candidates = top15
          .filter(a => a.prevDayPx > 0)
          .map(a => ({
            ticker: a.ticker,
            coin: a.coin,
            pct: ((a.price - a.prevDayPx) / a.prevDayPx) * 100,
            base: a.prevDayPx,
          }))
          .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
          .slice(0, 3)
      } else {
        const closePrices = await Promise.all(
          top15.map(a => fetchNYSEClosePrice(a.coin).catch(() => null))
        )
        candidates = top15
          .map((a, i) => {
            const cp = closePrices[i]
            if (!cp || cp === 0) return null
            return {
              ticker: a.ticker,
              coin: a.coin,
              pct: ((a.price - cp) / cp) * 100,
              base: cp,
            }
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
          .slice(0, 3)
      }

      if (cancelled) return
      if (candidates.length === 0) { if (!cancelled) setLoading(false); return }

      const candleResults = await Promise.all(
        candidates.map(c => fetchCandles(c.coin, '1D').catch(() => [] as LivelinePoint[]))
      )

      if (cancelled) return

      setMovers(candidates.map((c, i) => ({
        ticker: c.ticker,
        coin: c.coin,
        base: c.base,
        seedPct: c.pct,
        data: normalizeFrom(candleResults[i], c.base),
      })))
      setLoading(false)
    }

    compute()
    return () => { cancelled = true }
  }, [xyzAssets.length, isOpen])

  const title = isOpen
    ? 'Market Movers'
    : sessionLabel === 'PRE-MKT'
    ? 'Pre Market Action'
    : 'After Hours Action'

  const allSeries: LivelineSeries[] = movers.map((m, i) => {
    const livePrice = prices[m.ticker]
    const liveValue = livePrice !== undefined && m.base > 0
      ? ((livePrice / m.base) - 1) * 100
      : m.data.at(-1)?.value ?? 0
    return {
      id: m.ticker,
      data: m.data,
      value: liveValue,
      color: COMPARE_COLORS[i],
      label: m.ticker,
    }
  })

  const primaryData  = allSeries[0]?.data ?? []
  const primaryValue = allSeries[0]?.value ?? 0
  const isChartLoading = !mounted || loading

  return (
    <>
      {/* Title row */}
      <div style={{ padding: '0 24px', marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#F0EDE6', fontFamily: 'Inter,sans-serif', lineHeight: 1.2, marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Inter,sans-serif', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
          POWERED BY HYPERLIQUID &amp; TRADE.XYZ
        </div>
      </div>

      {/* Legend */}
      {!loading && movers.length > 0 && (
        <div style={{ padding: '0 24px 6px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {movers.map((m, i) => {
            const livePrice = prices[m.ticker]
            const pct = livePrice !== undefined && m.base > 0
              ? ((livePrice - m.base) / m.base) * 100
              : m.seedPct
            const color = pct >= 0 ? '#26ab83' : '#E84332'
            return (
              <div key={m.ticker} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: COMPARE_COLORS[i], flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Inter,sans-serif', flexShrink: 0 }}>{m.ticker}</span>
                <span style={{ fontSize: 11, color: '#2C2C2A', fontFamily: 'Inter,sans-serif', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getAssetName(m.ticker)}</span>
                <span style={{ fontSize: 11, color, fontFamily: 'Inter,sans-serif', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtPct(pct)}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Chart */}
      <div>
        {mounted ? (
          <Liveline
            data={primaryData}
            value={primaryValue}
            color={COMPARE_COLORS[0]}
            series={allSeries.length > 0 ? allSeries : undefined}
            theme="dark"
            grid
            scrub
            loading={isChartLoading}
            lineWidth={1.5}
            window={86400}
            formatValue={fmtPct}
            formatTime={(t: number) => {
              const d = new Date(t * 1000)
              return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            }}
            padding={{ left: 24 }}
            style={{ width: '100%', height: 200 }}
          />
        ) : (
          <div style={{ height: 200 }} />
        )}
      </div>

      {/* Compare button */}
      <div style={{ padding: '12px 24px 0' }}>
        <button
          onClick={() => setShowModal(true)}
          style={{
            width: '100%', background: 'none', border: '1px solid #2C2C2A',
            borderRadius: 10, color: '#46443D', fontFamily: 'Inter,sans-serif',
            fontSize: 12, letterSpacing: '0.08em', cursor: 'pointer',
            padding: '12px 0', lineHeight: '16px',
          }}
        >COMPARE ⇄</button>
      </div>

      {showModal && (
        <CompareModal
          baseTicker=""
          allAssets={allAssets}
          onClose={() => setShowModal(false)}
          onCompare={tickers => { setShowModal(false); onCompare(tickers) }}
        />
      )}
    </>
  )
}
