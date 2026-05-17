'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { useAssetPrice, usePriceHistory, Timeframe } from '@/lib/hyperliquid'
import { formatPrice, formatChange } from '@/lib/format'
import { formatMarketCap } from '@/lib/altfun'
import type { AltTokenDetails } from '@/lib/altfun'
import { priceDecimals } from '@/lib/assets'
import LivelineChart from '@/components/LivelineChart'

const WINDOWS: { label: string; tf: Timeframe }[] = [
  { label: '4H',  tf: '4H' },
  { label: '1D',  tf: '1D' },
  { label: '7D',  tf: '7D' },
  { label: '1M',  tf: '1M' },
  { label: '3M',  tf: '3M' },
  { label: 'ALL', tf: 'ALL' },
]

const TIMEFRAME_TO_SECS: Partial<Record<Timeframe, number>> = {
  '4H': 14400,
  '1D': 86400,
  '7D': 604800,
  '1M': 2592000,
  '3M': 7776000,
}

const ALT_FAVORITES_KEY = 'alt-favorites'

export default function AltTokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params)
  const router = useRouter()

  const [token, setToken]             = useState<AltTokenDetails | null>(null)
  const [loading, setLoading]         = useState(true)
  const [timeframe, setTimeframe]     = useState<Timeframe>('4H')
  const [scrubPrice, setScrubPrice]   = useState<number | null>(null)
  const [starred, setStarred]         = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ALT_FAVORITES_KEY)
      const favs: string[] = stored ? JSON.parse(stored) : []
      setStarred(favs.includes(address.toLowerCase()))
    } catch {}
  }, [address])

  useEffect(() => {
    fetch(`/api/alt/${address}`)
      .then(r => r.ok ? r.json() as Promise<AltTokenDetails> : Promise.reject())
      .then(data => setToken(data))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [address])

  const toggleStar = () => {
    setStarred(prev => {
      const next = !prev
      try {
        const stored = localStorage.getItem(ALT_FAVORITES_KEY)
        const list: string[] = stored ? JSON.parse(stored) : []
        const addr = address.toLowerCase()
        const updated = next ? [...new Set([...list, addr])] : list.filter(a => a !== addr)
        localStorage.setItem(ALT_FAVORITES_KEY, JSON.stringify(updated))
      } catch {}
      return next
    })
  }

  // Chart the backing HL perp (same as regular chart pages)
  const perpCoin   = token?.perpTicker ?? ''
  const livePrice  = useAssetPrice(perpCoin, 800)
  const { data, loading: chartLoading, openPrice } = usePriceHistory(perpCoin, timeframe)

  const currentPrice = livePrice ?? data.at(-1)?.value ?? 0
  const displayPrice = scrubPrice ?? currentPrice
  const decimals     = priceDecimals(displayPrice)

  const windowOpen = openPrice ?? displayPrice
  const windowDiff = displayPrice - windowOpen
  const windowPct  = windowOpen !== 0 ? (windowDiff / windowOpen) * 100 : 0
  const windowUp   = windowDiff >= 0
  const changeColor = windowUp ? '#26ab83' : '#E84332'
  const { pctStr } = formatChange(windowDiff, windowPct, decimals)

  const handleScrub = useCallback((p: number | null) => setScrubPrice(p), [])

  const chartWindow = timeframe === 'ALL' && data.length > 1
    ? Math.ceil((data.at(-1)!.time - data[0].time) * 1.02)
    : TIMEFRAME_TO_SECS[timeframe]

  const dir = token ? (token.isLong ? '↑' : '↓') : ''

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'calc(env(safe-area-inset-top) + 60px) 24px 0' }}>
          <button
            onClick={() => window.history.length > 1 ? router.back() : router.push('/alt')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#46443D', padding: '4px 0', lineHeight: 1 }}
          >←</button>
        </div>

        {loading && (
          <div style={{ padding: '60px 24px', textAlign: 'center', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12 }}>
            LOADING...
          </div>
        )}

        {!loading && token && (
          <>
            {/* Price block */}
            <div style={{ padding: '32px 24px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#26ab83', flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
                  {token.ticker}
                </span>
                <span style={{ fontSize: 13, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {token.name}
                </span>
                <button
                  onClick={toggleStar}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 28, color: starred ? '#F0C84A' : '#2C2C2A', padding: 0, lineHeight: 1, flexShrink: 0 }}
                >★</button>
              </div>

              {/* Backing perp badge */}
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>
                  {dir} {token.leverage}× {token.perpTicker} PERP
                </span>
              </div>

              <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
                {displayPrice > 0 ? formatPrice(displayPrice, decimals) : '—'}
              </div>
              <div style={{ fontSize: 14, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', color: changeColor }}>
                {pctStr}
              </div>
            </div>

            {/* Time windows */}
            <div style={{ marginTop: 8, padding: '0 24px' }}>
              <div style={{ display: 'inline-flex', gap: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 2, marginBottom: 4 }}>
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

            {/* Chart */}
            <LivelineChart
              data={data}
              value={livePrice ?? data.at(-1)?.value ?? 0}
              color={changeColor}
              loading={chartLoading}
              window={chartWindow}
              onScrub={handleScrub}
              formatTime={timeframe !== '4H' && timeframe !== '1D' ? (t: number) => {
                const d = new Date(t * 1000)
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              } : undefined}
            />

            {/* Stats */}
            <div style={{ padding: '24px 24px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', marginBottom: 4 }}>MARKET CAP</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMarketCap(token.marketCapUsd)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', marginBottom: 4 }}>BACKING PERP</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>
                    {dir}{token.leverage}× {token.perpTicker}
                  </div>
                </div>
              </div>

              {/* Contract address */}
              <div style={{ marginBottom: 32, paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
                <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', marginBottom: 6 }}>CONTRACT</div>
                <div
                  style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', wordBreak: 'break-all', lineHeight: 1.5, cursor: 'pointer' }}
                  onClick={() => { try { navigator.clipboard.writeText(token.address) } catch {} }}
                >
                  {token.address}
                </div>
              </div>
            </div>
          </>
        )}

        {!loading && !token && (
          <div style={{ padding: '60px 24px', textAlign: 'center', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12 }}>
            TOKEN NOT FOUND
          </div>
        )}
      </div>
    </div>
  )
}
