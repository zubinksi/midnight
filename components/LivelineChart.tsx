'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import type { WindowOption, ReferenceLine } from 'liveline'
import type { LivelinePoint } from '@/lib/hyperliquid'

const Liveline = dynamic(
  () => import('liveline').then(m => m.Liveline),
  { ssr: false }
)

interface Props {
  data: LivelinePoint[]
  value: number
  color: string
  loading?: boolean
  window?: number
  windows?: WindowOption[]
  onWindowChange?: (secs: number) => void
  onScrub?: (price: number | null) => void
  formatTime?: (t: number) => string
  padding?: { left?: number; right?: number; top?: number; bottom?: number }
  referenceLine?: ReferenceLine
}

export default function LivelineChart({ data, value, color, loading, window: windowSecs, windows, onWindowChange, onScrub, formatTime, padding, referenceLine }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isLoading = !mounted || loading || data.length === 0
  const safeValue = value !== 0 ? value : (data.at(-1)?.value ?? 0)

  return (
    <div style={{ width: '100%', height: 300 }}>
      {mounted && (
        <Liveline
          data={data}
          value={safeValue}
          color={color}
          theme="dark"
          fill
          scrub
          pulse
          grid
          loading={isLoading}
          lineWidth={1.5}
          window={windowSecs}
          windows={windows}
          onWindowChange={onWindowChange}
          formatTime={formatTime}
          padding={padding}
          referenceLine={referenceLine}
          style={{ width: '100%', height: '100%' }}
          onHover={point => onScrub?.(point?.value ?? null)}
        />
      )}
    </div>
  )
}
