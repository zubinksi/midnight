'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { LivelinePoint } from '@/lib/hyperliquid'

interface Props {
  data: LivelinePoint[]
  value: number
  color: string
  theme?: 'dark' | 'light'
  onScrub?: (price: number | null) => void
}

export default function LivelineChart({ data, value, color, onScrub }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const scrubRef = useRef<number | null>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 260 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const e = entries[0]
      setContainerSize({ w: e.contentRect.width, h: e.contentRect.height || 260 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { w, h } = containerSize
    if (w === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    if (data.length < 2) return

    const padT = 12
    const padB = 28
    const padL = 0
    const padR = 0
    const chartW = w - padL - padR
    const chartH = h - padT - padB

    const values = data.map(p => p.value)
    const liveVal = value
    const allVals = [...values, liveVal]
    const min = Math.min(...allVals)
    const max = Math.max(...allVals)
    const range = max - min || 1

    const toX = (i: number) => padL + (i / (data.length - 1)) * chartW
    const toY = (v: number) => padT + chartH - ((v - min) / range) * chartH

    // Build line path
    ctx.beginPath()
    data.forEach((p, i) => {
      const x = toX(i)
      const y = toY(p.value)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    // Extend to live value
    const liveX = toX(data.length - 1)
    const liveY = toY(liveVal)

    // Gradient fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH)
    grad.addColorStop(0, color + '28')
    grad.addColorStop(1, color + '00')

    // Fill path
    ctx.save()
    ctx.beginPath()
    data.forEach((p, i) => {
      const x = toX(i)
      const y = toY(p.value)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.lineTo(liveX, liveY)
    ctx.lineTo(liveX, padT + chartH)
    ctx.lineTo(padL, padT + chartH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
    ctx.restore()

    // Draw line
    ctx.save()
    ctx.beginPath()
    data.forEach((p, i) => {
      const x = toX(i)
      const y = toY(p.value)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.lineTo(liveX, liveY)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.restore()

    // Scrub crosshair
    const scrubIdx = scrubRef.current
    if (scrubIdx !== null && scrubIdx >= 0 && scrubIdx < data.length) {
      const sx = toX(scrubIdx)
      const sy = toY(data[scrubIdx].value)

      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#46443D'
      ctx.lineWidth = 1
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
      // Live dot + glow at right edge
      ctx.save()
      const radialGrad = ctx.createRadialGradient(liveX, liveY, 0, liveX, liveY, 12)
      radialGrad.addColorStop(0, color + '40')
      radialGrad.addColorStop(1, color + '00')
      ctx.beginPath()
      ctx.arc(liveX, liveY, 12, 0, Math.PI * 2)
      ctx.fillStyle = radialGrad
      ctx.fill()
      ctx.restore()

      ctx.beginPath()
      ctx.arc(liveX, liveY, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }, [data, value, color, containerSize])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }, [draw])

  const getIdxFromX = useCallback((clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas || data.length < 2) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const idx = Math.round((x / rect.width) * (data.length - 1))
    return Math.max(0, Math.min(data.length - 1, idx))
  }, [data])

  const handleMove = useCallback((clientX: number) => {
    const idx = getIdxFromX(clientX)
    if (idx === null) return
    scrubRef.current = idx
    onScrub?.(data[idx]?.value ?? null)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }, [getIdxFromX, data, onScrub, draw])

  const handleEnd = useCallback(() => {
    scrubRef.current = null
    onScrub?.(null)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }, [onScrub, draw])

  return (
    <div ref={containerRef} style={{ width: '100%', height: 260, position: 'relative', touchAction: 'none' }}>
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
