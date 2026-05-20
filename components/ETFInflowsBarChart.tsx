'use client'

import { useRef, useEffect, useState } from 'react'

const MONO = 'Menlo,Monaco,monospace'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const ETF_COLORS = { total: '#F0EDE6', bhyp: '#F0C84A', thyp: '#26ab83' }

export interface InflowBarPoint {
  time: number
  total: number
  bhyp: number
  thyp: number
}

const BARS = [
  { key: 'bhyp' as const, color: ETF_COLORS.bhyp, label: 'BHYP' },
  { key: 'thyp' as const, color: ETF_COLORS.thyp, label: 'THYP' },
]

function fmtUSD(usd: number) {
  const s = usd >= 0 ? '+' : '-'
  const abs = Math.abs(usd)
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${s}$${(abs / 1_000).toFixed(0)}K`
  return `${s}$${abs.toFixed(0)}`
}

export default function ETFInflowsBarChart({ data, height = 160 }: { data: InflowBarPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.offsetWidth)
    const ro = new ResizeObserver(() => setW(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const TOOLTIP_H = 18
  const PAD_BOTTOM = 24
  const chartH = height - PAD_BOTTOM
  const PAD_TOP = 4

  const allVals = data.flatMap(d => [d.total, d.bhyp, d.thyp]).filter(v => v !== 0)
  const maxVal  = Math.max(...allVals, 0)
  const minVal  = Math.min(...allVals, 0)
  const range   = Math.max(maxVal - minVal, 1)
  const zeroY   = PAD_TOP + (chartH - PAD_TOP) * (maxVal / range)

  const n = data.length
  if (!w || n === 0) return <div ref={ref} style={{ height: height + TOOLTIP_H }} />

  const groupW   = w / n
  // Tight grouping: bars fill ~90% of group width, small gap between bars
  const barW     = Math.max(Math.floor((groupW * 0.9 - 2) / 3), 3)
  const barGap   = 1
  const groupPad = (groupW - (barW * 3 + barGap * 2)) / 2

  function toRect(value: number): { y: number; h: number } {
    const top = PAD_TOP + (chartH - PAD_TOP) * (maxVal - Math.max(value, 0)) / range
    const bot = PAD_TOP + (chartH - PAD_TOP) * (maxVal - Math.min(value, 0)) / range
    return { y: top, h: Math.max(bot - top, value !== 0 ? 1 : 0) }
  }

  const hoveredPoint = hovered !== null ? data[hovered] : null

  return (
    <div style={{ width: '100%' }}>
      {/* Tooltip row — fixed height above chart, never overlaps bars */}
      <div style={{ height: TOOLTIP_H, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
        {hoveredPoint
          ? BARS.map(b => {
              const v = hoveredPoint[b.key]
              if (v === 0) return null
              return (
                <span key={b.key} style={{ fontSize: 9, fontFamily: MONO, color: b.color, fontVariantNumeric: 'tabular-nums' }}>
                  {b.label} {fmtUSD(v)}
                </span>
              )
            })
          : null
        }
      </div>

      <div ref={ref} style={{ width: '100%' }}>
        <svg
          width={w}
          height={height}
          style={{ display: 'block', overflow: 'visible', cursor: 'crosshair' }}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Zero line */}
          <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="#1C1C1A" strokeWidth={1} />

          {data.map((d, i) => {
            const gx = i * groupW + groupPad
            const date = new Date(d.time * 1000)
            const isHov = hovered === i
            return (
              <g key={d.time} onMouseEnter={() => setHovered(i)}>
                {/* Hover hitbox */}
                <rect x={i * groupW} y={0} width={groupW} height={height - PAD_BOTTOM} fill="transparent" />
                {BARS.map((bar, j) => {
                  const v = d[bar.key]
                  if (v === 0) return null
                  const { y, h } = toRect(v)
                  return (
                    <rect
                      key={bar.key}
                      x={gx + j * (barW + barGap)}
                      y={y}
                      width={barW}
                      height={h}
                      fill={bar.color}
                      opacity={isHov ? 1 : 0.8}
                      rx={1}
                    />
                  )
                })}
                <text
                  x={i * groupW + groupW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={8}
                  fill={isHov ? '#46443D' : '#2C2C2A'}
                  fontFamily={MONO}
                >
                  {MONTHS[date.getUTCMonth()]} {date.getUTCDate()}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
