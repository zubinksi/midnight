'use client'

import { useState, useCallback, use, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'
import { useAssetPrice, usePriceHistory, fetchNYSEClosePrice, fetchNYSEPrevClosePrice, getNYSESessionLabel, Timeframe } from '@/lib/hyperliquid'
import { formatPrice, formatChange, formatVolume } from '@/lib/format'
import LivelineChart from '@/components/LivelineChart'
import CompareModal from '@/components/CompareModal'

const WINDOWS: { label: string; tf: Timeframe }[] = [
  { label: '1D',  tf: '1D' },
  { label: '7D',  tf: '7D' },
  { label: '1M',  tf: '1M' },
  { label: '3M',  tf: '3M' },
  { label: '6M',  tf: '6M' },
  { label: 'ALL', tf: 'ALL' },
]

const TIMEFRAME_TO_SECS: Partial<Record<Timeframe, number>> = {
  '1D':  86400,
  '7D':  604800,
  '1M':  2592000,
  '3M':  7776000,
  '6M':  15552000,
}


export default function ChartPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params)
  const upperTicker = ticker.toUpperCase()
  const router = useRouter()

  const [assetInfo, setAssetInfo]       = useState<AssetInfo | null>(null)
  const [allAssets, setAllAssets]       = useState<AssetInfo[]>([])
  const [timeframe, setTimeframe]       = useState<Timeframe>('1D')
  const [scrubPrice, setScrubPrice]     = useState<number | null>(null)
  const [showCompare, setShowCompare]   = useState(false)
  const [starred, setStarred]           = useState(false)
  const [closePrice, setClosePrice]       = useState<number | null>(null)
  const [prevClosePrice, setPrevClosePrice] = useState<number | null>(null)
  const [showSearch, setShowSearch]     = useState(false)
  const [searchQuery, setSearchQuery]   = useState('')
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('neue-favorites')
      if (stored !== null) {
        setStarred((JSON.parse(stored) as string[]).includes(upperTicker))
      } else {
        setStarred(['HYPE', 'SP500'].includes(upperTicker))
      }
    } catch {}
  }, [upperTicker])

  const toggleStar = () => {
    setStarred(prev => {
      const next = !prev
      try {
        const stored = localStorage.getItem('neue-favorites')
        const list: string[] = stored !== null ? JSON.parse(stored) : ['HYPE', 'SP500']
        const updated = next ? [...new Set([...list, upperTicker])] : list.filter(t => t !== upperTicker)
        localStorage.setItem('neue-favorites', JSON.stringify(updated))
      } catch {}
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/assets')
      .then(r => r.json() as Promise<AssetInfo[]>)
      .then(list => {
        if (cancelled) return
        const found = list.find(a => a.ticker === upperTicker)
        if (found) return setAssetInfo(found)
        return fetch('/api/crypto')
          .then(r => r.json() as Promise<AssetInfo[]>)
          .then(cryptoList => { if (!cancelled) setAssetInfo(cryptoList.find(a => a.ticker === upperTicker) ?? null) })
      })
      .catch(() => null)
    return () => { cancelled = true }
  }, [upperTicker])

  useEffect(() => {
    Promise.all([
      fetch('/api/assets').then(r => r.json() as Promise<AssetInfo[]>),
      fetch('/api/crypto').then(r => r.json() as Promise<AssetInfo[]>),
    ]).then(([xyz, crypto]) => setAllAssets([...xyz, ...crypto])).catch(() => {})
  }, [])


  const coin = assetInfo?.coin ?? upperTicker

  const livePrice = useAssetPrice(coin, 800)
  const { data, loading, openPrice } = usePriceHistory(coin, timeframe)

  const currentPrice  = livePrice ?? assetInfo?.price ?? 0
  const displayPrice  = scrubPrice ?? currentPrice
  const decimals      = priceDecimals(displayPrice)

  const isXyz        = assetInfo?.coin.startsWith('xyz:') ?? false
  const sessionLabel = getNYSESessionLabel()

  useEffect(() => {
    if (!isXyz || sessionLabel === null) { setClosePrice(null); setPrevClosePrice(null); return }
    let cancelled = false
    fetchNYSEClosePrice(coin)
      .then(p => { if (!cancelled) setClosePrice(p) })
      .catch(() => { if (!cancelled) setClosePrice(null) })
    fetchNYSEPrevClosePrice(coin)
      .then(p => { if (!cancelled) setPrevClosePrice(p) })
      .catch(() => { if (!cancelled) setPrevClosePrice(null) })
    return () => { cancelled = true }
  }, [coin, isXyz, sessionLabel])

  const windowOpen    = openPrice ?? assetInfo?.prevDayPx ?? displayPrice
  const windowDiff    = displayPrice - windowOpen
  const windowPct     = windowOpen !== 0 ? (windowDiff / windowOpen) * 100 : 0
  const windowUp      = windowDiff >= 0
  const changeColor   = windowUp ? '#26ab83' : '#E84332'
  const { diffStr, pctStr } = formatChange(windowDiff, windowPct, decimals)

  const afterHrsDiff  = closePrice !== null && currentPrice > 0 ? currentPrice - closePrice : null
  const afterHrsPct   = afterHrsDiff !== null && closePrice !== 0 ? (afterHrsDiff / closePrice!) * 100 : null
  const afterHrsUp    = (afterHrsDiff ?? 0) >= 0
  const afterHrsColor = afterHrsUp ? '#26ab83' : '#E84332'
  const afterHrsStr   = afterHrsDiff !== null && afterHrsPct !== null
    ? formatChange(afterHrsDiff, afterHrsPct, decimals)
    : null

  const atCloseDiff  = closePrice !== null && prevClosePrice !== null && prevClosePrice > 0 ? closePrice - prevClosePrice : null
  const atClosePct   = atCloseDiff !== null && prevClosePrice ? (atCloseDiff / prevClosePrice) * 100 : null
  const atCloseUp    = (atCloseDiff ?? 0) >= 0
  const atCloseColor = atCloseUp ? '#26ab83' : '#E84332'
  const atCloseStr   = atCloseDiff !== null && atClosePct !== null
    ? formatChange(atCloseDiff, atClosePct, decimals)
    : null

  const isPreIpo     = assetInfo?.category === 'pre-ipo'
  const showAtClose  = timeframe === '1D' && sessionLabel !== null && atCloseStr !== null && scrubPrice === null && !isPreIpo

  const handleScrub   = useCallback((p: number | null) => setScrubPrice(p), [])
  const assetName     = getAssetName(upperTicker)

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return allAssets
      .filter(a => a.ticker.toLowerCase().includes(q) || getAssetName(a.ticker).toLowerCase().includes(q))
      .slice(0, 6)
  }, [allAssets, searchQuery])

  const chartWindow = timeframe === 'ALL' && data.length > 1
    ? Math.ceil((data.at(-1)!.time - data[0].time) * 1.02)
    : TIMEFRAME_TO_SECS[timeframe]

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'calc(env(safe-area-inset-top) + 60px) 24px 0' }}>
          <button onClick={() => window.history.length > 1 ? router.back() : router.push('/')} style={S.backBtn}>←</button>
          <button
            onClick={() => setShowSearch(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', lineHeight: 1, color: '#46443D' }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="7.5" cy="7.5" r="5" />
              <line x1="11.5" y1="11.5" x2="16" y2="16" />
            </svg>
          </button>
        </div>

        {/* Search overlay */}
        {showSearch && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#080807', display: 'flex', flexDirection: 'column' }}>
            <div style={{ maxWidth: 430, margin: '0 auto', width: '100%', padding: 'max(env(safe-area-inset-top), 56px) 24px 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    ref={searchInputRef}
                    autoFocus
                    type="text"
                    placeholder="SEARCH MARKETS"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      borderBottom: '1px solid #1C1C1A', padding: '10px 0',
                      color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace',
                      fontSize: 12, letterSpacing: '0.08em', outline: 'none', boxSizing: 'border-box',
                    } as React.CSSProperties}
                  />
                </div>
                <button
                  onClick={() => { setShowSearch(false); setSearchQuery('') }}
                  style={{ background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, cursor: 'pointer', padding: '4px 0', flexShrink: 0 }}
                >CANCEL</button>
              </div>
              <div>
                {searchResults.map(a => (
                  <div
                    key={a.coin}
                    onClick={() => { setShowSearch(false); setSearchQuery(''); router.push(`/chart/${a.ticker}`) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', borderBottom: '1px solid #1C1C1A', cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.2 }}>{a.ticker}</div>
                      <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', marginTop: 2 }}>{getAssetName(a.ticker)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Price block */}
        <div style={{ padding: '32px 24px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>{upperTicker}</span>
            <span style={{ fontSize: 15, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>{assetName}</span>
            <button
              onClick={toggleStar}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 32, color: starred ? '#F0C84A' : '#2C2C2A', padding: 0, lineHeight: 1, marginLeft: 'auto', flexShrink: 0 }}
            >★</button>
          </div>
          <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
            {displayPrice > 0 ? formatPrice(displayPrice, decimals) : '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
            {showAtClose ? (
              <>
                <span style={{ color: atCloseColor }}>{atCloseStr!.diffStr}</span>
                <span style={{ color: atCloseColor }}>{atCloseStr!.pctStr}</span>
                <span style={{ fontSize: 10, color: '#46443D', letterSpacing: '0.08em' }}>AT CLOSE</span>
              </>
            ) : (
              <>
                <span style={{ color: changeColor }}>{diffStr}</span>
                <span style={{ color: changeColor }}>{pctStr}</span>
              </>
            )}
          </div>
          {timeframe === '1D' && sessionLabel !== null && afterHrsStr !== null && !isPreIpo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontSize: 12, color: afterHrsColor }}>{afterHrsStr.diffStr}</span>
              <span style={{ fontSize: 12, color: afterHrsColor }}>{afterHrsStr.pctStr}</span>
              <span style={{ fontSize: 10, color: '#46443D', letterSpacing: '0.08em' }}>SINCE CLOSE</span>
            </div>
          )}
        </div>

        {/* Time windows */}
        <div style={{ marginTop: 8, padding: '0 24px' }}>
          <div style={{
            display: 'inline-flex', gap: 2,
            background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 2,
            marginBottom: 4,
          }}>
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

        {/* Chart area */}
        <div ref={chartContainerRef}>
          <LivelineChart
            data={data}
            value={livePrice ?? assetInfo?.price ?? data.at(-1)?.value ?? 0}
            color={changeColor}
            loading={loading}
            window={chartWindow}
            onScrub={handleScrub}
            formatTime={timeframe !== '1D' ? (t: number) => {
              const d = new Date(t * 1000)
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              return `${months[d.getMonth()]} ${d.getDate()}`
            } : undefined}
            padding={{ left: 24 }}
            referenceLine={closePrice !== null && sessionLabel !== null ? { value: closePrice } : undefined}
          />
        </div>

        {/* Action buttons */}
        <div style={{ padding: '16px 24px 0' }}>
          <button onClick={() => setShowCompare(true)} style={S.compareBtn}>COMPARE ⇄</button>
        </div>

        {/* Stats */}
        <StatsGrid assetInfo={assetInfo} currentPrice={currentPrice} />

        <div style={{ padding: '0 24px 40px' }} />
        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>

      {showCompare && (
        <CompareModal
          baseTicker={upperTicker}
          allAssets={allAssets}
          onClose={() => setShowCompare(false)}
          onCompare={tickers => {
            setShowCompare(false)
            router.push(`/compare/${tickers.join('_')}`)
          }}
        />
      )}
    </div>
  )
}




function StatsGrid({ assetInfo, currentPrice }: {
  assetInfo: AssetInfo | null
  currentPrice: number
}) {
  const volume24h    = assetInfo?.volume24h    ?? 0
  const openInterest = assetInfo?.openInterest ?? 0
  const funding      = assetInfo?.funding      ?? 0
  const fundingColor = funding >= 0 ? '#26ab83' : '#E84332'

  const stats = [
    { label: '24H VOLUME', value: volume24h > 0 ? formatVolume(volume24h) : '—', color: '#F0EDE6' },
    { label: 'OPEN INT',   value: openInterest > 0 ? formatVolume(openInterest) : '—', color: '#F0EDE6' },
    { label: 'FUNDING',    value: funding !== 0 ? `${funding >= 0 ? '+' : ''}${(funding * 100).toFixed(4)}%` : '—', color: fundingColor },
  ]

  return (
    <div style={{ borderTop: '1px solid #1C1C1A', marginTop: 16, padding: '40px 24px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 24px' }}>
      {stats.map(({ label, value, color }) => (
        <div key={label}>
          <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 13, color, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

const S = {
  backBtn:    { background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 28, cursor: 'pointer', padding: '4px 0', lineHeight: 1 } as React.CSSProperties,
  compareBtn: { width: '100%', background: 'none', border: '1px solid #2C2C2A', borderRadius: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, letterSpacing: '0.08em', cursor: 'pointer', padding: '12px 0', lineHeight: '16px' } as React.CSSProperties,
}
