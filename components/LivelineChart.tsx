'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import type { WindowOption } from 'liveline'
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
}

export default function LivelineChart({ data, value, color, loading, window: windowSecs, windows, onWindowChange, onScrub }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isLoading = !mounted || loading || data.length === 0
  const safeValue = value !== 0 ? value : (data.at(-1)?.value ?? 0)

  return (
    <div style={{ width: '100%', height: 260, position: 'relative' }}>
      {mounted && (
        <Liveline
          data={data}
          value={safeValue}
          color={color}
          theme="dark"
          fill
          scrub
          pulse
          grid={false}
          loading={isLoading}
          lineWidth={1.5}
          window={windowSecs}
          windows={windows}
          onWindowChange={onWindowChange}
          style={{ width: '100%', height: '100%' }}
          onHover={point => onScrub?.(point?.value ?? null)}
        />
      )}
      {/* Cover Liveline's hardcoded x-axis separator line (always at height-28px) */}
      <div style={{ position: 'absolute', top: 232, left: 0, right: 0, height: 1, background: '#080807', pointerEvents: 'none', zIndex: 2 }} />
    </div>
  )
}
