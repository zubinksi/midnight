'use client'

import { useRef, useEffect, useState } from 'react'

const MONO = 'Inter,sans-serif'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export interface AumSeries {
  id: string
  data: { time: number; value: number }[]
  color: string
  label: string
}

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtDate(t: number): string {
  const d = new Date(t * 1000)
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate()
}

function niceMax(max: number): number {
  const mag  = Math.pow(10, Math.floor(Math.log10(max)))
  const norm = max / mag
  const ceil = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return ceil * mag
}

export default function ETFAumLineChart({
  series,
  height = 180,
}: {
  series: AumSeries[]
  height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW]         = useState(0)
  const [hoverX, setHoverX] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.offsetWidth)
    const ro = new ResizeObserver(() => setW(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const PAD_TOP    = 8
  const PAD_BOTTOM = 24
  const PAD_LEFT   = 4
  const PAD_RIGHT  = 40

  const chartH = height - PAD_BOTTOM
  const chartW = w - PAD_LEFT - PAD_RIGHT

  const allTimes = [...new Set(series.flatMap(s => s.data.map(p => p.time)))].sort((a, b) => a - b)
  const allVals  = series.flatMap(s => s.data.map(p => p.value)).filter(v => v > 0)

  const rawMax = Math.max(...allVals, 1)
  const maxVal = niceMax(rawMax)
  const tMin   = allTimes[0] ?? 0
  const tMax   = allTimes.at(-1) ?? 0
  const tRange = Math.max(tMax - tMin, 1)

  const n = allTimes.length
  if (!w || n < 2) return <div ref={ref} style={{ height }} />

  function toX(t: number): number {
    return PAD_LEFT + ((t - tMin) / tRange) * chartW
  }
  function toY(v: number): number {
    return PAD_TOP + (chartH - PAD_TOP) * (1 - v / maxVal)
  }

  // Y axis ticks: 2-3 levels
  const yStep  = maxVal / (rawMax > maxVal * 0.6 ? 2 : 4)
  const yTicks: number[] = []
  for (let v = yStep; v < maxVal; v += yStep) yTicks.push(v)

  // X axis labels: show every day if <= 10 points, else every 2nd
  const xStep   = n <= 10 ? 1 : 2
  const xLabels = allTimes.filter((_, i) => i % xStep === 0 || i === n - 1)

  // Nearest time index for hover
  function nearestIdx(px: number): number {
    const t = tMin + ((px - PAD_LEFT) / chartW) * tRange
    let best = 0, bestDist = Infinity
    for (let i = 0; i < allTimes.length; i++) {
      const d = Math.abs(allTimes[i] - t)
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }

  const hoverIdx = hoverX !== null ? nearestIdx(hoverX) : null
  const hoverTime = hoverIdx !== null ? allTimes[hoverIdx] : null

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {/* Legend + hover values */}
      <div style={{ display: 'flex', gap: 14, padding: '0 0 6px 4px', flexWrap: 'wrap', minHeight: 18 }}>
        {series.map(s => {
          const hVal = hoverTime != null ? s.data.find(p => p.time === hoverTime)?.value : s.data.at(-1)?.value
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 2, background: s.color, borderRadius: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: s.color, fontFamily: MONO, letterSpacing: '0.06em' }}>
                {s.label}
              </span>
              {hVal != null && hVal > 0 && (
                <span style={{ fontSize: 9, color: '#8A8880', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtUSD(hVal)}
                </span>
              )}
            </div>
          )
        })}
        {hoverTime != null && (
          <span style={{ fontSize: 9, color: '#46443D', fontFamily: MONO, marginLeft: 'auto' }}>
            {fmtDate(hoverTime)}
          </span>
        )}
      </div>

      <svg
        width={w}
        height={height}
        style={{ display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={e => {
          const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
          setHoverX(e.clientX - rect.left)
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* Y grid lines */}
        {yTicks.map(v => {
          const y = toY(v)
          return (
            <g key={v}>
              <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT + chartW} y2={y} stroke="#1C1C1A" strokeWidth={1} />
              <text x={PAD_LEFT + chartW + 4} y={y + 3.5} fontSize={8} fill="#2C2C2A" fontFamily={MONO}>
                {fmtUSD(v)}
              </text>
            </g>
          )
        })}

        {/* Zero line */}
        <line x1={PAD_LEFT} y1={toY(0)} x2={PAD_LEFT + chartW} y2={toY(0)} stroke="#1C1C1A" strokeWidth={1} />

        {/* Series lines */}
        {series.map(s => {
          const pts = s.data.filter(p => p.value > 0)
          if (pts.length < 2) return null
          const d = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.time).toFixed(1)},${toY(p.value).toFixed(1)}`)
            .join(' ')
          return (
            <path
              key={s.id}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={hoverIdx !== null ? 0.6 : 0.9}
            />
          )
        })}

        {/* Hover vertical line + dots */}
        {hoverIdx !== null && hoverTime !== null && (
          <>
            <line
              x1={toX(hoverTime)} y1={PAD_TOP}
              x2={toX(hoverTime)} y2={chartH}
              stroke="#2C2C2A" strokeWidth={1}
            />
            {series.map(s => {
              const pt = s.data.find(p => p.time === hoverTime)
              if (!pt || pt.value <= 0) return null
              return (
                <circle
                  key={s.id}
                  cx={toX(pt.time)}
                  cy={toY(pt.value)}
                  r={3}
                  fill={s.color}
                  stroke="#080807"
                  strokeWidth={1.5}
                />
              )
            })}
          </>
        )}

        {/* X axis labels */}
        {xLabels.map((t, i) => {
          const x = toX(t)
          const anchor = i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'
          return (
            <text
              key={t}
              x={x}
              y={height - 6}
              textAnchor={anchor}
              fontSize={8}
              fill={hoverTime === t ? '#46443D' : '#2C2C2A'}
              fontFamily={MONO}
            >
              {fmtDate(t)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
