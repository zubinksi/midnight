'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAssets, useLivePrices } from '@/lib/hyperliquid'
import { formatPrice, formatDate } from '@/lib/format'
import { priceDecimals } from '@/lib/assets'
import Sparkline from '@/components/Sparkline'

export default function Home() {
  const router = useRouter()
  const { assets, loading, error } = useAssets()
  const [clock, setClock]         = useState(formatDate())
  const [search, setSearch]       = useState('')
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  // Hydrate favorites from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('midnight-favorites')
      if (stored) setFavorites(new Set(JSON.parse(stored) as string[]))
    } catch {}
  }, [])

  const toggleFavorite = (ticker: string) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      try { localStorage.setItem('midnight-favorites', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const { tickers, seedPrices } = useMemo(() => {
    const tickers: string[]                  = []
    const seedPrices: Record<string, number> = {}
    for (const a of assets) {
      tickers.push(a.ticker)
      seedPrices[a.ticker] = a.price
    }
    return { tickers, seedPrices }
  }, [assets])

  const prices = useLivePrices(tickers, seedPrices, 800)

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

  // Favorites first, then alphabetically; filter by search query
  const displayAssets = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? assets.filter(a => a.ticker.toLowerCase().includes(q))
      : assets
    return [...filtered].sort((a, b) => {
      const af = favorites.has(a.ticker) ? 0 : 1
      const bf = favorites.has(b.ticker) ? 0 : 1
      return af - bf
    })
  }, [assets, favorites, search])

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
            <div style={S.hero}>Watch Markets Move.</div>
            <div style={{ ...S.hero, color: '#46443D' }}>Nights. Weekends. 24/7.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
            <span style={S.label}>
              LIVE · HYPERLIQUID · {loading ? '…' : `${assets.length} MARKETS`}
            </span>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 4 }}>
            <input
              type="text"
              placeholder="SEARCH MARKETS"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid #1C1C1A',
                padding: '10px 0',
                color: '#F0EDE6',
                fontFamily: 'Menlo,Monaco,monospace',
                fontSize: 12,
                letterSpacing: '0.08em',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#46443D', cursor: 'pointer', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, padding: '4px 0' }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #1C1C1A' }} />

        {loading ? (
          <LoadingRows />
        ) : error ? (
          <ErrorState message={error} />
        ) : (
          <div style={{ padding: '0 24px' }}>
            {displayAssets.length === 0 && search ? (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <span style={{ ...S.label, color: '#2C2C2A' }}>NO RESULTS FOR "{search.toUpperCase()}"</span>
              </div>
            ) : (
              displayAssets.map(asset => {
                const price    = prices[asset.ticker] ?? asset.price
                const open     = asset.prevDayPx || price
                const diff     = price - open
                const pct      = open !== 0 ? (diff / open) * 100 : 0
                const up       = diff >= 0
                const color    = up ? '#26ab83' : '#E84332'
                const hist     = historyRef.current[asset.ticker] ?? [price]
                const decimals = priceDecimals(price)
                const priceStr = formatPrice(price, decimals)
                const pctStr   = `${up ? '+' : ''}${pct.toFixed(2)}%`
                const hasOpen  = asset.prevDayPx > 0
                const starred  = favorites.has(asset.ticker)

                return (
                  <div
                    key={asset.coin}
                    onClick={() => router.push(`/chart/${asset.ticker}`)}
                    style={{ display: 'flex', alignItems: 'center', padding: '18px 0', borderBottom: '1px solid #1C1C1A', cursor: 'pointer', gap: 10 }}
                  >
                    {/* Star */}
                    <button
                      onClick={e => { e.stopPropagation(); toggleFavorite(asset.ticker) }}
                      style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', fontSize: 14, color: starred ? '#F0C84A' : '#2C2C2A', flexShrink: 0, lineHeight: 1 }}
                    >
                      {starred ? '★' : '☆'}
                    </button>

                    <div style={{ width: 56, flexShrink: 0 }}>
                      <div style={S.ticker}>{asset.ticker}</div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                      <Sparkline values={hist} width={88} height={28} color={color} />
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={S.price}>{priceStr}</div>
                      {hasOpen && (
                        <div style={{ marginTop: 3 }}>
                          <span style={{
                            display: 'inline-block', padding: '2px 7px', borderRadius: 4,
                            fontSize: 11, fontFamily: 'Menlo,Monaco,monospace',
                            fontVariantNumeric: 'tabular-nums', color,
                            background: up ? '#26ab8322' : '#E8433218',
                          }}>
                            {pctStr}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
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
        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '18px 0', borderBottom: '1px solid #1C1C1A', gap: 10, opacity: 1 - i * 0.1 }}>
          <div style={{ width: 14, height: 14, background: '#1C1C1A', borderRadius: 2, flexShrink: 0 }} />
          <div style={{ width: 56, height: 14, background: '#1C1C1A', borderRadius: 3 }} />
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
  label:  { fontSize: 11, color: '#46443D', letterSpacing: '0.08em', fontFamily: 'Menlo,Monaco,monospace' } as React.CSSProperties,
  hero:   { fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' } as React.CSSProperties,
  ticker: { fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.2 } as React.CSSProperties,
  price:  { fontSize: 15, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 } as React.CSSProperties,
}
