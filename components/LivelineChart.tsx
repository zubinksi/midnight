'use client'

import { Liveline } from 'liveline'
import type { LivelinePoint } from '@/lib/hyperliquid'

interface Props {
  data: LivelinePoint[]
  value: number
  color: string
  loading?: boolean
  onScrub?: (price: number | null) => void
}

export default function LivelineChart({ data, value, color, loading, onScrub }: Props) {
  return (
    <div style={{ width: '100%', height: 260 }}>
      <Liveline
        data={data}
        value={value}
        color={color}
        theme="dark"
        fill
        scrub
        pulse
        loading={loading || data.length === 0}
        lineWidth={1.5}
        style={{ width: '100%', height: '100%' }}
        onHover={point => onScrub?.(point?.value ?? null)}
      />
    </div>
  )
}
