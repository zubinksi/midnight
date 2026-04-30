'use client'

import { useEffect, useRef, useState } from 'react'
import { Asset } from '@/lib/assets'
import { formatPrice, formatChange } from '@/lib/format'
import Sparkline from './Sparkline'

interface Props {
  asset: Asset
  price: number
  diff: number
  pct: number
  sparkValues: number[]
  changeColor: string
  onClose: () => void
}

type CopyState = 'idle' | 'link' | 'embed'

export default function ShareSheet({ asset, price, diff, pct, sparkValues, changeColor, onClose }: Props) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const copy = async (type: 'link' | 'embed') => {
    const url = `https://midnight.app/chart/${asset.ticker}`
    const text =
      type === 'link'
        ? url
        : `<iframe src="${url}/embed" width="400" height="200" frameborder="0"></iframe>`
    try {
      await navigator.clipboard.writeText(text)
      setCopyState(type)
      setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      // clipboard not available
    }
  }

  const { diffStr, pctStr } = formatChange(diff, pct, asset.decimals)
  const priceStr = formatPrice(asset.ticker, price)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000000BB', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={sheetRef}
        className="slide-up"
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 430,
          background: '#0F0F0E',
          borderTop: '1px solid #1C1C1A',
          borderRadius: '20px 20px 0 0',
          padding: '28px 24px 48px',
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
              <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', marginBottom: 4 }}>
                {asset.ticker}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums' }}>
                {priceStr}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: changeColor, fontFamily: 'Menlo,Monaco,monospace', fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
                {pctStr}
              </div>
              <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>
                MIDNIGHT.APP
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, opacity: 0.6 }}>
            <Sparkline values={sparkValues} width={300} height={40} color={changeColor} />
          </div>
        </div>

        {/* Action rows */}
        {[
          { label: 'Copy Link', type: 'link' as const },
          { label: 'Copy Embed', type: 'embed' as const },
        ].map(({ label, type }) => (
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
            }}
          >
            <span>{label}</span>
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
