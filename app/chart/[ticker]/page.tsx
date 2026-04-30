'use client'

import { useState, useCallback, use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'
import { useAssetPrice, usePriceHistory, Timeframe } from '@/lib/hyperliquid'
import { formatPrice, formatChange, formatVolume } from '@/lib/format'
import LivelineChart from '@/components/LivelineChart'
import ShareSheet from '@/components/ShareSheet'

const WINDOWS = [
  { label: '1D',  secs: 86400 },
  { label: '7D',  secs: 604800 },
  { label: '1M',  secs: 2592000 },
  { label: '3M',  secs: 7776000 },
  { label: '6M',  secs: 15552000 },
]

const SECS_TO_TIMEFRAME: Record<number, Timeframe> = {
  86400:    '1D',
  604800:   '7D',
  2592000:  '1M',
  7776000:  '3M',
  15552000: '6M',
}

const TIMEFRAME_TO_SECS: Record<Timeframe, number> = {
  '1D': 86400,
  '7D': 604800,
  '1M': 2592000,
  '3M': 7776000,
  '6M': 15552000,
}

export default function ChartPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params)
  const upperTicker = ticker.toUpperCase()
  const router = useRouter()

  const [assetInfo, setAssetInfo]   = useState<AssetInfo | null>(null)
  const [timeframe, setTimeframe]   = useState<Timeframe>('1D')
  const [scrubPrice, setScrubPrice] = useState<number | null>(null)
  const [showShare, setShowShare]   = useState(false)

  useEffect(() => {
    fetch('/api/assets')
      .then(r => r.json() as Promise<AssetInfo[]>)
      .then(list => setAssetInfo(list.find(a => a.ticker === upperTicker) ?? null))
      .catch(() => null)
  }, [upperTicker])

  const coin = assetInfo?.coin ?? `xyz:${upperTicker}`

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

  const handleWindowChange = useCallback((secs: number) => {
    const tf = SECS_TO_TIMEFRAME[secs]
    if (tf) setTimeframe(tf)
  }, [])

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'max(env(safe-area-inset-top), 56px) 24px 0' }}>
          <button onClick={() => router.back()} style={S.backBtn}>← WATCHLIST</button>
          <button onClick={() => setShowShare(true)} style={S.shareBtn}>SHARE ↗</button>
        </div>

        {/* Price block */}
        <div style={{ padding: '32px 24px 0' }}>
          <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 8 }}>
            {upperTicker} · {assetName}
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
        <div style={{ marginTop: 28 }}>
          <LivelineChart
            data={data}
            value={livePrice ?? assetInfo?.price ?? data.at(-1)?.value ?? 0}
            color={changeColor}
            loading={loading}
            window={TIMEFRAME_TO_SECS[timeframe]}
            windows={WINDOWS}
            onWindowChange={handleWindowChange}
            onScrub={handleScrub}
          />
        </div>

        {/* Stats */}
        <StatsGrid assetInfo={assetInfo} currentPrice={currentPrice} />

        {/* Attribution */}
        <div style={{ padding: '0 24px 40px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
            LIVE · POWERED BY HYPERLIQUID AND TRADE.XYZ
          </span>
        </div>

        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>

      {showShare && (
        <ShareSheet
          ticker={upperTicker}
          assetName={assetName}
          price={currentPrice}
          diff={windowDiff}
          pct={windowPct}
          decimals={decimals}
          sparkValues={sparkValues}
          changeColor={changeColor}
          onClose={() => setShowShare(false)}
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
  backBtn:  { background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer', padding: 0 } as React.CSSProperties,
  shareBtn: { background: '#1C1C1A', border: '1px solid #2C2C2A', borderRadius: 20, padding: '7px 16px', color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontSize: 11, letterSpacing: '0.06em', cursor: 'pointer' } as React.CSSProperties,
}
