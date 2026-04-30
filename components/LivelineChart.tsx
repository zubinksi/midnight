'use client'

import dynamic from 'next/dynamic'
import type { LivelinePoint } from '@/lib/hyperliquid'

// Liveline uses canvas — must be client-only, no SSR
const Liveline = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

interface Props {
  data: LivelinePoint[]
  value: number
  color: string
  onScrub?: (price: number | null) => void
}

export default function LivelineChart({ data, value, color, onScrub }: Props) {
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
        lineWidth={1.5}
        style={{ width: '100%', height: '100%' }}
        onHover={point => onScrub?.(point?.value ?? null)}
      />
    </div>
  )
}
