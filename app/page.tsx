'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ASSETS, AssetCategory } from '@/lib/assets'
import { useAllPrices } from '@/lib/hyperliquid'
import { formatPrice, formatDate } from '@/lib/format'
import Sparkline from '@/components/Sparkline'

type Filter = 'all' | AssetCategory

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'stock', label: 'STOCKS' },
  { key: 'index', label: 'INDICES' },
  { key: 'commodity', label: 'CMDTY' },
]

// Rolling price history per asset for sparklines
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

export default function Home() {
  const router = useRouter()
  const prices = useAllPrices(800)
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
        <div style={{ padding: 'env(safe-area-inset-top, 56px) 24px 0', paddingTop: 'max(env(safe-area-inset-top), 56px)' }}>
          {/* Top row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
            <span style={{ fontSize: 11, color: '#46443D', letterSpacing: '0.08em', fontFamily: 'Menlo,Monaco,monospace' }}>
              MIDNIGHT
            </span>
            <span style={{ fontSize: 11, color: '#46443D', letterSpacing: '0.08em', fontFamily: 'Menlo,Monaco,monospace' }}>
              {clock}
            </span>
          </div>

          {/* Hero */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>
              After Hours.
            </div>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>
              24/7.
            </div>
          </div>

          {/* Live badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            <div
              className="pulse-dot"
              style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }}
            />
            <span style={{ fontSize: 10, color: '#46443D', letterSpacing: '0.08em', fontFamily: 'Menlo,Monaco,monospace' }}>
              LIVE · HYPERLIQUID · 247 MARKETS
            </span>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{
          borderTop: '1px solid #1C1C1A',
          display: 'flex',
          overflowX: 'auto',
          padding: '0 24px',
        }}>
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

        {/* Watchlist */}
        <div style={{ padding: '0 24px' }}>
          {visible.map(asset => {
            const price = prices[asset.ticker] ?? asset.seedPrice
            const hist = history[asset.ticker] ?? [price]
            const open = hist[0]
            const diff = price - open
            const pct = open !== 0 ? (diff / open) * 100 : 0
            const up = diff >= 0
            const changeColor = up ? '#26ab83' : '#E84332'
            const priceStr = formatPrice(asset.ticker, price)
            const pctStr = `${up ? '+' : ''}${pct.toFixed(2)}%`

            return (
              <div
                key={asset.ticker}
                onClick={() => router.push(`/chart/${asset.ticker}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '18px 0',
                  borderBottom: '1px solid #1C1C1A',
                  cursor: 'pointer',
                  gap: 12,
                }}
              >
                {/* Left — ticker + name */}
                <div style={{ width: 52, flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.2 }}>
                    {asset.ticker}
                  </div>
                  <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.04em', marginTop: 2 }}>
                    {asset.name.slice(0, 8)}
                  </div>
                </div>

                {/* Center — sparkline */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <Sparkline values={hist} width={88} height={28} color={changeColor} />
                </div>

                {/* Right — price + change */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                    {priceStr}
                  </div>
                  <div style={{ marginTop: 3 }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 7px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'Menlo,Monaco,monospace',
                      fontVariantNumeric: 'tabular-nums',
                      color: changeColor,
                      background: up ? '#26ab8322' : '#E8433218',
                    }}>
                      {pctStr}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom safe area */}
        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>
    </div>
  )
}
