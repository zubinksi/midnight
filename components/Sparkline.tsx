'use client'

import { useMemo } from 'react'

interface Props {
  values: number[]
  width?: number
  height?: number
  color: string
  strokeWidth?: number
}

export default function Sparkline({ values, width = 88, height = 28, color, strokeWidth = 1.5 }: Props) {
  const path = useMemo(() => {
    if (values.length < 2) return ''
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const pad = 2
    const w = width
    const h = height - pad * 2
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = pad + h - ((v - min) / range) * h
      return `${x},${y}`
    })
    return 'M' + pts.join('L')
  }, [values, width, height])

  if (!path) return <svg width={width} height={height} />

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      style={{ display: 'block' }}
    >
      <path d={path} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
