'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Dock() {
  const pathname = usePathname()
  const isVaults = pathname?.startsWith('/vaults')

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      display: 'flex', justifyContent: 'center',
      paddingTop: 'env(safe-area-inset-top)',
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        margin: '10px 0',
        background: 'rgba(12, 12, 11, 0.85)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid #1C1C1A',
        borderRadius: 22,
        padding: 3,
        gap: 2,
        pointerEvents: 'auto',
      } as React.CSSProperties}>
        {/* Sliding active pill */}
        <div style={{
          position: 'absolute',
          top: 3, bottom: 3,
          left: 3,
          width: 'calc(50% - 4px)',
          background: '#1C1C1A',
          borderRadius: 18,
          transform: isVaults ? 'translateX(calc(100% + 2px))' : 'translateX(0)',
          transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: 'none',
        }} />
        <Link
          href="/"
          style={{
            position: 'relative',
            padding: '6px 22px',
            borderRadius: 18,
            fontSize: 11,
            fontFamily: 'Menlo,Monaco,monospace',
            letterSpacing: '0.08em',
            color: !isVaults ? '#F0EDE6' : '#46443D',
            textDecoration: 'none',
            textAlign: 'center',
            transition: 'color 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            whiteSpace: 'nowrap',
          }}
        >MARKETS</Link>
        <Link
          href="/vaults"
          style={{
            position: 'relative',
            padding: '6px 22px',
            borderRadius: 18,
            fontSize: 11,
            fontFamily: 'Menlo,Monaco,monospace',
            letterSpacing: '0.08em',
            color: isVaults ? '#F0EDE6' : '#46443D',
            textDecoration: 'none',
            textAlign: 'center',
            transition: 'color 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            whiteSpace: 'nowrap',
          }}
        >VAULTS</Link>
      </div>
    </div>
  )
}
