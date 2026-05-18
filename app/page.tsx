'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, closestCenter,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAssets, useCryptoAssets, useLivePrices, useCryptoLivePrices, getNYSESessionLabel, fetchNYSEClosePrice, fetchNYSEPrevClosePrice } from '@/lib/hyperliquid'
import { formatPrice } from '@/lib/format'
import { priceDecimals } from '@/lib/assets'
import type { AssetCategory } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'

type FilterKey = 'all' | 'starred' | 'equities' | AssetCategory

const CLOCK_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function LiveDate({ style }: { style?: React.CSSProperties }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  return <div style={style}>{CLOCK_MONTHS[now.getMonth()]} {now.getDate()}</div>
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',       label: 'ALL' },
  { key: 'starred',   label: '★' },
  { key: 'crypto',    label: 'CRYPTO' },
  { key: 'equities',  label: 'EQUITIES' },
  { key: 'commodity', label: 'COMMODITIES' },
  { key: 'fx',        label: 'FX' },
  { key: 'pre-ipo',   label: 'PRE IPO' },
]

export default function Home() {
  const router = useRouter()
  const { assets: xyzAssets, loading: xyzLoading, error } = useAssets()
  const { assets: cryptoAssets, loading: cryptoLoading }   = useCryptoAssets()
  const [search, setSearch]                 = useState('')
  const [categoryFilter, setCategoryFilter] = useState<FilterKey>(() => {
    try {
      const v = localStorage.getItem('neue-filter')
      if (v && FILTERS.some(f => f.key === v)) return v as FilterKey
    } catch {}
    return 'all'
  })
  const [sortBy, setSortBy]                 = useState<'volume' | 'price-desc' | 'price-asc'>(() => {
    try {
      const v = localStorage.getItem('neue-sort')
      if (v === 'price-desc' || v === 'price-asc') return v
    } catch {}
    return 'volume'
  })
  const [showSearch, setShowSearch]         = useState(false)
  const [showSortSheet, setShowSortSheet]   = useState(false)
  const [showSummary, setShowSummary]       = useState(false)
  const [summaryText, setSummaryText]       = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryTime, setSummaryTime]       = useState<Date | null>(null)
  const sortSheetRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    let startY = 0, dy = 0
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY; dy = 0
      node.style.animation = 'none'
      node.style.transition = 'none'
    }
    const onMove = (e: TouchEvent) => {
      dy = Math.max(0, e.touches[0].clientY - startY)
      node.style.transform = `translateY(${dy}px)`
      e.preventDefault()
    }
    const onEnd = () => {
      if (dy > 120) {
        node.style.transition = 'transform 0.25s ease'
        node.style.transform  = 'translateY(100%)'
        setTimeout(() => setShowSortSheet(false), 220)
      } else {
        node.style.transition = 'transform 0.25s ease'
        node.style.transform  = 'translateY(0)'
        dy = 0
      }
    }
    node.addEventListener('touchstart', onStart, { passive: true })
    node.addEventListener('touchmove',  onMove,  { passive: false })
    node.addEventListener('touchend',   onEnd,   { passive: true })
  }, [])
  const summarySheetRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    let startY = 0, dy = 0
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY; dy = 0
      node.style.animation = 'none'
      node.style.transition = 'none'
    }
    const onMove = (e: TouchEvent) => {
      dy = Math.max(0, e.touches[0].clientY - startY)
      node.style.transform = `translateY(${dy}px)`
      e.preventDefault()
    }
    const onEnd = () => {
      if (dy > 120) {
        node.style.transition = 'transform 0.25s ease'
        node.style.transform  = 'translateY(100%)'
        setTimeout(() => setShowSummary(false), 220)
      } else {
        node.style.transition = 'transform 0.25s ease'
        node.style.transform  = 'translateY(0)'
        dy = 0
      }
    }
    node.addEventListener('touchstart', onStart, { passive: true })
    node.addEventListener('touchmove',  onMove,  { passive: false })
    node.addEventListener('touchend',   onEnd,   { passive: true })
  }, [])

  const [favorites, setFavorites]           = useState<Set<string>>(new Set(['HYPE', 'SP500']))
  const [starredOrder, setStarredOrder]     = useState<string[]>(() => {
    try {
      const v = localStorage.getItem('neue-starred-order')
      if (v) return JSON.parse(v) as string[]
    } catch {}
    return []
  })
  const [closePrices, setClosePrices]         = useState<Record<string, number>>({})
  const [prevClosePrices, setPrevClosePrices] = useState<Record<string, number>>({})
  const loading = xyzLoading || cryptoLoading

  const sessionLabel   = getNYSESessionLabel()
  const isMarketClosed = sessionLabel !== null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  useEffect(() => {
    if (!isMarketClosed || xyzAssets.length === 0) { setClosePrices({}); return }
    let cancelled = false
    Promise.all(
      xyzAssets.map(a =>
        fetchNYSEClosePrice(a.coin)
          .then(p => ({ ticker: a.ticker, p }))
          .catch(() => ({ ticker: a.ticker, p: null }))
      )
    ).then(results => {
      if (cancelled) return
      const map: Record<string, number> = {}
      for (const { ticker, p } of results) if (p !== null) map[ticker] = p
      setClosePrices(map)
    })
    return () => { cancelled = true }
  }, [xyzAssets.length, isMarketClosed])

  useEffect(() => {
    if (!isMarketClosed || xyzAssets.length === 0) { setPrevClosePrices({}); return }
    const starredXyz = xyzAssets.filter(a => favorites.has(a.ticker))
    if (starredXyz.length === 0) return
    let cancelled = false
    Promise.all(
      starredXyz.map(a =>
        fetchNYSEPrevClosePrice(a.coin)
          .then(p => ({ ticker: a.ticker, p }))
          .catch(() => ({ ticker: a.ticker, p: null }))
      )
    ).then(results => {
      if (cancelled) return
      const map: Record<string, number> = {}
      for (const { ticker, p } of results) if (p !== null) map[ticker] = p
      setPrevClosePrices(map)
    })
    return () => { cancelled = true }
  }, [xyzAssets, isMarketClosed, favorites])

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

  const displayAssets = useMemo(() => {
    let filtered = categoryFilter === 'all'
      ? allAssets
      : categoryFilter === 'starred'
      ? allAssets.filter(a => favorites.has(a.ticker))
      : categoryFilter === 'equities'
      ? allAssets.filter(a => a.category === 'stock' || a.category === 'index')
      : allAssets.filter(a => a.category === categoryFilter)
    const q = search.trim().toLowerCase()
    if (q) filtered = filtered.filter(a =>
      a.ticker.toLowerCase().includes(q) ||
      getAssetName(a.ticker).toLowerCase().includes(q)
    )
    // Custom order for starred filter when not searching
    if (categoryFilter === 'starred' && !q && starredOrder.length > 0) {
      const orderMap = new Map(starredOrder.map((t, i) => [t, i]))
      return [...filtered].sort((a, b) => {
        const ai = orderMap.has(a.ticker) ? orderMap.get(a.ticker)! : Infinity
        const bi = orderMap.has(b.ticker) ? orderMap.get(b.ticker)! : Infinity
        return ai - bi
      })
    }
    return [...filtered].sort((a, b) => {
      const af = favorites.has(a.ticker)
      const bf = favorites.has(b.ticker)
      if (af !== bf) return af ? -1 : 1
      if (af && bf && starredOrder.length > 0) {
        const ai = starredOrder.indexOf(a.ticker)
        const bi = starredOrder.indexOf(b.ticker)
        const aIdx = ai === -1 ? Infinity : ai
        const bIdx = bi === -1 ? Infinity : bi
        if (aIdx !== bIdx) return aIdx - bIdx
      }
      if (sortBy === 'price-desc' || sortBy === 'price-asc') {
        const pct = (asset: typeof a) => {
          const cp = closePrices[asset.ticker]
          if (isMarketClosed && cp !== undefined && cp !== 0)
            return (asset.price - cp) / cp
          return asset.prevDayPx > 0 ? (asset.price - asset.prevDayPx) / asset.prevDayPx : 0
        }
        return sortBy === 'price-desc' ? pct(b) - pct(a) : pct(a) - pct(b)
      }
      return (b.volume24h ?? 0) - (a.volume24h ?? 0)
    })
  }, [allAssets, categoryFilter, favorites, search, sortBy, closePrices, isMarketClosed, starredOrder])

  const isDragMode = !search.trim()

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const starredInView = displayAssets.filter(a => favorites.has(a.ticker)).map(a => a.ticker)
    const oldIndex = starredInView.indexOf(active.id as string)
    const newIndex = starredInView.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(starredInView, oldIndex, newIndex)

    if (categoryFilter === 'starred') {
      setStarredOrder(reordered)
      try { localStorage.setItem('neue-starred-order', JSON.stringify(reordered)) } catch {}
    } else {
      // Splice reordered in-view tickers back into the full starredOrder
      const inViewSet = new Set(starredInView)
      let i = 0
      const base = starredOrder.filter(t => favorites.has(t))
      const newOrder = base.map(t => inViewSet.has(t) ? reordered[i++] : t)
      // Add any starred tickers missing from starredOrder
      const inOrderSet = new Set(newOrder)
      for (const t of reordered) { if (!inOrderSet.has(t)) newOrder.push(t) }
      setStarredOrder(newOrder)
      try { localStorage.setItem('neue-starred-order', JSON.stringify(newOrder)) } catch {}
    }
  }

  const SUMMARY_TTL_MS = 10 * 60 * 1000

  const openSummary = () => {
    if (summaryText && summaryTime && !summaryLoading &&
        summaryText !== 'Unable to generate summary. Please try again.' &&
        Date.now() - summaryTime.getTime() < SUMMARY_TTL_MS) {
      setShowSummary(true)
      return
    }
    fetchSummary()
  }

  const fetchSummary = async () => {
    if (summaryLoading) return
    setSummaryLoading(true)
    setSummaryText('')
    setShowSummary(true)

    const starred = allAssets.filter(a => favorites.has(a.ticker))
    if (starred.length === 0) { setSummaryLoading(false); return }

    const toSnapshot = (a: typeof starred[0]) => {
      const cp  = closePrices[a.ticker]
      const pcp = prevClosePrices[a.ticker]
      const pct = isMarketClosed && cp && cp !== 0
        ? (a.price - cp) / cp * 100
        : a.prevDayPx > 0 ? (a.price - a.prevDayPx) / a.prevDayPx * 100 : 0
      const pctClose = isMarketClosed && cp && cp !== 0 && pcp && pcp !== 0
        ? (cp - pcp) / pcp * 100
        : undefined
      return { ticker: a.ticker, coin: a.coin, category: a.category, pct, pctClose, price: a.price, funding: a.funding, volume24h: a.volume24h, openInterest: a.openInterest }
    }

    const assets  = starred.map(toSnapshot)
    const anchors = ['SP500', 'BTC'].flatMap(t => {
      const a = allAssets.find(x => x.ticker === t)
      return a ? [toSnapshot(a)] : []
    }).filter(a => !favorites.has(a.ticker))

    try {
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets, anchors, sessionLabel }),
      })
      if (!res.ok || !res.body) throw new Error()
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let text = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += dec.decode(value, { stream: true })
        setSummaryText(text)
      }
      setSummaryTime(new Date())
    } catch {
      setSummaryText('Unable to generate summary. Please try again.')
    } finally {
      setSummaryLoading(false)
    }
  }

  const assetList = loading ? (
    <LoadingRows />
  ) : error ? (
    <ErrorState message={error} />
  ) : displayAssets.length === 0 && search ? (
    <div style={{ padding: '48px 0', textAlign: 'center' }}>
      <span style={{ ...S.label, color: '#2C2C2A' }}>NO RESULTS FOR "{search.toUpperCase()}"</span>
    </div>
  ) : isDragMode ? (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={displayAssets.filter(a => favorites.has(a.ticker)).map(a => a.ticker)}
        strategy={verticalListSortingStrategy}
      >
        {displayAssets.map(asset => favorites.has(asset.ticker) ? (
          <SortableAssetRow
            key={asset.ticker}
            asset={asset}
            price={prices[asset.ticker] ?? asset.price}
            starred
            onToggleFavorite={toggleFavorite}
            onNavigate={() => router.push(`/chart/${asset.ticker}`)}
            closePrice={closePrices[asset.ticker]}
            sessionLabel={sessionLabel}
          />
        ) : (
          <AssetRow
            key={asset.coin}
            asset={asset}
            price={prices[asset.ticker] ?? asset.price}
            starred={false}
            onToggleFavorite={toggleFavorite}
            onNavigate={() => router.push(`/chart/${asset.ticker}`)}
            closePrice={closePrices[asset.ticker]}
            sessionLabel={sessionLabel}
          />
        ))}
      </SortableContext>
    </DndContext>
  ) : (
    displayAssets.map(asset => (
      <AssetRow
        key={asset.coin}
        asset={asset}
        price={prices[asset.ticker] ?? asset.price}
        starred={favorites.has(asset.ticker)}
        onToggleFavorite={toggleFavorite}
        onNavigate={() => router.push(`/chart/${asset.ticker}`)}
        closePrice={closePrices[asset.ticker]}
        sessionLabel={sessionLabel}
      />
    ))
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#080807', overflow: 'hidden' }}>
      <div style={{ maxWidth: 430, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Search overlay */}
        {showSearch && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#080807', display: 'flex', flexDirection: 'column' }}>
            <div style={{ maxWidth: 430, margin: '0 auto', width: '100%', padding: 'max(env(safe-area-inset-top), 56px) 24px 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="SEARCH MARKETS"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      borderBottom: '1px solid #1C1C1A', padding: '10px 0',
                      color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace',
                      fontSize: 12, letterSpacing: '0.08em', outline: 'none', boxSizing: 'border-box',
                    } as React.CSSProperties}
                  />
                </div>
                <button
                  onClick={() => { setShowSearch(false); setSearch('') }}
                  style={{ background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, cursor: 'pointer', padding: '4px 0', flexShrink: 0 }}
                >CANCEL</button>
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {displayAssets.map(asset => (
                  <div
                    key={asset.coin}
                    onClick={() => { setShowSearch(false); setSearch(''); router.push(`/chart/${asset.ticker}`) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', borderBottom: '1px solid #1C1C1A', cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.2 }}>{asset.ticker}</div>
                      <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', marginTop: 2 }}>{getAssetName(asset.ticker)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Fixed header */}
        <div style={{ flexShrink: 0, padding: '0 24px', paddingTop: 'calc(env(safe-area-inset-top) + 20px)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={S.hero}>Hyperliquid</div>
              <LiveDate style={{ ...S.hero, color: '#46443D' }} />
            </div>
            <button
              onClick={() => setShowSearch(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', lineHeight: 1, color: '#46443D', flexShrink: 0, marginTop: 6 }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="7.5" cy="7.5" r="5" />
                <line x1="11.5" y1="11.5" x2="16" y2="16" />
              </svg>
            </button>
          </div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 6, paddingTop: 14, paddingBottom: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
            {FILTERS.map(f => {
              const active = categoryFilter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => { setCategoryFilter(f.key); try { localStorage.setItem('neue-filter', f.key) } catch {} }}
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

        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '6px 24px' }}>
          <button
            onClick={() => setShowSortSheet(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0 4px 8px', color: sortBy !== 'volume' ? '#F0EDE6' : '#46443D', lineHeight: 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="2" y1="3.5" x2="12" y2="3.5" />
              <line x1="2" y1="7"   x2="9"  y2="7"   />
              <line x1="2" y1="10.5" x2="6" y2="10.5" />
              <polyline points="11,5 13,7 11,9" />
            </svg>
          </button>
        </div>

        <div style={{ flexShrink: 0, borderTop: '1px solid #1C1C1A' }} />

        {/* Sort bottom sheet */}
        {showSortSheet && (
          <div
            onClick={() => setShowSortSheet(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000000BB', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' } as React.CSSProperties}
          >
            <div
              onClick={e => e.stopPropagation()}
              ref={sortSheetRef}
              className="slide-up"
              style={{ width: '100%', maxWidth: 430, background: '#0F0F0E', borderTop: '1px solid #1C1C1A', borderRadius: '20px 20px 0 0', padding: '28px 24px', paddingBottom: 'max(32px, env(safe-area-inset-bottom))', touchAction: 'none' }}
            >
              <div style={{ width: 36, height: 4, background: '#46443D', borderRadius: 2, margin: '0 auto 24px' }} />
              <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 16 }}>SORT BY</div>
              {([
                { key: 'volume',     label: 'Volume' },
                { key: 'price-desc', label: 'Change ↓' },
                { key: 'price-asc',  label: 'Change ↑' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setSortBy(opt.key); try { localStorage.setItem('neue-sort', opt.key) } catch {}; setShowSortSheet(false) }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #1C1C1A', padding: '16px 0', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 14, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{opt.label}</span>
                  {sortBy === opt.key && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83' }} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scrollable area */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <div style={{ padding: '0 24px' }}>
            {assetList}
          </div>
          <div style={{ height: 'calc(max(env(safe-area-inset-bottom), 16px) + 72px)' }} />
        </div>

        {/* Persistent summary panel */}
        <SummaryPanel
          open={showSummary}
          onOpen={() => { setShowSummary(true); openSummary() }}
          onClose={() => setShowSummary(false)}
          loading={summaryLoading}
          text={summaryText}
          time={summaryTime}
          onRefresh={fetchSummary}
          allTickers={allAssets.map(a => a.ticker)}
          onNavigate={t => { setShowSummary(false); router.push(`/chart/${t}`) }}
        />

      </div>
    </div>
  )
}

// ── Summary peek panel ────────────────────────────────────────────────────────

interface SummaryPanelProps {
  open: boolean
  onOpen: () => void
  onClose: () => void
  loading: boolean
  text: string
  time: Date | null
  onRefresh: () => void
  allTickers: string[]
  onNavigate: (t: string) => void
}

function SummaryPanel({ open, onOpen, onClose, loading, text, time, onRefresh, allTickers, onNavigate }: SummaryPanelProps) {
  const dragStartY = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => { dragStartY.current = e.touches[0].clientY }
  const handleTouchEnd   = (e: React.TouchEvent) => {
    const dy = dragStartY.current - e.changedTouches[0].clientY
    if (!open && dy > 30) onOpen()
    if (open  && dy < -40) onClose()
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 98, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as React.CSSProperties}
        />
      )}

      {/* Panel */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99,
          display: 'flex', justifyContent: 'center',
          transform: open ? 'translateY(0)' : 'translateY(calc(100% - 72px))',
          transition: 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{
          width: '100%', maxWidth: 430,
          background: '#0F0F0E',
          borderTop: '1px solid #1C1C1A',
          borderRadius: '20px 20px 0 0',
          paddingBottom: 'max(36px, env(safe-area-inset-bottom))',
        }}>
          {/* Handle + collapsed header — tap to open */}
          <div
            onClick={() => open ? onClose() : onOpen()}
            style={{ padding: '12px 24px 16px', cursor: 'pointer' }}
          >
            <div style={{ width: 36, height: 4, background: '#2C2C2A', borderRadius: 2, margin: '0 auto 14px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 13 13" fill="#26ab83">
                  <path d="M6.5 0 L7.5 4.5 L12 5.5 L7.5 6.5 L6.5 11 L5.5 6.5 L1 5.5 L5.5 4.5 Z" />
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.04em' }}>Watchlist Summary</span>
              </div>
              <span style={{ fontSize: 18, color: '#46443D', lineHeight: 1, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease', display: 'inline-block' }}>⌃</span>
            </div>
            {!open && (
              <div style={{ marginTop: 4, fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>
                {loading ? 'Generating…' : text ? 'Tap to read' : 'Tap to generate'}
              </div>
            )}
          </div>

          {/* Expanded content */}
          <div style={{ padding: '0 24px', overflow: 'hidden', maxHeight: open ? '60vh' : 0, transition: 'max-height 0.38s cubic-bezier(0.4, 0, 0.2, 1)', overflowY: open ? 'auto' : 'hidden' } as React.CSSProperties}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              {time && !loading && (
                <button
                  onClick={e => { e.stopPropagation(); onRefresh() }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 10, letterSpacing: '0.08em', padding: 0 }}
                >↻ REFRESH</button>
              )}
            </div>
            <div style={{ fontSize: 14, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.65, minHeight: 60, paddingBottom: 8 }}>
              {loading && !text
                ? <span style={{ color: '#46443D' }}>Analysing your watchlist…</span>
                : renderSummaryText(text, allTickers, onNavigate)}
              {loading && text && <span style={{ color: '#46443D' }}>▌</span>}
            </div>
            {time && !loading && (
              <div style={{ marginTop: 8, marginBottom: 8, fontSize: 10, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em' }}>
                {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Sortable wrapper (starred filter only) ────────────────────────────────────

function renderSummaryText(
  text: string,
  tickers: string[],
  onNavigate: (ticker: string) => void,
): React.ReactNode {
  if (!text || tickers.length === 0) return text
  const clean = text.replace(/\*\*/g, '')
  const escaped = [...tickers].sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'g')
  const parts: React.ReactNode[] = []
  let last = 0, match: RegExpExecArray | null
  while ((match = regex.exec(clean)) !== null) {
    if (match.index > last) parts.push(clean.slice(last, match.index))
    const t = match[1]
    parts.push(
      <button key={`${t}-${match.index}`} onClick={() => onNavigate(t)} style={{
        background: '#26ab8318', border: '1px solid #26ab8340',
        borderRadius: 4, padding: '1px 6px', cursor: 'pointer',
        color: '#26ab83', fontFamily: 'inherit', fontSize: 'inherit',
        letterSpacing: 'inherit', lineHeight: 'inherit', fontWeight: 600,
        verticalAlign: 'baseline',
      }}>{t}</button>
    )
    last = regex.lastIndex
  }
  if (last < clean.length) parts.push(clean.slice(last))
  return parts
}

interface AssetRowProps {
  asset: { coin: string; ticker: string; prevDayPx: number; category: string }
  price: number
  starred: boolean
  onToggleFavorite: (ticker: string) => void
  onNavigate: () => void
  closePrice?: number
  sessionLabel: 'AFTER HRS' | 'PRE-MKT' | null
  dragHandleListeners?: SyntheticListenerMap
  dragHandleAttributes?: DraggableAttributes
}

function SortableAssetRow(props: Omit<AssetRowProps, 'dragHandleListeners' | 'dragHandleAttributes'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.asset.ticker })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 1 : 0,
        position: 'relative',
      }}
    >
      <AssetRow {...props} dragHandleListeners={listeners} dragHandleAttributes={attributes} />
    </div>
  )
}

// ── Asset row ─────────────────────────────────────────────────────────────────

function AssetRow({ asset, price, starred, onToggleFavorite, onNavigate, closePrice, sessionLabel, dragHandleListeners, dragHandleAttributes }: AssetRowProps) {
  const decimals = priceDecimals(price)
  const priceStr = formatPrice(price, decimals)
  const name     = getAssetName(asset.ticker)

  const showAH  = sessionLabel !== null && closePrice !== undefined && asset.category !== 'pre-ipo'
  const ahDiff  = showAH ? price - closePrice! : 0
  const ahPct   = showAH && closePrice! !== 0 ? (ahDiff / closePrice!) * 100 : 0
  const ahUp    = ahDiff >= 0
  const icon    = sessionLabel === 'PRE-MKT' ? '☀️' : '🌙'

  const open    = asset.prevDayPx || price
  const dayDiff = price - open
  const dayPct  = open !== 0 ? (dayDiff / open) * 100 : 0
  const dayUp   = dayDiff >= 0

  const badgeUp    = showAH ? ahUp    : dayUp
  const badgeColor = badgeUp ? '#26ab83' : '#E84332'
  const badgeStr   = showAH
    ? `${icon} ${ahUp ? '+' : ''}${ahPct.toFixed(2)}%`
    : `${dayUp ? '+' : ''}${dayPct.toFixed(2)}%`
  const showBadge  = showAH || asset.prevDayPx > 0

  const isDraggable = !!dragHandleListeners

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
        {showBadge && (
          <div style={{ marginTop: 3 }}>
            <span style={{
              display: 'inline-block', padding: '2px 7px', borderRadius: 4,
              fontSize: 11, fontFamily: 'Menlo,Monaco,monospace',
              fontVariantNumeric: 'tabular-nums', color: badgeColor,
              background: badgeUp ? '#26ab8322' : '#E8433218',
            }}>{badgeStr}</span>
          </div>
        )}
      </div>
      {starred ? (
        <button
          {...dragHandleListeners}
          {...dragHandleAttributes}
          onClick={e => e.stopPropagation()}
          style={{
            background: 'none', border: 'none', padding: '4px 0 4px 8px',
            color: '#2C2C2A', cursor: isDraggable ? 'grab' : 'default',
            flexShrink: 0, display: 'flex', alignItems: 'center',
            touchAction: isDraggable ? 'none' : 'auto',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="4" x2="11" y2="4" />
            <line x1="3" y1="7" x2="11" y2="7" />
            <line x1="3" y1="10" x2="11" y2="10" />
          </svg>
        </button>
      ) : (
        <div style={{ width: 22, flexShrink: 0 }} />
      )}
    </div>
  )
}

// ── Skeletons / errors ────────────────────────────────────────────────────────

function LoadingRows() {
  return (
    <>
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
    </>
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
  hero:   { fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.15, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' } as React.CSSProperties,
  ticker: { fontSize: 17, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.2 } as React.CSSProperties,
  name:   { fontSize: 12, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  price:  { fontSize: 17, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 } as React.CSSProperties,
}
