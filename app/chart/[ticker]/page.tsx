'use client'

import { useState, useCallback, use, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'
import { useAssetPrice, usePriceHistory, fetchNYSEClosePrice, fetchNYSEPrevClosePrice, getNYSESessionLabel, Timeframe } from '@/lib/hyperliquid'
import { formatPrice, formatChange, formatVolume } from '@/lib/format'
import dynamic from 'next/dynamic'
import type { LivelineSeries } from 'liveline'
import LivelineChart from '@/components/LivelineChart'
const LivelineMulti = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

import CompareModal from '@/components/CompareModal'
import ShareModal from '@/components/ShareModal'
import type { ETFFlowsData } from '@/app/api/etf-flows/route'

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
  const [showShare, setShowShare]       = useState(false)
  const [starred, setStarred]           = useState(false)
  const [closePrice, setClosePrice]       = useState<number | null>(null)
  const [prevClosePrice, setPrevClosePrice] = useState<number | null>(null)
  const [showSearch, setShowSearch]     = useState(false)
  const [searchQuery, setSearchQuery]   = useState('')
  const [etfFlows, setEtfFlows]         = useState<ETFFlowsData | null>(null)
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


  useEffect(() => {
    if (upperTicker !== 'HYPE') return
    fetch('/api/etf-flows')
      .then(r => r.json() as Promise<ETFFlowsData>)
      .then(setEtfFlows)
      .catch(() => {})
  }, [upperTicker])

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
          <button onClick={() => window.history.length > 1 ? router.back() : router.push('/')} style={S.backBtn}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="12,4 6,10 12,16" />
            </svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={toggleStar}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: starred ? '#F0C84A' : '#2C2C2A', padding: '4px 0', lineHeight: 1, transition: 'color 0.15s' }}
            >★</button>
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
          </div>
          <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
            {displayPrice > 0 ? formatPrice(displayPrice, decimals) : '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
            {showAtClose ? (
              <>
                <span style={{ color: atCloseColor }}>{atCloseStr!.pctStr}</span>
                <span style={{ fontSize: 10, color: '#46443D', letterSpacing: '0.08em' }}>AT CLOSE</span>
              </>
            ) : (
              <>
                <span style={{ color: changeColor }}>{pctStr}</span>
              </>
            )}
          </div>
          {timeframe === '1D' && sessionLabel !== null && afterHrsStr !== null && !isPreIpo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontSize: 12, color: afterHrsColor }}>{afterHrsStr.pctStr}</span>
              <span style={{ fontSize: 11 }}>{sessionLabel === 'PRE-MKT' ? '☀️' : '🌙'}</span>
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
        <div style={{ padding: '24px 24px 0' }}>
          <button onClick={() => setShowCompare(true)} style={S.actionBtn}>COMPARE</button>
        </div>

        {/* Stats */}
        <StatsGrid assetInfo={assetInfo} currentPrice={currentPrice} />

        {/* ETF flows — HYPE only */}
        {upperTicker === 'HYPE' && (
          <ETFFlowsSection flows={etfFlows} currentPrice={currentPrice} />
        )}

        <div style={{ padding: '0 24px 40px' }} />
        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>

      {showShare && (
        <ShareModal
          ticker={upperTicker}
          assetInfo={assetInfo}
          currentPrice={currentPrice}
          changeColor={changeColor}
          pctStr={pctStr}
          coin={coin}
          onClose={() => setShowShare(false)}
        />
      )}

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
    { label: 'FUNDING APR', value: funding !== 0 ? `${funding >= 0 ? '+' : ''}${(funding * 3 * 365 * 100).toFixed(2)}%` : '—', color: fundingColor },
  ]

  return (
    <div style={{ borderTop: '1px solid #1C1C1A', marginTop: 16, padding: '24px 24px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 24px' }}>
      {stats.map(({ label, value, color }) => (
        <div key={label}>
          <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 13, color, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

const ETF_COLORS = { total: '#F0EDE6', thyp: '#26ab83', bhyp: '#F0C84A' }

function ETFFlowsSection({ flows, currentPrice }: { flows: ETFFlowsData | null; currentPrice: number }) {
  const MONO = 'Menlo,Monaco,monospace'
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function fmtUSD(usd: number) {
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
    if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(0)}K`
    return `$${usd.toFixed(0)}`
  }
  function fmtHype(hype: number) { return (hype * currentPrice) }

  const bhyp = flows?.bhyp
  const thyp = flows?.thyp
  const bhypCurrent  = bhyp?.current  ?? 0
  const bhypDeltaH   = (bhyp?.prevClose ?? 0) > 0 ? bhypCurrent - (bhyp?.prevClose ?? 0) : null
  const thypCurrent  = thyp?.current  ?? 0
  const thypDeltaH   = (thyp?.prevClose ?? 0) > 0 ? thypCurrent - (thyp?.prevClose ?? 0) : null
  const totalHype    = bhypCurrent + thypCurrent
  const totalDeltaH  = bhypDeltaH !== null || thypDeltaH !== null
    ? (bhypDeltaH ?? 0) + (thypDeltaH ?? 0) : null

  // Build chart series from history
  const thypHistory  = thyp?.history ?? []
  const bhypHistory  = bhyp?.history ?? []

  // Merge into a combined timeline keyed by time
  const timeSet = new Set([...thypHistory.map(p => p.time), ...bhypHistory.map(p => p.time)])
  const times   = [...timeSet].sort((a, b) => a - b)

  const thypByTime = Object.fromEntries(thypHistory.map(p => [p.time, p.usd]))
  const bhypByTime = Object.fromEntries(bhypHistory.map(p => [p.time, p.usd]))

  const thypPoints = times.map(t => ({ time: t, value: thypByTime[t] ?? 0 }))
  const bhypPoints = times.map(t => ({ time: t, value: bhypByTime[t] ?? 0 }))
  const totalPoints = times.map(t => ({ time: t, value: (thypByTime[t] ?? 0) + (bhypByTime[t] ?? 0) }))

  const hasChart = totalPoints.length >= 2

  const allSeries: LivelineSeries[] = [
    { id: 'total', data: totalPoints, value: totalPoints.at(-1)?.value ?? 0, color: ETF_COLORS.total, label: 'TOTAL' },
    { id: 'thyp',  data: thypPoints,  value: thypPoints.at(-1)?.value  ?? 0, color: ETF_COLORS.thyp,  label: 'THYP'  },
    ...(bhypHistory.length > 0
      ? [{ id: 'bhyp', data: bhypPoints, value: bhypPoints.at(-1)?.value ?? 0, color: ETF_COLORS.bhyp, label: 'BHYP' }]
      : []),
  ]

  const chartWindow = hasChart
    ? Math.ceil((totalPoints.at(-1)!.time - totalPoints[0].time) * 1.05) + 86400
    : undefined

  // grid: name | HYPE | USD | Δ HYPE | Δ USD
  const grid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 76px 44px 68px 44px',
    columnGap: 0,
    alignItems: 'baseline',
  }
  const rAlign: React.CSSProperties = { textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }

  function DeltaCells({ deltaHype }: { deltaHype: number | null }) {
    const deltaUsd = deltaHype !== null ? deltaHype * currentPrice : null
    if (deltaHype === null) return (
      <>
        <div style={{ ...rAlign, fontSize: 11, color: '#2C2C2A' }}>—</div>
        <div />
      </>
    )
    const up = deltaHype >= 0
    const color  = up ? '#26ab83' : '#E84332'
    const dimmed = up ? '#1a7a5e' : '#a02a1e'
    return (
      <>
        <div style={{ ...rAlign, fontSize: 11, color }}>
          {up ? '+' : ''}{Math.round(Math.abs(deltaHype)).toLocaleString('en-US')}
        </div>
        <div style={{ ...rAlign, fontSize: 10, color: dimmed }}>
          {currentPrice > 0 && deltaUsd !== null ? `${up ? '+' : ''}${fmtUSD(Math.abs(deltaUsd))}` : ''}
        </div>
      </>
    )
  }

  return (
    <div style={{ borderTop: '1px solid #1C1C1A', marginTop: 0, padding: '24px 24px 0' }}>

      {/* Section label */}
      <div style={{ fontSize: 10, color: '#46443D', fontFamily: MONO, letterSpacing: '0.1em', marginBottom: 16 }}>
        ETF FLOWS
      </div>

      {/* Multi-line AUM chart */}
      {hasChart && mounted && (
        <div style={{ marginBottom: 20, marginLeft: -24, marginRight: -24 }}>
          <LivelineMulti
            data={totalPoints}
            value={totalPoints.at(-1)?.value ?? 0}
            color={ETF_COLORS.total}
            series={allSeries}
            theme="dark"
            scrub
            grid
            lineWidth={1.5}
            window={chartWindow}
            formatValue={v => fmtUSD(v)}
            formatTime={(t: number) => {
              const d = new Date(t * 1000)
              return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate()
            }}
            padding={{ left: 24 }}
            className="ll-compare"
            style={{ width: '100%', height: 200 }}
          />
        </div>
      )}

      {/* Table header */}
      <div style={{ ...grid, marginBottom: 10 }}>
        <div />
        <div style={{ ...rAlign, fontSize: 9, color: '#2C2C2A', letterSpacing: '0.06em' }}>HYPE</div>
        <div style={{ ...rAlign, fontSize: 9, color: '#2C2C2A', letterSpacing: '0.06em' }}>USD</div>
        <div style={{ ...rAlign, fontSize: 9, color: '#2C2C2A', letterSpacing: '0.06em' }}>DAY Δ</div>
        <div />
      </div>

      {/* BHYP row */}
      <div style={{ ...grid, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: ETF_COLORS.bhyp, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#F0EDE6', fontFamily: MONO }}>BHYP</span>
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: MONO }}>BITWISE</span>
        </div>
        <div style={{ ...rAlign, fontSize: 13, color: bhypCurrent > 0 ? '#F0EDE6' : '#2C2C2A' }}>
          {bhypCurrent > 0 ? Math.round(bhypCurrent).toLocaleString('en-US') : '—'}
        </div>
        <div style={{ ...rAlign, fontSize: 11, color: '#46443D' }}>
          {bhypCurrent > 0 && currentPrice > 0 ? fmtUSD(fmtHype(bhypCurrent)) : ''}
        </div>
        <DeltaCells deltaHype={bhypDeltaH} />
      </div>

      {/* THYP row */}
      <div style={{ ...grid, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: ETF_COLORS.thyp, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#F0EDE6', fontFamily: MONO }}>THYP</span>
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: MONO }}>21SHARES</span>
        </div>
        <div style={{ ...rAlign, fontSize: 13, color: thypCurrent > 0 ? '#F0EDE6' : '#2C2C2A' }}>
          {thypCurrent > 0 ? Math.round(thypCurrent).toLocaleString('en-US') : '—'}
        </div>
        <div style={{ ...rAlign, fontSize: 11, color: '#46443D' }}>
          {thypCurrent > 0 && currentPrice > 0 ? fmtUSD(fmtHype(thypCurrent)) : ''}
        </div>
        <DeltaCells deltaHype={thypDeltaH} />
      </div>

      {/* Total row */}
      {totalHype > 0 && (
        <div style={{ ...grid, borderTop: '1px solid #1C1C1A', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: ETF_COLORS.total, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#46443D', fontFamily: MONO, letterSpacing: '0.1em' }}>TOTAL</span>
          </div>
          <div style={{ ...rAlign, fontSize: 13, color: '#F0EDE6' }}>{Math.round(totalHype).toLocaleString('en-US')}</div>
          <div style={{ ...rAlign, fontSize: 11, color: '#46443D' }}>
            {currentPrice > 0 ? fmtUSD(fmtHype(totalHype)) : ''}
          </div>
          <DeltaCells deltaHype={totalDeltaH} />
        </div>
      )}
    </div>
  )
}

const S = {
  backBtn:    { background: 'none', border: 'none', color: '#46443D', cursor: 'pointer', padding: '4px 0', lineHeight: 1, display: 'flex', alignItems: 'center' } as React.CSSProperties,
  actionBtn:  { width: '100%', background: 'none', border: '1px solid #3C3C3A', borderRadius: 10, color: '#8A8880', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, letterSpacing: '0.08em', cursor: 'pointer', padding: '12px 0', lineHeight: '16px' } as React.CSSProperties,
}
