'use client'

import { useEffect, useRef, useCallback } from 'react'
import { LivelinePoint } from '@/lib/hyperliquid'

interface Props {
  data: LivelinePoint[]
  value: number
  color: string
  theme?: 'dark' | 'light'
  onScrub?: (price: number | null) => void
}

export default function LivelineChart({ data, value, color, onScrub }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const rafRef      = useRef<number>(0)
  const scrubRef    = useRef<number | null>(null)
  const sizeRef     = useRef({ w: 0, h: 260 })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Read size from the canvas's bounding rect — avoids stale closure issues
    const rect  = canvas.getBoundingClientRect()
    const w     = rect.width  || sizeRef.current.w
    const h     = rect.height || sizeRef.current.h
    if (w === 0) return

    sizeRef.current = { w, h }

    const dpr = window.devicePixelRatio || 1
    canvas.width  = w * dpr
    canvas.height = h * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const pts = data.length >= 2 ? data : buildFallback(value, w)
    if (pts.length < 2) return

    const padT = 12, padB = 28, padL = 0, padR = 0
    const chartW = w - padL - padR
    const chartH = h - padT - padB

    const allVals = [...pts.map(p => p.value), value]
    const min     = Math.min(...allVals)
    const max     = Math.max(...allVals)
    const range   = max - min || (value * 0.001) || 1

    const toX = (i: number) => padL + (i / (pts.length - 1)) * chartW
    const toY = (v: number) => padT + chartH - ((v - min) / range) * chartH

    const liveX = toX(pts.length - 1)
    const liveY = toY(value)

    // Gradient fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH)
    grad.addColorStop(0, color + '28')
    grad.addColorStop(1, color + '00')

    ctx.save()
    ctx.beginPath()
    pts.forEach((p, i) => {
      const x = toX(i), y = toY(p.value)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(liveX, liveY)
    ctx.lineTo(liveX, padT + chartH)
    ctx.lineTo(padL, padT + chartH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
    ctx.restore()

    // Line
    ctx.save()
    ctx.beginPath()
    pts.forEach((p, i) => {
      const x = toX(i), y = toY(p.value)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(liveX, liveY)
    ctx.strokeStyle    = color
    ctx.lineWidth      = 1.5
    ctx.lineJoin       = 'round'
    ctx.lineCap        = 'round'
    ctx.stroke()
    ctx.restore()

    // Scrub crosshair or live dot
    const scrubIdx = scrubRef.current
    if (scrubIdx !== null && scrubIdx >= 0 && scrubIdx < pts.length) {
      const sx = toX(scrubIdx)
      const sy = toY(pts[scrubIdx].value)

      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#46443D'
      ctx.lineWidth   = 1
      ctx.beginPath()
      ctx.moveTo(sx, padT)
      ctx.lineTo(sx, padT + chartH)
      ctx.stroke()
      ctx.restore()

      ctx.beginPath()
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    } else {
      // Radial glow
      const glow = ctx.createRadialGradient(liveX, liveY, 0, liveX, liveY, 12)
      glow.addColorStop(0, color + '40')
      glow.addColorStop(1, color + '00')
      ctx.beginPath()
      ctx.arc(liveX, liveY, 12, 0, Math.PI * 2)
      ctx.fillStyle = glow
      ctx.fill()

      ctx.beginPath()
      ctx.arc(liveX, liveY, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }, [data, value, color])

  // Redraw whenever data/value/color change
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }, [draw])

  // Also redraw on window resize
  useEffect(() => {
    const handleResize = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(draw)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [draw])

  const getIdxFromClientX = useCallback((clientX: number) => {
    const canvas = canvasRef.current
    const pts    = data.length >= 2 ? data : null
    if (!canvas || !pts) return null
    const rect = canvas.getBoundingClientRect()
    const x    = clientX - rect.left
    const idx  = Math.round((x / rect.width) * (pts.length - 1))
    return Math.max(0, Math.min(pts.length - 1, idx))
  }, [data])

  const handleMove = useCallback((clientX: number) => {
    const idx = getIdxFromClientX(clientX)
    if (idx === null) return
    const pts = data.length >= 2 ? data : null
    if (!pts) return
    scrubRef.current = idx
    onScrub?.(pts[idx]?.value ?? null)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }, [getIdxFromClientX, data, onScrub, draw])

  const handleEnd = useCallback(() => {
    scrubRef.current = null
    onScrub?.(null)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }, [onScrub, draw])

  return (
    <div style={{ width: '100%', height: 260, position: 'relative', touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseMove={e => handleMove(e.clientX)}
        onMouseLeave={handleEnd}
        onTouchMove={e => { e.preventDefault(); handleMove(e.touches[0].clientX) }}
        onTouchEnd={handleEnd}
      />
    </div>
  )
}

// Generates a flat placeholder line so the chart always has something to draw.
function buildFallback(price: number, _w: number): LivelinePoint[] {
  const now = Math.floor(Date.now() / 1000)
  return Array.from({ length: 30 }, (_, i) => ({
    time: now - (29 - i) * 60,
    value: price,
  }))
}
