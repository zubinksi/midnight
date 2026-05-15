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

// Liveline layout constants when badge=false, momentum=false:
//   buffer = WINDOW_BUFFER_NO_BADGE = 0.015 (fixed, no chartW dependency)
//   defaultRight = grid ? 54 : 12 = 54 (badge=false)
const PAD_TOP    = 12
const PAD_BTM    = 28
const PAD_LEFT   = 20
const PAD_RIGHT  = 54   // badge=false → grid path → 54
const CHART_H    = 200
const DRAW_H     = CHART_H - PAD_TOP - PAD_BTM  // 160
const WIN_BUFFER = 0.015 // WINDOW_BUFFER_NO_BADGE

interface ShareTheme {
  id: string
  name: string
  cardBg: string
  cardBorder: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  annotationColor: string
  positiveColor: string
  negativeColor: string
  chartColor: string | null  // null = inherit asset changeColor
  livelineTheme: 'dark' | 'light'
  showGrid: boolean
  dotBorder: string
}

const THEMES: ShareTheme[] = [
  {
    id: 'dark',
    name: 'Dark',
    cardBg: '#161614',
    cardBorder: '#2C2C2A',
    textPrimary: '#F0EDE6',
    textSecondary: '#5C5A53',
    textMuted: '#46443D',
    annotationColor: '#F0C84A',
    positiveColor: '#26ab83',
    negativeColor: '#E84332',
    chartColor: null,
    livelineTheme: 'dark',
    showGrid: true,
    dotBorder: '#161614',
  },
  {
    id: 'light',
    name: 'Light',
    cardBg: '#FAFAF8',
    cardBorder: '#E0DDD6',
    textPrimary: '#1A1A18',
    textSecondary: '#6C6A60',
    textMuted: '#9C9A90',
    annotationColor: '#B8860B',
    positiveColor: '#16896A',
    negativeColor: '#C0321F',
    chartColor: null,
    livelineTheme: 'light',
    showGrid: true,
    dotBorder: '#FAFAF8',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    cardBg: '#060C06',
    cardBorder: '#1A3A1A',
    textPrimary: '#00FF41',
    textSecondary: '#00B32C',
    textMuted: '#006614',
    annotationColor: '#FFFF00',
    positiveColor: '#00FF41',
    negativeColor: '#FF3300',
    chartColor: '#00FF41',
    livelineTheme: 'dark',
    showGrid: true,
    dotBorder: '#060C06',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    cardBg: '#0D1523',
    cardBorder: '#1E2D45',
    textPrimary: '#E8F0FE',
    textSecondary: '#7A9CC8',
    textMuted: '#3A5070',
    annotationColor: '#F0C84A',
    positiveColor: '#34C78A',
    negativeColor: '#FF6B6B',
    chartColor: null,
    livelineTheme: 'dark',
    showGrid: true,
    dotBorder: '#0D1523',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    cardBg: '#111110',
    cardBorder: 'transparent',
    textPrimary: '#F0EDE6',
    textSecondary: '#4A4844',
    textMuted: '#2C2A28',
    annotationColor: '#F0C84A',
    positiveColor: '#26ab83',
    negativeColor: '#E84332',
    chartColor: null,
    livelineTheme: 'dark',
    showGrid: false,
    dotBorder: '#111110',
  },
]

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
  const cardRef         = useRef<HTMLDivElement>(null)
  const chartAreaRef    = useRef<HTMLDivElement>(null)
  const dateInputRef    = useRef<HTMLInputElement>(null)
  const [timeframe, setTimeframe]       = useState<Timeframe>('1M')
  const [theme, setTheme]               = useState<ShareTheme>(THEMES[0])
  const [data, setData]                 = useState<LivelinePoint[]>([])
  const [loading, setLoading]           = useState(true)
  const [mounted, setMounted]           = useState(false)
  const [postText, setPostText]         = useState('')
  const [postDate, setPostDate]         = useState('')
  const [downloading, setDownloading]   = useState(false)
  const [chartContainerW, setChartContainerW] = useState(0)

  useEffect(() => setMounted(true), [])

  // Measure the actual rendered chart container width for pixel-accurate dot positioning
  useEffect(() => {
    const el = chartAreaRef.current
    if (!el) return
    const update = () => setChartContainerW(el.clientWidth)
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

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

  // Map asset change color to theme's positive/negative color
  const isPositiveChange  = changeColor !== '#E84332'
  const themeChangeColor  = isPositiveChange ? theme.positiveColor : theme.negativeColor
  const chartLineColor    = theme.chartColor ?? changeColor

  // Annotation position — uses Liveline's exact window math for badge=false, momentum=false:
  //   rightEdge = Date.now()/1000 + windowSecs * 0.015
  //   leftEdge  = rightEdge - windowSecs
  //   toX(t) = PAD_LEFT + (t - leftEdge) / windowSecs * (containerW - PAD_LEFT - PAD_RIGHT)
  const annotation = postDate && data.length > 1 && chartContainerW > 0
    ? (() => {
        const ts   = new Date(postDate).getTime() / 1000
        const now  = Date.now() / 1000
        const win  = chartWindow ?? (data.at(-1)!.time - data[0].time)
        const rightEdge = now + win * WIN_BUFFER
        const leftEdge  = rightEdge - win
        if (ts < leftEdge || ts > rightEdge) return null

        const chartW = chartContainerW - PAD_LEFT - PAD_RIGHT
        const xPct   = (ts - leftEdge) / (rightEdge - leftEdge)
        const dotX   = PAD_LEFT + xPct * chartW

        // Y: replicate computeRange on visible data (12% margin)
        const visible = data.filter(p => p.time >= leftEdge)
        if (visible.length === 0) return null

        let rawMin = currentPrice, rawMax = currentPrice
        for (const p of visible) {
          if (p.value < rawMin) rawMin = p.value
          if (p.value > rawMax) rawMax = p.value
        }
        const rawRange = rawMax - rawMin
        const margin   = rawRange * 0.12
        const yMin     = rawMin - margin
        const yMax     = rawMax + margin

        let closest = visible[0], bestDist = Infinity
        for (const p of visible) {
          const d = Math.abs(p.time - ts)
          if (d < bestDist) { bestDist = d; closest = p }
        }

        const yPct = (closest.value - yMin) / (yMax - yMin)
        const dotY = PAD_TOP + DRAW_H * (1 - yPct)

        return { dotX, dotY, closestValue: closest.value }
      })()
    : null

  const share = async () => {
    if (!cardRef.current || downloading) return
    setDownloading(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas   = await html2canvas(cardRef.current, { backgroundColor: theme.cardBg, scale: 2, useCORS: true, logging: false })
      const filename = `${ticker}-${timeframe.toLowerCase()}.png`
      if (navigator.share && navigator.canShare) {
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(), 'image/png'))
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `${ticker} ${pctStr}` })
          setDownloading(false)
          return
        }
      }
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = filename
      a.click()
    } catch {}
    setDownloading(false)
  }

  const annotationLabel = postDate
    ? new Date(postDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const annotationPrice  = annotation?.closestValue ?? null
  const annotationPct    = annotationPrice !== null && annotationPrice > 0
    ? ((currentPrice - annotationPrice) / annotationPrice) * 100
    : null
  const annotationPctStr = annotationPct !== null
    ? `${annotationPct >= 0 ? '+' : ''}${annotationPct.toFixed(2)}%`
    : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#080807', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
      <div style={{ maxWidth: 430, margin: '0 auto', padding: 'calc(env(safe-area-inset-top) + 16px) 24px calc(max(env(safe-area-inset-bottom), 32px) + 16px)', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 28, cursor: 'pointer', padding: '4px 0', lineHeight: 1 }}>←</button>
          <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em' }}>SHARE CHART</span>
          <div style={{ width: 32 }} />
        </div>

        {/* ── Card preview (captured by html2canvas) ── */}
        <div ref={cardRef} style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, overflow: 'hidden', paddingTop: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}>

          {/* Card header */}
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: theme.textPrimary, fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.02em' }}>{ticker}</span>
              <span style={{ fontSize: 12, color: theme.textSecondary, fontFamily: 'Menlo,Monaco,monospace' }}>{assetName}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 36, fontWeight: 700, color: theme.textPrimary, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em', lineHeight: 1 }}>
                {currentPrice > 0 ? formatPrice(currentPrice, decimals) : '—'}
              </span>
              {!annotationLabel && (
                <span style={{ fontSize: 15, color: themeChangeColor, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>{pctStr}</span>
              )}
            </div>
            {annotationLabel && (
              <div style={{ marginTop: 8, fontFamily: 'Menlo,Monaco,monospace', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: theme.annotationColor, fontVariantNumeric: 'tabular-nums' }}>Since {annotationLabel}</span>
                  {annotationPctStr && (
                    <span style={{ fontSize: 14, fontWeight: 700, color: annotationPct! >= 0 ? theme.positiveColor : theme.negativeColor, fontVariantNumeric: 'tabular-nums' }}>{annotationPctStr}</span>
                  )}
                </div>
                {postText && (
                  <div style={{ fontSize: 11, color: theme.textSecondary, lineHeight: 1.4 }}>
                    {postText.length > 100 ? postText.slice(0, 100) + '…' : postText}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chart — badge=false, momentum=false for fixed, predictable layout constants */}
          <div ref={chartAreaRef} style={{ position: 'relative' }}>
            {mounted && (
              <Liveline
                data={data}
                value={currentPrice}
                color={chartLineColor}
                theme={theme.livelineTheme}
                fill
                grid={theme.showGrid}
                badge={false}
                momentum={false}
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

            {/* Yellow dot at annotation position (pixel-accurate) */}
            {annotation !== null && (
              <div style={{
                position: 'absolute',
                width: 10, height: 10,
                borderRadius: '50%',
                background: theme.annotationColor,
                border: `2px solid ${theme.dotBorder}`,
                boxShadow: `0 0 6px ${theme.annotationColor}80`,
                pointerEvents: 'none',
                left: annotation.dotX - 5,
                top:  annotation.dotY - 5,
              }} />
            )}
          </div>

          {/* Card footer */}
          <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: theme.textMuted, fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em', fontWeight: 600 }}>neue.markets</span>
            <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em' }}>{timeframe}</span>
          </div>
        </div>

        {/* Time window */}
        <div>
          <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 10 }}>TIME WINDOW</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WINDOWS.map(w => {
              const active = timeframe === w.tf
              return (
                <button key={w.tf} onClick={() => setTimeframe(w.tf)} style={{
                  background: active ? '#1C1C1A' : 'transparent',
                  border: `1px solid ${active ? '#2C2C2A' : '#1C1C1A'}`,
                  borderRadius: 6, padding: '6px 14px',
                  fontSize: 11, fontFamily: 'Menlo,Monaco,monospace',
                  color: active ? '#F0EDE6' : '#46443D',
                  cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
                }}>{w.label}</button>
              )
            })}
          </div>
        </div>

        {/* Theme selector */}
        <div>
          <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 10 }}>THEME</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            {THEMES.map(t => {
              const active = theme.id === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t)}
                  style={{
                    flexShrink: 0,
                    width: 68,
                    background: 'none',
                    border: `1px solid ${active ? '#F0EDE6' : '#2C2C2A'}`,
                    borderRadius: 8,
                    padding: '8px 0 7px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 7,
                    transition: 'border-color 0.15s',
                  }}
                >
                  {/* Mini card preview */}
                  <div style={{
                    width: 44, height: 28,
                    background: t.cardBg,
                    borderRadius: 4,
                    border: `1px solid ${t.cardBorder === 'transparent' ? 'rgba(255,255,255,0.06)' : t.cardBorder}`,
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    {/* Simulated chart squiggle */}
                    <svg width="44" height="28" viewBox="0 0 44 28" style={{ position: 'absolute', inset: 0 }}>
                      <polyline
                        points="2,22 8,16 14,18 20,10 26,13 32,8 40,5"
                        fill="none"
                        stroke={t.chartColor ?? t.positiveColor}
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity="0.85"
                      />
                    </svg>
                  </div>
                  <span style={{
                    fontSize: 9,
                    fontFamily: 'Menlo,Monaco,monospace',
                    color: active ? '#F0EDE6' : '#46443D',
                    letterSpacing: '0.06em',
                    transition: 'color 0.15s',
                  }}>{t.name.toUpperCase()}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Timestamp — button that expands to inputs */}
        <div>
          {!postDate ? (
            <button
              onClick={() => {
                const now = new Date()
                now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
                setPostDate(now.toISOString().slice(0, 16))
              }}
              style={{
                width: '100%', background: 'none',
                border: '1px solid #2C2C2A', borderRadius: 10,
                padding: '12px 16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
                letterSpacing: '0.06em', color: '#46443D',
              }}
            >
              <span>+ ADD TIMESTAMP</span>
              <span style={{ fontSize: 10, color: '#2C2C2A' }}>OPTIONAL</span>
            </button>
          ) : (
            <div style={{ border: '1px solid #2C2C2A', borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#F0C84A', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em' }}>TIMESTAMP</span>
                <button
                  onClick={() => { setPostDate(''); setPostText('') }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 11, padding: 0 }}
                >REMOVE</button>
              </div>
              {/* Hidden native input — triggers OS date picker; styled div handles display */}
              <div style={{ position: 'relative', borderBottom: '1px solid #1C1C1A', paddingBottom: 6 }}>
                <div style={{ fontSize: 12, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', padding: '6px 0 0', pointerEvents: 'none' }}>
                  {postDate
                    ? new Date(postDate).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                    : <span style={{ color: '#46443D' }}>Select date & time</span>}
                </div>
                <input
                  ref={dateInputRef}
                  type="datetime-local"
                  value={postDate}
                  onChange={e => setPostDate(e.target.value)}
                  style={{
                    position: 'absolute', inset: 0, opacity: 0,
                    width: '100%', height: '100%', cursor: 'pointer',
                  } as React.CSSProperties}
                />
              </div>
              <textarea
                placeholder="POST TEXT (OPTIONAL)"
                value={postText}
                onChange={e => setPostText(e.target.value)}
                rows={2}
                style={{
                  width: '100%', background: 'transparent', border: 'none',
                  borderBottom: '1px solid #1C1C1A', padding: '6px 0',
                  color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
                  letterSpacing: '0.04em', outline: 'none', resize: 'none',
                  boxSizing: 'border-box',
                } as React.CSSProperties}
              />
            </div>
          )}
        </div>

        {/* Share */}
        <button onClick={share} disabled={downloading} style={{
          width: '100%', border: 'none', borderRadius: 10, padding: 14,
          cursor: downloading ? 'default' : 'pointer',
          fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
          letterSpacing: '0.06em', fontWeight: 700,
          background: downloading ? '#1C1C1A' : '#26ab83',
          color: downloading ? '#2C2C2A' : '#080807',
          transition: 'background 0.15s, color 0.15s',
        }}>
          {downloading ? 'GENERATING…' : 'SHARE IMAGE'}
        </button>

      </div>
    </div>
  )
}
