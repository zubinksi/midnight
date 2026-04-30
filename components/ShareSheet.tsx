'use client'

import { useEffect, useState } from 'react'
import { formatPrice, formatChange } from '@/lib/format'
import { priceDecimals } from '@/lib/assets'
import Sparkline from './Sparkline'

interface Props {
  ticker: string
  price: number
  diff: number
  pct: number
  decimals: number
  sparkValues: number[]
  changeColor: string
  onClose: () => void
}

type CopyState = 'idle' | 'link' | 'embed'

export default function ShareSheet({ ticker, price, diff, pct, decimals, sparkValues, changeColor, onClose }: Props) {
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const copy = async (type: 'link' | 'embed') => {
    const url = `https://midnight.app/chart/${ticker}`
    const text = type === 'link'
      ? url
      : `<iframe src="${url}/embed" width="400" height="200" frameborder="0"></iframe>`
    try {
      await navigator.clipboard.writeText(text)
      setCopyState(type)
      setTimeout(() => setCopyState('idle'), 1800)
    } catch { /* clipboard not available */ }
  }

  const { pctStr } = formatChange(diff, pct, decimals)
  const priceStr   = formatPrice(price, decimals)

  return (
    /* Backdrop — covers the full viewport */
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: '#000000BB',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      {/* Sheet — full-width on mobile, capped at 430px on wider screens */}
      <div
        className="slide-up"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 430,
          background: '#0F0F0E',
          borderTop: '1px solid #1C1C1A',
          borderRadius: '20px 20px 0 0',
          padding: '28px 24px',
          paddingBottom: 'max(48px, env(safe-area-inset-bottom))',
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: '#46443D', borderRadius: 2, margin: '0 auto 28px' }} />

        {/* Preview card */}
        <div style={{
          background: '#080807',
          border: '1px solid #1C1C1A',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={S.label}>{ticker}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
                {priceStr}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ ...S.label, color: changeColor }}>{pctStr}</div>
              <div style={{ ...S.label, marginTop: 4 }}>MIDNIGHT.APP</div>
            </div>
          </div>
          <div style={{ marginTop: 12, opacity: 0.6 }}>
            <Sparkline values={sparkValues} width={300} height={40} color={changeColor} />
          </div>
        </div>

        {/* Action rows */}
        {(['link', 'embed'] as const).map(type => (
          <button
            key={type}
            onClick={() => copy(type)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: 'none',
              border: 'none',
              borderBottom: '1px solid #1C1C1A',
              padding: '16px 0',
              cursor: 'pointer',
              color: '#F0EDE6',
              fontFamily: 'Menlo,Monaco,monospace',
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            <span>{type === 'link' ? 'Copy Link' : 'Copy Embed'}</span>
            <span style={{ color: copyState === type ? '#26ab83' : '#46443D', transition: 'color 0.2s' }}>
              {copyState === type ? 'COPIED' : '↗'}
            </span>
          </button>
        ))}

        {/* Dismiss */}
        <button
          onClick={onClose}
          style={{
            marginTop: 20,
            width: '100%',
            background: 'none',
            border: '1px solid #1C1C1A',
            borderRadius: 10,
            padding: 14,
            color: '#46443D',
            fontFamily: 'Menlo,Monaco,monospace',
            fontSize: 12,
            cursor: 'pointer',
            letterSpacing: '0.06em',
          }}
        >
          DISMISS
        </button>
      </div>
    </div>
  )
}

const S = {
  label: {
    fontSize: 11,
    color: '#46443D',
    fontFamily: 'Menlo,Monaco,monospace',
    letterSpacing: '0.08em',
  } as React.CSSProperties,
}
