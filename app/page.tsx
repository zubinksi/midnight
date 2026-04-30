'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAssets, useLivePrices } from '@/lib/hyperliquid'
import { formatPrice, formatChange, formatDate } from '@/lib/format'
import { priceDecimals } from '@/lib/assets'
import Sparkline from '@/components/Sparkline'

export default function Home() {
  const router         = useRouter()
  const { assets, loading, error } = useAssets()
  const [clock, setClock]          = useState(formatDate())

  // Seed prices from the initial asset list fetch (mark prices from HL)
  const seedPrices = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of assets) m[a.ticker] = a.price
    return m
  }, [assets])

  const tickers    = useMemo(() => assets.map(a => a.ticker), [assets])
  const prices     = useLivePrices(tickers, seedPrices, 800)

  // Rolling sparkline history per ticker
  const historyRef = useRef<Record<string, number[]>>({})
  for (const a of assets) {
    const p = prices[a.ticker]
    if (p == null) continue
    if (!historyRef.current[a.ticker]) historyRef.current[a.ticker] = []
    const arr = historyRef.current[a.ticker]
    if (arr.length === 0 || arr[arr.length - 1] !== p) {
      arr.push(p)
      if (arr.length > 60) arr.shift()
    }
  }

  useEffect(() => {
    const t = setInterval(() => setClock(formatDate()), 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ padding: '0 24px', paddingTop: 'max(env(safe-area-inset-top), 56px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
            <span style={S.label}>MIDNIGHT</span>
            <span style={S.label}>{clock}</span>
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={S.hero}>After Hours.</div>
            <div style={{ ...S.hero, color: '#46443D' }}>24/7.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
            <span style={S.label}>LIVE · HYPERLIQUID · {loading ? '…' : `${assets.length} MARKETS`}</span>
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid #1C1C1A' }} />

        {/* Content */}
        {loading ? (
          <LoadingRows />
        ) : error ? (
          <ErrorState message={error} />
        ) : (
          <div style={{ padding: '0 24px' }}>
            {assets.map(asset => {
              const price    = prices[asset.ticker] ?? asset.price
              const open     = asset.prevDayPx || price
              const diff     = price - open
              const pct      = open !== 0 ? (diff / open) * 100 : 0
              const up       = diff >= 0
              const color    = up ? '#26ab83' : '#E84332'
              const hist     = historyRef.current[asset.ticker] ?? [price]
              const decimals = priceDecimals(price)
              const priceStr = formatPrice(price, decimals)
              const { pctStr } = formatChange(diff, pct, decimals)
              const hasOpen  = asset.prevDayPx > 0

              return (
                <div
                  key={asset.ticker}
                  onClick={() => router.push(`/chart/${asset.ticker}`)}
                  style={{ display: 'flex', alignItems: 'center', padding: '18px 0', borderBottom: '1px solid #1C1C1A', cursor: 'pointer', gap: 12 }}
                >
                  {/* Ticker + name */}
                  <div style={{ width: 60, flexShrink: 0 }}>
                    <div style={S.ticker}>{asset.ticker}</div>
                  </div>

                  {/* Sparkline */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                    <Sparkline values={hist} width={88} height={28} color={color} />
                  </div>

                  {/* Price + change */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={S.price}>{priceStr}</div>
                    {hasOpen && (
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
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>
    </div>
  )
}

function LoadingRows() {
  return (
    <div style={{ padding: '0 24px' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '18px 0', borderBottom: '1px solid #1C1C1A', gap: 12, opacity: 1 - i * 0.1 }}>
          <div style={{ width: 60, height: 14, background: '#1C1C1A', borderRadius: 3 }} />
          <div style={{ flex: 1, height: 28, background: '#1C1C1A', borderRadius: 3 }} />
          <div style={{ width: 60, height: 14, background: '#1C1C1A', borderRadius: 3 }} />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#E84332', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
        {message.toUpperCase()}
      </div>
    </div>
  )
}

const S = {
  label: {
    fontSize: 11, color: '#46443D', letterSpacing: '0.08em', fontFamily: 'Menlo,Monaco,monospace',
  } as React.CSSProperties,
  hero: {
    fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1,
    color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace',
  } as React.CSSProperties,
  ticker: {
    fontSize: 15, fontWeight: 700, color: '#F0EDE6',
    fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.2,
  } as React.CSSProperties,
  price: {
    fontSize: 15, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace',
    fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
  } as React.CSSProperties,
}
