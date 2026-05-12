'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Dock() {
  const pathname = usePathname()
  const isVaults = pathname?.startsWith('/vaults')
  const isMarkets = !isVaults

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      display: 'flex', justifyContent: 'center',
      paddingTop: 'env(safe-area-inset-top)',
      pointerEvents: 'none',
    }}>
      <div style={{
        display: 'flex', gap: 2,
        margin: '10px 0',
        background: 'rgba(12, 12, 11, 0.85)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid #1C1C1A',
        borderRadius: 22,
        padding: 3,
        pointerEvents: 'auto',
      } as React.CSSProperties}>
        <Link
          href="/"
          style={{
            padding: '6px 22px',
            borderRadius: 18,
            fontSize: 11,
            fontFamily: 'Menlo,Monaco,monospace',
            letterSpacing: '0.08em',
            background: isMarkets ? '#1C1C1A' : 'transparent',
            color: isMarkets ? '#F0EDE6' : '#46443D',
            textDecoration: 'none',
            transition: 'color 0.15s, background 0.15s',
            whiteSpace: 'nowrap',
          }}
        >MARKETS</Link>
        <Link
          href="/vaults"
          style={{
            padding: '6px 22px',
            borderRadius: 18,
            fontSize: 11,
            fontFamily: 'Menlo,Monaco,monospace',
            letterSpacing: '0.08em',
            background: isVaults ? '#1C1C1A' : 'transparent',
            color: isVaults ? '#F0EDE6' : '#46443D',
            textDecoration: 'none',
            transition: 'color 0.15s, background 0.15s',
            whiteSpace: 'nowrap',
          }}
        >VAULTS</Link>
      </div>
    </div>
  )
}
