'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { LivelinePoint, Timeframe } from '@/lib/hyperliquid'
import { fetchCandles } from '@/lib/hyperliquid'
import { priceDecimals } from '@/lib/assets'
import { formatPrice } from '@/lib/format'
import type { AssetInfo } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'

const Liveline = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const WINDOWS: { label: string; tf: Timeframe }[] = [
  { label: '1D', tf: '1D' },
  { label: '7D', tf: '7D' },
  { label: '1M', tf: '1M' },
  { label: '3M', tf: '3M' },
  { label: '6M', tf: '6M' },
  { label: 'ALL', tf: 'ALL' },
]

const TF_SECS: Partial<Record<Timeframe, number>> = {
  '1D': 86400, '7D': 604800, '1M': 2592000, '3M': 7776000, '6M': 15552000,
}

// Liveline internal layout constants (grid=true, padding.left=20)
const PAD_TOP   = 12
const PAD_BTM   = 28
const PAD_LEFT  = 20
const PAD_RIGHT = 54  // defaultRight when grid=true
const CHART_H   = 200
const DRAW_H    = CHART_H - PAD_TOP - PAD_BTM  // 160

interface Props {
  ticker: string
  assetInfo: AssetInfo | null
  currentPrice: number
  changeColor: string
  pctStr: string
  coin: string
  onClose: () => void
}

export default function ShareModal({ ticker, assetInfo, currentPrice, changeColor, pctStr, coin, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [timeframe, setTimeframe]     = useState<Timeframe>('1M')
  const [data, setData]               = useState<LivelinePoint[]>([])
  const [loading, setLoading]         = useState(true)
  const [mounted, setMounted]         = useState(false)
  const [postText, setPostText]       = useState('')
  const [postDate, setPostDate]       = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCandles(coin, timeframe)
      .then(pts => { if (!cancelled) { setData(pts); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [coin, timeframe])

  const chartWindow = timeframe === 'ALL' && data.length > 1
    ? Math.ceil((data.at(-1)!.time - data[0].time) * 1.02)
    : TF_SECS[timeframe]

  const decimals  = priceDecimals(currentPrice)
  const assetName = getAssetName(ticker)

  // Annotation: x/y computed against the VISIBLE window, matching Liveline exactly
  const annotation = postDate && data.length > 1
    ? (() => {
        const ts = new Date(postDate).getTime() / 1000
        const t1 = data.at(-1)!.time

        // Visible window boundaries
        const visibleStart = chartWindow != null ? t1 - chartWindow : data[0].time
        if (ts < visibleStart || ts > t1) return null

        const xPct = (ts - visibleStart) / (t1 - visibleStart)

        // Only consider visible points for range (matching Liveline's computeRange)
        const visible = data.filter(p => p.time >= visibleStart)
        let rawMin = currentPrice, rawMax = currentPrice
        for (const p of visible) {
          if (p.value < rawMin) rawMin = p.value
          if (p.value > rawMax) rawMax = p.value
        }
        const rawRange = rawMax - rawMin
        const margin   = rawRange * 0.12
        const yMin     = rawMin - margin
        const yMax     = rawMax + margin

        // Closest visible data point → y pixel
        let closest = visible[0]
        let bestDist = Infinity
        for (const p of visible) {
          const d = Math.abs(p.time - ts)
          if (d < bestDist) { bestDist = d; closest = p }
        }

        const yPct = (closest.value - yMin) / (yMax - yMin)
        const yPx  = PAD_TOP + DRAW_H * (1 - yPct)

        return { xPct, yPx }
      })()
    : null

  const download = async () => {
    if (!cardRef.current || downloading) return
    setDownloading(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#080807',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const url = canvas.toDataURL('image/png')
      const a   = document.createElement('a')
      a.href     = url
      a.download = `${ticker}-${timeframe.toLowerCase()}.png`
      a.click()
    } catch {}
    setDownloading(false)
  }

  const annotationLabel = postDate
    ? new Date(postDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#080807', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
      <div style={{ maxWidth: 430, margin: '0 auto', padding: 'calc(env(safe-area-inset-top) + 16px) 24px calc(max(env(safe-area-inset-bottom), 32px) + 16px)', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 28, cursor: 'pointer', padding: '4px 0', lineHeight: 1 }}
          >←</button>
          <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em' }}>SHARE CHART</span>
          <div style={{ width: 32 }} />
        </div>

        {/* ── Card preview (captured by html2canvas) ── */}
        <div ref={cardRef} style={{
          background: '#080807',
          border: '1px solid #1C1C1A',
          borderRadius: 16,
          overflow: 'hidden',
          paddingTop: 20,
        }}>
          {/* Card header */}
          <div style={{ padding: '0 20px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.04em' }}>{ticker}</span>
              <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>{assetName}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 34, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em', lineHeight: 1 }}>
                {currentPrice > 0 ? formatPrice(currentPrice, decimals) : '—'}
              </span>
              <span style={{ fontSize: 14, color: changeColor, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>{pctStr}</span>
            </div>
            {/* Annotation label — fixed under price, same yellow as dot */}
            {annotationLabel && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#F0C84A', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.4 }}>
                {annotationLabel}
                {postText && (
                  <span style={{ color: '#46443D' }}> · {postText.length > 80 ? postText.slice(0, 80) + '…' : postText}</span>
                )}
              </div>
            )}
          </div>

          {/* Chart + dot overlay */}
          <div style={{ position: 'relative' }}>
            {mounted && (
              <Liveline
                data={data}
                value={currentPrice}
                color={changeColor}
                theme="dark"
                fill
                grid
                loading={loading || data.length === 0}
                lineWidth={1.5}
                window={chartWindow}
                padding={{ left: PAD_LEFT }}
                formatTime={timeframe !== '1D' ? (t: number) => {
                  const d = new Date(t * 1000)
                  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
                } : undefined}
                style={{ width: '100%', height: CHART_H }}
              />
            )}

            {/* Yellow dot on the chart line */}
            {annotation !== null && (
              <div style={{
                position: 'absolute',
                width: 10, height: 10,
                borderRadius: '50%',
                background: '#F0C84A',
                border: '2px solid #080807',
                boxShadow: '0 0 6px rgba(240,200,74,0.5)',
                pointerEvents: 'none',
                left: `calc(${PAD_LEFT}px + ${annotation.xPct} * (100% - ${PAD_LEFT + PAD_RIGHT}px) - 5px)`,
                top: annotation.yPx - 5,
              }} />
            )}
          </div>

          {/* Card footer */}
          <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em' }}>neue.markets</span>
            <span style={{ fontSize: 10, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace' }}>{timeframe}</span>
          </div>
        </div>

        {/* Time window selector */}
        <div>
          <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 10 }}>TIME WINDOW</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WINDOWS.map(w => {
              const active = timeframe === w.tf
              return (
                <button
                  key={w.tf}
                  onClick={() => setTimeframe(w.tf)}
                  style={{
                    background: active ? '#1C1C1A' : 'transparent',
                    border: `1px solid ${active ? '#2C2C2A' : '#1C1C1A'}`,
                    borderRadius: 6, padding: '6px 14px',
                    fontSize: 11, fontFamily: 'Menlo,Monaco,monospace',
                    color: active ? '#F0EDE6' : '#46443D',
                    cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
                  }}
                >{w.label}</button>
              )
            })}
          </div>
        </div>

        {/* Timestamp input */}
        <div>
          <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 10 }}>
            ADD TIMESTAMP <span style={{ color: '#2C2C2A' }}>· OPTIONAL</span>
          </div>
          <input
            type="datetime-local"
            value={postDate}
            onChange={e => setPostDate(e.target.value)}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              borderBottom: '1px solid #1C1C1A', padding: '10px 0',
              color: postDate ? '#F0EDE6' : '#2C2C2A',
              fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
              outline: 'none', boxSizing: 'border-box', marginBottom: 12,
              colorScheme: 'dark',
            } as React.CSSProperties}
          />
          <textarea
            placeholder="POST TEXT"
            value={postText}
            onChange={e => setPostText(e.target.value)}
            rows={3}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              borderBottom: '1px solid #1C1C1A', padding: '10px 0',
              color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
              letterSpacing: '0.04em', outline: 'none', resize: 'none',
              boxSizing: 'border-box',
            } as React.CSSProperties}
          />
        </div>

        {/* Download */}
        <button
          onClick={download}
          disabled={downloading}
          style={{
            width: '100%', border: 'none', borderRadius: 10, padding: 14,
            cursor: downloading ? 'default' : 'pointer',
            fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
            letterSpacing: '0.06em', fontWeight: 700,
            background: downloading ? '#1C1C1A' : '#26ab83',
            color: downloading ? '#2C2C2A' : '#080807',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {downloading ? 'GENERATING…' : 'DOWNLOAD IMAGE'}
        </button>

      </div>
    </div>
  )
}
