'use client'

import { useState, useCallback, use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'
import { useAssetPrice, usePriceHistory, Timeframe } from '@/lib/hyperliquid'
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

  const [assetInfo, setAssetInfo]     = useState<AssetInfo | null>(null)
  const [allAssets, setAllAssets]     = useState<AssetInfo[]>([])
  const [timeframe, setTimeframe]     = useState<Timeframe>('1D')
  const [scrubPrice, setScrubPrice]   = useState<number | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [starred, setStarred]         = useState(false)

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
        // Fall back to crypto assets
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

  const windowOpen    = openPrice ?? assetInfo?.prevDayPx ?? displayPrice
  const windowDiff    = displayPrice - windowOpen
  const windowPct     = windowOpen !== 0 ? (windowDiff / windowOpen) * 100 : 0
  const windowUp      = windowDiff >= 0
  const changeColor   = windowUp ? '#26ab83' : '#E84332'
  const { diffStr, pctStr } = formatChange(windowDiff, windowPct, decimals)

  const sparkValues   = data.length > 0 ? data.map(p => p.value) : [currentPrice]
  const handleScrub   = useCallback((p: number | null) => setScrubPrice(p), [])
  const assetName     = getAssetName(upperTicker)

  const chartWindow = timeframe === 'ALL' && data.length > 1
    ? Math.ceil((data.at(-1)!.time - data[0].time) * 1.02)
    : TIMEFRAME_TO_SECS[timeframe]


  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'max(env(safe-area-inset-top), 56px) 24px 0' }}>
          <button onClick={() => window.history.length > 1 ? router.back() : router.push('/')} style={S.backBtn}>←</button>
          <button onClick={() => setShowCompare(true)} style={S.iconBtn}>⇄</button>
        </div>

        {/* Price block */}
        <div style={{ padding: '32px 24px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
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
            <span style={{ color: changeColor }}>{diffStr}</span>
            <span style={{ color: changeColor }}>{pctStr}</span>
          </div>
        </div>

        {/* Chart */}
        <div style={{ marginTop: 20, padding: '0 24px' }}>
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
        <div>
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
          />
        </div>

        {/* Stats */}
        <StatsGrid assetInfo={assetInfo} currentPrice={currentPrice} />

        {/* Attribution */}
        <div style={{ padding: '0 24px 40px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
            LIVE · POWERED BY HYPERLIQUID{assetInfo?.coin.startsWith('xyz:') ? ' AND TRADE.XYZ' : ''}
          </span>
        </div>

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
  const prevDayPx   = assetInfo?.prevDayPx ?? 0
  const diff24h     = prevDayPx > 0 ? currentPrice - prevDayPx : 0
  const pct24h      = prevDayPx > 0 ? (diff24h / prevDayPx) * 100 : 0
  const up24h       = diff24h >= 0
  const color24h    = up24h ? '#26ab83' : '#E84332'
  const decimals    = priceDecimals(currentPrice || 1)
  const { diffStr, pctStr } = formatChange(diff24h, pct24h, decimals)

  const volume24h    = assetInfo?.volume24h    ?? 0
  const openInterest = assetInfo?.openInterest ?? 0
  const funding      = assetInfo?.funding      ?? 0
  const fundingColor = funding >= 0 ? '#26ab83' : '#E84332'

  const stats = [
    { label: '24H CHANGE', value: prevDayPx > 0 ? `${diffStr} (${pctStr})` : '—', color: color24h },
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
  backBtn: { background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 44, cursor: 'pointer', padding: '4px 0', lineHeight: 1 } as React.CSSProperties,
  iconBtn: { background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 20, cursor: 'pointer', padding: '4px 0', lineHeight: 1 } as React.CSSProperties,
}
