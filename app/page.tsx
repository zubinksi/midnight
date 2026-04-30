'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ASSETS, AssetCategory } from '@/lib/assets'
import { useAllPrices, useDay24hOpens } from '@/lib/hyperliquid'
import { formatPrice, formatDate } from '@/lib/format'
import Sparkline from '@/components/Sparkline'

type Filter = 'all' | AssetCategory

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',       label: 'ALL' },
  { key: 'stock',     label: 'STOCKS' },
  { key: 'index',     label: 'INDICES' },
  { key: 'commodity', label: 'CMDTY' },
]

// Accumulates a rolling price history per asset for sparklines.
function usePriceHistory(prices: Record<string, number>, maxPoints = 60) {
  const historyRef = useRef<Record<string, number[]>>({})

  for (const a of ASSETS) {
    const p = prices[a.ticker]
    if (p === undefined) continue
    if (!historyRef.current[a.ticker]) historyRef.current[a.ticker] = []
    const arr = historyRef.current[a.ticker]
    if (arr.length === 0 || arr[arr.length - 1] !== p) {
      arr.push(p)
      if (arr.length > maxPoints) arr.shift()
    }
  }

  return historyRef.current
}

// Need useRef from React
import { useRef } from 'react'

export default function Home() {
  const router = useRouter()
  const prices  = useAllPrices(800)
  const opens   = useDay24hOpens()       // actual 24h candle opens for change %
  const history = usePriceHistory(prices)
  const [filter, setFilter] = useState<Filter>('all')
  const [clock, setClock] = useState(formatDate())

  useEffect(() => {
    const t = setInterval(() => setClock(formatDate()), 30000)
    return () => clearInterval(t)
  }, [])

  const visible = ASSETS.filter(a => filter === 'all' || a.category === filter)

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ paddingTop: 'max(env(safe-area-inset-top), 56px)', padding: '0 24px' }}>
          <div style={{ paddingTop: 'max(env(safe-area-inset-top), 56px)' }}>
            {/* Top row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
              <span style={S.label}>MIDNIGHT</span>
              <span style={S.label}>{clock}</span>
            </div>

            {/* Hero */}
            <div style={{ marginBottom: 20 }}>
              <div style={S.hero}>After Hours.</div>
              <div style={{ ...S.hero, color: '#46443D' }}>24/7.</div>
            </div>

            {/* Live badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
              <div className="pulse-dot" style={S.dot} />
              <span style={S.label}>LIVE · HYPERLIQUID · 247 MARKETS</span>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ borderTop: '1px solid #1C1C1A', display: 'flex', overflowX: 'auto', padding: '0 8px' }}>
          {FILTERS.map(({ key, label }) => {
            const active = filter === key
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                style={{
                  padding: '12px 16px',
                  fontSize: 11,
                  fontFamily: 'Menlo,Monaco,monospace',
                  letterSpacing: '0.07em',
                  color: active ? '#F0EDE6' : '#46443D',
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? '1.5px solid #26ab83' : '1.5px solid transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s, border-color 0.15s',
                  flexShrink: 0,
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Watchlist rows */}
        <div style={{ padding: '0 24px' }}>
          {visible.map(asset => {
            const price    = prices[asset.ticker] ?? asset.seedPrice
            const open     = opens[asset.ticker]  ?? null
            const hist     = history[asset.ticker] ?? [price]
            // Use 24h candle open if available, else first poll value
            const baseOpen = open ?? hist[0]
            const diff     = price - baseOpen
            const pct      = baseOpen !== 0 ? (diff / baseOpen) * 100 : 0
            const up       = diff >= 0
            const color    = up ? '#26ab83' : '#E84332'
            const priceStr = formatPrice(asset.ticker, price)
            const pctStr   = `${up ? '+' : ''}${pct.toFixed(2)}%`
            // Show pill only when we have a real open to compare against
            const hasChange = open !== null

            return (
              <div
                key={asset.ticker}
                onClick={() => router.push(`/chart/${asset.ticker}`)}
                style={{ display: 'flex', alignItems: 'center', padding: '18px 0', borderBottom: '1px solid #1C1C1A', cursor: 'pointer', gap: 12 }}
              >
                {/* Left */}
                <div style={{ width: 52, flexShrink: 0 }}>
                  <div style={S.ticker}>{asset.ticker}</div>
                  <div style={S.name}>{asset.name.slice(0, 8)}</div>
                </div>

                {/* Sparkline */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <Sparkline values={hist} width={88} height={28} color={color} />
                </div>

                {/* Right */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={S.price}>{priceStr}</div>
                  {hasChange ? (
                    <div style={{ marginTop: 3 }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 7px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontFamily: 'Menlo,Monaco,monospace',
                        fontVariantNumeric: 'tabular-nums',
                        color,
                        background: up ? '#26ab8322' : '#E8433218',
                      }}>
                        {pctStr}
                      </span>
                    </div>
                  ) : (
                    <div style={{ marginTop: 3, height: 20 }} /> // placeholder while loading
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>
    </div>
  )
}

const S = {
  label: {
    fontSize: 11,
    color: '#46443D',
    letterSpacing: '0.08em',
    fontFamily: 'Menlo,Monaco,monospace',
  } as React.CSSProperties,
  hero: {
    fontSize: 38,
    fontWeight: 700,
    letterSpacing: '-0.025em',
    lineHeight: 1.1,
    color: '#F0EDE6',
    fontFamily: 'Menlo,Monaco,monospace',
  } as React.CSSProperties,
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#26ab83',
    flexShrink: 0,
  } as React.CSSProperties,
  ticker: {
    fontSize: 15,
    fontWeight: 700,
    color: '#F0EDE6',
    fontFamily: 'Menlo,Monaco,monospace',
    lineHeight: 1.2,
  } as React.CSSProperties,
  name: {
    fontSize: 10,
    color: '#46443D',
    fontFamily: 'Menlo,Monaco,monospace',
    letterSpacing: '0.04em',
    marginTop: 2,
  } as React.CSSProperties,
  price: {
    fontSize: 15,
    color: '#F0EDE6',
    fontFamily: 'Menlo,Monaco,monospace',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.2,
  } as React.CSSProperties,
}
