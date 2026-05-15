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
const PAD_RIGHT  = 54
const CHART_H    = 200
const DRAW_H     = CHART_H - PAD_TOP - PAD_BTM
const WIN_BUFFER = 0.015
const CARD_BG    = '#161614'

// Halftone: sample grid cells, draw brightness-scaled dots on card background
async function applyHalftone(src: string, targetW: number, targetH: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // Cover-crop to target aspect ratio
      const srcAspect = img.naturalWidth / img.naturalHeight
      const dstAspect = targetW / targetH
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight
      if (srcAspect > dstAspect) {
        sw = img.naturalHeight * dstAspect
        sx = (img.naturalWidth - sw) / 2
      } else {
        sh = img.naturalWidth / dstAspect
        sy = (img.naturalHeight - sh) / 2
      }

      const sampleC = document.createElement('canvas')
      sampleC.width = targetW
      sampleC.height = targetH
      const sCtx = sampleC.getContext('2d')!
      sCtx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH)
      const pixels = sCtx.getImageData(0, 0, targetW, targetH).data

      const outC = document.createElement('canvas')
      outC.width = targetW
      outC.height = targetH
      const ctx = outC.getContext('2d')!
      ctx.fillStyle = CARD_BG
      ctx.fillRect(0, 0, targetW, targetH)

      const cellSize = 8
      for (let cy = 0; cy < targetH; cy += cellSize) {
        for (let cx = 0; cx < targetW; cx += cellSize) {
          let brightness = 0, count = 0
          const cw = Math.min(cellSize, targetW - cx)
          const ch = Math.min(cellSize, targetH - cy)
          for (let py = cy; py < cy + ch; py++) {
            for (let px = cx; px < cx + cw; px++) {
              const i = (py * targetW + px) * 4
              brightness += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
              count++
            }
          }
          brightness = brightness / count / 255

          const r = brightness * cellSize * 0.58
          if (r < 0.5) continue
          ctx.fillStyle = 'rgba(240,237,230,0.88)'
          ctx.beginPath()
          ctx.arc(cx + cellSize / 2, cy + cellSize / 2, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      resolve(outC.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = src
  })
}

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
  const photoInputRef   = useRef<HTMLInputElement>(null)

  const [timeframe, setTimeframe]       = useState<Timeframe>('1M')
  const [data, setData]                 = useState<LivelinePoint[]>([])
  const [loading, setLoading]           = useState(true)
  const [mounted, setMounted]           = useState(false)
  const [postText, setPostText]         = useState('')
  const [postDate, setPostDate]         = useState('')
  const [ditheredUrl, setDitheredUrl]   = useState<string | null>(null)
  const [dithering, setDithering]       = useState(false)
  const [downloading, setDownloading]   = useState(false)
  const [chartContainerW, setChartContainerW] = useState(0)

  useEffect(() => setMounted(true), [])

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

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so same file can be re-selected after remove
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const src = ev.target?.result as string
      setDithering(true)
      try {
        const result = await applyHalftone(src, 800, 400)
        setDitheredUrl(result)
      } catch {
        setDitheredUrl(null)
      }
      setDithering(false)
    }
    reader.readAsDataURL(file)
  }

  const chartWindow = timeframe === 'ALL' && data.length > 1
    ? Math.ceil((data.at(-1)!.time - data[0].time) * 1.02)
    : TF_SECS[timeframe]

  const decimals  = priceDecimals(currentPrice)
  const assetName = getAssetName(ticker)

  // Annotation position — Liveline exact window math for badge=false, momentum=false
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
      const canvas   = await html2canvas(cardRef.current, { backgroundColor: CARD_BG, scale: 2, useCORS: true, logging: false })
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

        {/* ── Card preview ── */}
        <div ref={cardRef} style={{ background: CARD_BG, border: '1px solid #2C2C2A', borderRadius: 16, overflow: 'hidden', paddingTop: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}>

          {/* Header */}
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.02em' }}>{ticker}</span>
              <span style={{ fontSize: 12, color: '#5C5A53', fontFamily: 'Menlo,Monaco,monospace' }}>{assetName}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 36, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em', lineHeight: 1 }}>
                {currentPrice > 0 ? formatPrice(currentPrice, decimals) : '—'}
              </span>
              {!annotationLabel && (
                <span style={{ fontSize: 15, color: changeColor, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>{pctStr}</span>
              )}
            </div>
            {annotationLabel && (
              <div style={{ marginTop: 8, fontFamily: 'Menlo,Monaco,monospace', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#F0C84A', fontVariantNumeric: 'tabular-nums' }}>Since {annotationLabel}</span>
                  {annotationPctStr && (
                    <span style={{ fontSize: 14, fontWeight: 700, color: annotationPct! >= 0 ? '#26ab83' : '#E84332', fontVariantNumeric: 'tabular-nums' }}>{annotationPctStr}</span>
                  )}
                </div>
                {postText && (
                  <div style={{ fontSize: 11, color: '#6C6A60', lineHeight: 1.4 }}>
                    {postText.length > 100 ? postText.slice(0, 100) + '…' : postText}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chart */}
          <div ref={chartAreaRef} style={{ position: 'relative' }}>
            {mounted && (
              <Liveline
                data={data}
                value={currentPrice}
                color={changeColor}
                theme="dark"
                fill
                grid
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
            {annotation !== null && (
              <div style={{
                position: 'absolute',
                width: 10, height: 10,
                borderRadius: '50%',
                background: '#F0C84A',
                border: `2px solid ${CARD_BG}`,
                boxShadow: '0 0 6px rgba(240,200,74,0.5)',
                pointerEvents: 'none',
                left: annotation.dotX - 5,
                top:  annotation.dotY - 5,
              }} />
            )}
          </div>

          {/* Dithered photo section */}
          {ditheredUrl && (
            <>
              {/* Diagonal stripe separator */}
              <div style={{
                height: 10,
                background: 'repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(255,255,255,0.06) 3px, rgba(255,255,255,0.06) 4px)',
              }} />
              <div style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ditheredUrl}
                  alt=""
                  style={{ display: 'block', width: '100%', height: 200, objectFit: 'cover' }}
                />
                {/* Fade from card bg into photo at top */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 40,
                  background: `linear-gradient(to bottom, ${CARD_BG}, transparent)`,
                  pointerEvents: 'none',
                }} />
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em', fontWeight: 600 }}>neue.markets</span>
            <span style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em' }}>{timeframe}</span>
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

        {/* Photo */}
        <div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            style={{ display: 'none' }}
          />
          {!ditheredUrl ? (
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={dithering}
              style={{
                width: '100%', background: 'none',
                border: '1px solid #2C2C2A', borderRadius: 10,
                padding: '12px 16px', cursor: dithering ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
                letterSpacing: '0.06em', color: dithering ? '#2C2C2A' : '#46443D',
              }}
            >
              <span>{dithering ? 'PROCESSING…' : '+ ADD PHOTO'}</span>
              <span style={{ fontSize: 10, color: '#2C2C2A' }}>OPTIONAL</span>
            </button>
          ) : (
            <div style={{ border: '1px solid #2C2C2A', borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em' }}>PHOTO ADDED</span>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => photoInputRef.current?.click()}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 11, padding: 0 }}
                >CHANGE</button>
                <button
                  onClick={() => setDitheredUrl(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 11, padding: 0 }}
                >REMOVE</button>
              </div>
            </div>
          )}
        </div>

        {/* Timestamp */}
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
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' } as React.CSSProperties}
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
