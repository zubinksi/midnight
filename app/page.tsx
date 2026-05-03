'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAssets, useCryptoAssets, useLivePrices, useCryptoLivePrices } from '@/lib/hyperliquid'
import { formatPrice, formatDate } from '@/lib/format'
import { priceDecimals } from '@/lib/assets'
import type { AssetCategory } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'
import { COMPARE_COLORS } from '@/components/CompareModal'
import { loadComparisons, saveComparisons } from '@/lib/comparisons'
import type { SavedComparison } from '@/lib/comparisons'

type FilterKey = 'all' | 'starred' | AssetCategory

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',       label: 'ALL' },
  { key: 'starred',   label: '★' },
  { key: 'crypto',    label: 'CRYPTO' },
  { key: 'stock',     label: 'STOCKS' },
  { key: 'index',     label: 'INDICES' },
  { key: 'commodity', label: 'COMMODITIES' },
  { key: 'fx',        label: 'FX' },
]

export default function Home() {
  const router = useRouter()
  const { assets: xyzAssets, loading: xyzLoading, error } = useAssets()
  const { assets: cryptoAssets, loading: cryptoLoading }   = useCryptoAssets()
  const [clock, setClock]                   = useState(formatDate())
  const [search, setSearch]                 = useState('')
  const [categoryFilter, setCategoryFilter] = useState<FilterKey>('all')
  const [favorites, setFavorites]           = useState<Set<string>>(new Set(['HYPE', 'SP500']))
  const [savedComparisons, setSavedComparisons] = useState<SavedComparison[]>([])

  const loading = xyzLoading || cryptoLoading

  useEffect(() => {
    const read = () => {
      try {
        const stored = localStorage.getItem('neue-favorites')
        if (stored !== null) setFavorites(new Set(JSON.parse(stored) as string[]))
      } catch {}
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  useEffect(() => {
    const read = () => setSavedComparisons(loadComparisons())
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  const removeComparison = (id: string) => {
    setSavedComparisons(prev => {
      const next = prev.filter(c => c.id !== id)
      saveComparisons(next)
      return next
    })
  }

  const toggleFavorite = (ticker: string) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      try { localStorage.setItem('neue-favorites', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const allAssets = useMemo(() => [...xyzAssets, ...cryptoAssets], [xyzAssets, cryptoAssets])

  const { xyzTickers, xyzSeedPrices, cryptoTickers, cryptoSeedPrices } = useMemo(() => {
    const xyzTickers: string[]                     = []
    const xyzSeedPrices: Record<string, number>    = {}
    const cryptoTickers: string[]                  = []
    const cryptoSeedPrices: Record<string, number> = {}
    for (const a of xyzAssets)    { xyzTickers.push(a.ticker);    xyzSeedPrices[a.ticker]    = a.price }
    for (const a of cryptoAssets) { cryptoTickers.push(a.ticker); cryptoSeedPrices[a.ticker] = a.price }
    return { xyzTickers, xyzSeedPrices, cryptoTickers, cryptoSeedPrices }
  }, [xyzAssets, cryptoAssets])

  const xyzPrices    = useLivePrices(xyzTickers, xyzSeedPrices, 800)
  const cryptoPrices = useCryptoLivePrices(cryptoTickers, cryptoSeedPrices, 800)
  const prices       = useMemo(() => ({ ...xyzPrices, ...cryptoPrices }), [xyzPrices, cryptoPrices])

  useEffect(() => {
    const t = setInterval(() => setClock(formatDate()), 1000)
    return () => clearInterval(t)
  }, [])

  const displayAssets = useMemo(() => {
    let filtered = categoryFilter === 'all'
      ? allAssets
      : categoryFilter === 'starred'
      ? allAssets.filter(a => favorites.has(a.ticker))
      : allAssets.filter(a => a.category === categoryFilter)
    const q = search.trim().toLowerCase()
    if (q) filtered = filtered.filter(a =>
      a.ticker.toLowerCase().includes(q) ||
      getAssetName(a.ticker).toLowerCase().includes(q)
    )
    return [...filtered].sort((a, b) => {
      const af = favorites.has(a.ticker) ? 0 : 1
      const bf = favorites.has(b.ticker) ? 0 : 1
      return af - bf
    })
  }, [allAssets, categoryFilter, favorites, search])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#080807', overflow: 'hidden' }}>
      <div style={{ maxWidth: 430, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Fixed header */}
        <div style={{ flexShrink: 0, padding: '0 24px', paddingTop: 'max(env(safe-area-inset-top), 56px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
              <span style={S.label}>LIVE · {loading ? '…' : `${allAssets.length} MARKETS`}</span>
            </div>
            <span style={S.label}>{clock}</span>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={S.hero}>24/7 markets</div>
            <div style={S.hero}>on Hyperliquid.</div>
          </div>
          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 4 }}>
            <input
              type="text"
              placeholder="SEARCH"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', background: 'transparent', border: 'none',
                borderBottom: '1px solid #1C1C1A', padding: '10px 0',
                color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace',
                fontSize: 12, letterSpacing: '0.08em', outline: 'none', boxSizing: 'border-box',
              } as React.CSSProperties}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#46443D', cursor: 'pointer', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, padding: '4px 0' }}
              >✕</button>
            )}
          </div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 6, paddingTop: 14, paddingBottom: 20, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
            {FILTERS.map(f => {
              const active = categoryFilter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setCategoryFilter(f.key)}
                  style={{
                    background: active ? '#1C1C1A' : 'none', border: '1px solid #1C1C1A',
                    borderRadius: 20, padding: f.key === 'starred' ? '0 10px 4px' : '5px 12px',
                    height: 28, fontSize: f.key === 'starred' ? 18 : 10,
                    fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em',
                    color: f.key === 'starred' ? (active ? '#F0C84A' : '#46443D') : (active ? '#F0EDE6' : '#46443D'),
                    cursor: 'pointer', transition: 'color 0.15s, background 0.15s',
                    flexShrink: 0, whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}
                >{f.label}</button>
              )
            })}
          </div>
        </div>

        <div style={{ flexShrink: 0, borderTop: '1px solid #1C1C1A' }} />

        {/* Scrollable list */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <div style={{ padding: '0 24px' }}>
            {/* Saved comparisons — top of list */}
            {savedComparisons.length > 0 && (
              <div style={{ paddingTop: 16, paddingBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 10 }}>COMPARISONS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                  {savedComparisons.map(c => (
                    <div
                      key={c.id}
                      onClick={() => router.push(`/compare/${c.id}`)}
                      style={{ display: 'flex', alignItems: 'center', background: '#0F0F0E', border: '1px solid #1C1C1A', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', gap: 16 }}
                    >
                      <div style={{ flex: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {c.tickers.map((ticker, i) => (
                          <div key={ticker} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: COMPARE_COLORS[i], flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1 }}>{ticker}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); removeComparison(c.id) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#46443D', fontSize: 10, padding: 2, lineHeight: 1, flexShrink: 0 }}
                      >✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid #1C1C1A' }} />
              </div>
            )}

            {/* Asset rows */}
            {loading ? (
              <LoadingRows />
            ) : error ? (
              <ErrorState message={error} />
            ) : displayAssets.length === 0 && search ? (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <span style={{ ...S.label, color: '#2C2C2A' }}>NO RESULTS FOR "{search.toUpperCase()}"</span>
              </div>
            ) : (
              displayAssets.map(asset => (
                <AssetRow
                  key={asset.coin}
                  asset={asset}
                  price={prices[asset.ticker] ?? asset.price}
                  starred={favorites.has(asset.ticker)}
                  onToggleFavorite={toggleFavorite}
                  onNavigate={() => router.push(`/chart/${asset.ticker}`)}
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

function AssetRow({ asset, price, starred, onToggleFavorite, onNavigate }: {
  asset: { coin: string; ticker: string; prevDayPx: number }
  price: number
  starred: boolean
  onToggleFavorite: (ticker: string) => void
  onNavigate: () => void
}) {
  const open     = asset.prevDayPx || price
  const diff     = price - open
  const pct      = open !== 0 ? (diff / open) * 100 : 0
  const up       = diff >= 0
  const color    = up ? '#26ab83' : '#E84332'
  const decimals = priceDecimals(price)
  const priceStr = formatPrice(price, decimals)
  const pctStr   = `${up ? '+' : ''}${pct.toFixed(2)}%`
  const hasOpen  = asset.prevDayPx > 0
  const name     = getAssetName(asset.ticker)

  return (
    <div
      onClick={onNavigate}
      style={{
        display: 'flex', alignItems: 'center',
        padding: '14px 0',
        borderBottom: '1px solid #1C1C1A',
        cursor: 'pointer', gap: 10,
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); onToggleFavorite(asset.ticker) }}
        style={{
          background: 'none', border: 'none', borderRadius: '50%',
          width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, cursor: 'pointer', fontSize: 16,
          color: starred ? '#F0C84A' : '#2C2C2A', flexShrink: 0, lineHeight: 1,
        }}
      >★</button>
      <div style={{ width: 90, flexShrink: 0 }}>
        <div style={S.ticker}>{asset.ticker}</div>
        <div style={S.name}>{name}</div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={S.price}>{priceStr}</div>
        {hasOpen && (
          <div style={{ marginTop: 3 }}>
            <span style={{
              display: 'inline-block', padding: '2px 7px', borderRadius: 4,
              fontSize: 11, fontFamily: 'Menlo,Monaco,monospace',
              fontVariantNumeric: 'tabular-nums', color,
              background: up ? '#26ab8322' : '#E8433218',
            }}>{pctStr}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function LoadingRows() {
  return (
    <div style={{ padding: '0 24px' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1C1C1A', gap: 10, opacity: 1 - i * 0.1 }}>
          <div style={{ width: 14, height: 14, background: '#1C1C1A', borderRadius: 2, flexShrink: 0 }} />
          <div style={{ width: 90, flexShrink: 0 }}>
            <div style={{ width: 60, height: 15, background: '#1C1C1A', borderRadius: 3, marginBottom: 5 }} />
            <div style={{ width: 80, height: 11, background: '#1C1C1A', borderRadius: 3 }} />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ width: 64, height: 15, background: '#1C1C1A', borderRadius: 3 }} />
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
  ticker: { fontSize: 17, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.2 } as React.CSSProperties,
  name:   { fontSize: 12, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  price:  { fontSize: 17, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 } as React.CSSProperties,
}
