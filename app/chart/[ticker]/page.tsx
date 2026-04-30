'use client'

import { useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { getAsset } from '@/lib/assets'
import type { Asset } from '@/lib/assets'
import { useAssetPrice, usePriceHistory, Timeframe } from '@/lib/hyperliquid'
import type { LivelinePoint } from '@/lib/hyperliquid'
import { formatPrice, formatChange, formatVolume } from '@/lib/format'
import LivelineChart from '@/components/LivelineChart'
import ShareSheet from '@/components/ShareSheet'

const TIMEFRAMES: Timeframe[] = ['1H', '4H', '1D', '7D', '1M']

export default function ChartPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params)
  const upperTicker = ticker.toUpperCase()
  const asset = getAsset(upperTicker)
  const router = useRouter()

  const [timeframe, setTimeframe] = useState<Timeframe>('1D')
  const [scrubPrice, setScrubPrice] = useState<number | null>(null)
  const [showShare, setShowShare] = useState(false)

  const livePrice = useAssetPrice(upperTicker, 800)
  const { data, loading, openPrice } = usePriceHistory(upperTicker, timeframe)

  if (!asset) {
    return (
      <div style={{ background: '#080807', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 13 }}>ASSET NOT FOUND</span>
      </div>
    )
  }

  const displayPrice = scrubPrice ?? livePrice ?? asset.seedPrice
  const open = openPrice ?? asset.seedPrice
  const diff = displayPrice - open
  const pct = open !== 0 ? (diff / open) * 100 : 0
  const up = diff >= 0
  const changeColor = up ? '#26ab83' : '#E84332'
  const { diffStr, pctStr } = formatChange(diff, pct, asset.decimals)

  const sparkValues = data.length > 0 ? data.map(p => p.value) : [asset.seedPrice]

  const handleScrub = useCallback((p: number | null) => setScrubPrice(p), [])

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'max(env(safe-area-inset-top), 56px) 24px 0',
        }}>
          <button
            onClick={() => router.back()}
            style={{
              background: 'none',
              border: 'none',
              color: '#46443D',
              fontFamily: 'Menlo,Monaco,monospace',
              fontSize: 12,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ← WATCHLIST
          </button>
          <button
            onClick={() => setShowShare(true)}
            style={{
              background: 'none',
              border: '1px solid #1C1C1A',
              borderRadius: 20,
              padding: '6px 14px',
              color: '#46443D',
              fontFamily: 'Menlo,Monaco,monospace',
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: 'pointer',
            }}
          >
            SHARE ↗
          </button>
        </div>

        {/* Price block */}
        <div style={{ padding: '32px 24px 0' }}>
          <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 8 }}>
            {upperTicker} · {asset.name} · HYPERLIQUID
          </div>
          <div style={{
            fontSize: 52,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            color: '#F0EDE6',
            fontFamily: 'Menlo,Monaco,monospace',
            fontVariantNumeric: 'tabular-nums',
            marginBottom: 8,
          }}>
            {formatPrice(upperTicker, displayPrice)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: changeColor }}>{diffStr}</span>
            <span style={{ color: changeColor }}>{pctStr}</span>
            <span style={{ color: '#46443D' }}>{timeframe}</span>
          </div>
        </div>

        {/* Chart */}
        <div style={{ marginTop: 28 }}>
          {loading ? (
            <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 11, letterSpacing: '0.08em' }}>
                LOADING…
              </span>
            </div>
          ) : (
            <LivelineChart
              data={data}
              value={livePrice ?? asset.seedPrice}
              color={changeColor}
              theme="dark"
              onScrub={handleScrub}
            />
          )}
        </div>

        {/* Timeframe tabs */}
        <div style={{ display: 'flex', padding: '4px 24px', borderBottom: '1px solid #1C1C1A' }}>
          {TIMEFRAMES.map(tf => {
            const active = timeframe === tf
            return (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                style={{
                  padding: '12px 16px',
                  fontSize: 11,
                  fontFamily: 'Menlo,Monaco,monospace',
                  letterSpacing: '0.07em',
                  color: active ? '#F0EDE6' : '#46443D',
                  background: 'none',
                  border: 'none',
                  borderBottom: active ? `1.5px solid ${changeColor}` : '1.5px solid transparent',
                  cursor: 'pointer',
                  transition: 'color 0.15s, border-color 0.15s',
                  flexShrink: 0,
                }}
              >
                {tf}
              </button>
            )
          })}
        </div>

        {/* Stats grid */}
        <StatsGrid
          asset={asset}
          diff={diff}
          pct={pct}
          up={up}
          changeColor={changeColor}
          data={data}
        />

        {/* Liveline attribution */}
        <div style={{ padding: '0 24px 40px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            className="pulse-dot"
            style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }}
          />
          <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
            LIVE · POWERED BY HYPERLIQUID
          </span>
        </div>

        {/* Bottom safe area */}
        <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
      </div>

      {showShare && (
        <ShareSheet
          asset={asset}
          price={livePrice ?? asset.seedPrice}
          diff={diff}
          pct={pct}
          sparkValues={sparkValues}
          changeColor={changeColor}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}

function StatsGrid({
  asset, diff, pct, up, changeColor, data,
}: {
  asset: Asset
  diff: number
  pct: number
  up: boolean
  changeColor: string
  data: LivelinePoint[]
}) {
  if (!asset) return null
  const { diffStr, pctStr } = formatChange(diff, pct, asset.decimals)

  const volume = data.length > 0
    ? data.reduce((sum, p) => sum + p.value, 0) * 0.001
    : 214000000

  const openInt = volume * 0.39
  const funding = 0.0102

  const stats = [
    { label: '24H CHANGE', value: `${diffStr} (${pctStr})`, color: changeColor },
    { label: '24H VOLUME', value: formatVolume(volume), color: '#F0EDE6' },
    { label: 'OPEN INT', value: formatVolume(openInt), color: '#F0EDE6' },
    { label: 'FUNDING', value: `${up ? '+' : ''}${funding.toFixed(4)}%`, color: changeColor },
  ]

  return (
    <div style={{
      padding: '28px 24px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '16px 24px',
    }}>
      {stats.map(({ label, value, color }) => (
        <div key={label}>
          <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 4 }}>
            {label}
          </div>
          <div style={{ fontSize: 13, color, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}
