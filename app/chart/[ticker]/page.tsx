'use client'

import { useState, useCallback, use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'
import { useAssetPrice, usePriceHistory, Timeframe } from '@/lib/hyperliquid'
import type { LivelinePoint } from '@/lib/hyperliquid'
import { formatPrice, formatChange, formatVolume } from '@/lib/format'
import LivelineChart from '@/components/LivelineChart'
import ShareSheet from '@/components/ShareSheet'

const TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '7D', '1M']

export default function ChartPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params)
  const upperTicker = ticker.toUpperCase()
  const router = useRouter()

  const [assetInfo, setAssetInfo]    = useState<AssetInfo | null>(null)
  const [timeframe, setTimeframe]    = useState<Timeframe>('1D')
  const [scrubPrice, setScrubPrice]  = useState<number | null>(null)
  const [showShare, setShowShare]    = useState(false)

  // Load asset metadata to get the full coin ID (e.g. "xyz:NVDA")
  useEffect(() => {
    fetch('/api/assets')
      .then(r => r.json() as Promise<AssetInfo[]>)
      .then(list => setAssetInfo(list.find(a => a.ticker === upperTicker) ?? null))
      .catch(() => null)
  }, [upperTicker])

  // Use coin ID for all Hyperliquid API calls; fall back to bare ticker while loading
  const coin = assetInfo?.coin ?? `xyz:${upperTicker}`

  const livePrice = useAssetPrice(coin, 800)
  const { data, loading, openPrice } = usePriceHistory(coin, timeframe)

  const displayPrice = scrubPrice ?? livePrice ?? assetInfo?.price ?? 0
  const decimals     = priceDecimals(displayPrice)
  const open         = openPrice ?? assetInfo?.prevDayPx ?? displayPrice
  const diff         = displayPrice - open
  const pct          = open !== 0 ? (diff / open) * 100 : 0
  const up           = diff >= 0
  const changeColor  = up ? '#26ab83' : '#E84332'
  const { diffStr, pctStr } = formatChange(diff, pct, decimals)
  const sparkValues  = data.length > 0 ? data.map(p => p.value) : [displayPrice]
  const handleScrub  = useCallback((p: number | null) => setScrubPrice(p), [])

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
            {upperTicker} · HYPERLIQUID
          </div>
          <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
            {displayPrice > 0 ? formatPrice(displayPrice, decimals) : '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: changeColor }}>{diffStr}</span>
            <span style={{ color: changeColor }}>{pctStr}</span>
            <span style={{ color: '#46443D' }}>{timeframe}</span>
          </div>
        </div>

        {/* Chart */}
        <div style={{ marginTop: 28 }}>
          <LivelineChart
            data={data}
            value={livePrice ?? assetInfo?.price ?? 0}
            color={changeColor}
            loading={loading}
            onScrub={handleScrub}
          />
        </div>

        {/* Timeframe tabs */}
        <div style={{ display: 'flex', padding: '4px 24px', borderBottom: '1px solid #1C1C1A' }}>
          {TIMEFRAMES.map(tf => {
            const active = timeframe === tf
            return (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{
                padding: '12px 16px', fontSize: 11, fontFamily: 'Menlo,Monaco,monospace',
                letterSpacing: '0.07em', color: active ? '#F0EDE6' : '#46443D',
                background: 'none', border: 'none',
                borderBottom: active ? `1.5px solid ${changeColor}` : '1.5px solid transparent',
                cursor: 'pointer', transition: 'color 0.15s, border-color 0.15s', flexShrink: 0,
              }}>
                {tf}
              </button>
            )
          })}
        </div>

        {/* Stats */}
        <StatsGrid assetInfo={assetInfo} diff={diff} pct={pct} up={up} changeColor={changeColor} data={data} />

        {/* Attribution */}
        <div style={{ padding: '0 24px 40px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
            LIVE · POWERED BY HYPERLIQUID
          </span>
        </div>

        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>

      {showShare && (
        <ShareSheet
          ticker={upperTicker}
          price={livePrice ?? assetInfo?.price ?? 0}
          diff={diff}
          pct={pct}
          decimals={decimals}
          sparkValues={sparkValues}
          changeColor={changeColor}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}

function StatsGrid({ assetInfo, diff, pct, up, changeColor, data }: {
  assetInfo: AssetInfo | null
  diff: number; pct: number; up: boolean; changeColor: string
  data: LivelinePoint[]
}) {
  const decimals = priceDecimals(Math.abs(diff) || 1)
  const { diffStr, pctStr } = formatChange(diff, pct, decimals)
  const volume24h    = assetInfo?.volume24h    ?? 0
  const openInterest = assetInfo?.openInterest ?? 0
  const funding      = assetInfo?.funding      ?? 0

  const stats = [
    { label: '24H CHANGE',  value: `${diffStr} (${pctStr})`,                                    color: changeColor },
    { label: '24H VOLUME',  value: volume24h    > 0 ? formatVolume(volume24h)    : '—',          color: '#F0EDE6' },
    { label: 'OPEN INT',    value: openInterest > 0 ? formatVolume(openInterest) : '—',          color: '#F0EDE6' },
    { label: 'FUNDING',     value: funding !== 0 ? `${up ? '+' : ''}${(funding * 100).toFixed(4)}%` : '—', color: changeColor },
  ]

  return (
    <div style={{ padding: '28px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
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
  shareBtn: { background: 'none', border: '1px solid #1C1C1A', borderRadius: 20, padding: '6px 14px', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 11, letterSpacing: '0.06em', cursor: 'pointer' } as React.CSSProperties,
}
