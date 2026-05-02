'use client'

import { useState, useEffect, useMemo } from 'react'
import type { AssetInfo } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'

export const COMPARE_COLORS = ['#26ab83', '#F0C84A', '#60a5fa', '#e879f9']

interface Props {
  baseTicker: string
  allAssets: AssetInfo[]
  onClose: () => void
  onCompare: (tickers: string[]) => void
}

export default function CompareModal({ baseTicker, allAssets, onClose, onCompare }: Props) {
  const [search, setSearch]   = useState('')
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return allAssets
      .filter(a => a.ticker !== baseTicker && !selected.includes(a.ticker))
      .filter(a =>
        a.ticker.toLowerCase().includes(q) ||
        getAssetName(a.ticker).toLowerCase().includes(q)
      )
      .slice(0, 6)
  }, [search, allAssets, baseTicker, selected])

  const add = (ticker: string) => {
    if (selected.length >= 3) return
    setSelected(prev => [...prev, ticker])
    setSearch('')
  }

  const remove = (ticker: string) => setSelected(prev => prev.filter(t => t !== ticker))

  const canCompare = selected.length > 0

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: '#000000BB',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      } as React.CSSProperties}
    >
      <div
        className="slide-up"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430,
          background: '#0F0F0E',
          borderTop: '1px solid #1C1C1A',
          borderRadius: '20px 20px 0 0',
          padding: '28px 24px',
          paddingBottom: 'max(48px, env(safe-area-inset-bottom))',
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: '#46443D', borderRadius: 2, margin: '0 auto 24px' }} />

        {/* Header */}
        <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 20 }}>
          COMPARE · UP TO 4 ASSETS
        </div>

        {/* Ticker chips */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {/* Base ticker (locked) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#1C1C1A', borderRadius: 8, padding: '6px 12px',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[0], flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{baseTicker}</span>
          </div>

          {/* Selected tickers */}
          {selected.map((t, i) => (
            <button
              key={t}
              onClick={() => remove(t)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#1C1C1A', border: 'none', borderRadius: 8, padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[i + 1], flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{t}</span>
              <span style={{ fontSize: 10, color: '#46443D', marginLeft: 2 }}>✕</span>
            </button>
          ))}

          {/* Empty slots */}
          {Array.from({ length: 3 - selected.length }).map((_, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              border: '1px dashed #1C1C1A', borderRadius: 8, padding: '6px 12px',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1C1C1A', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace' }}>···</span>
            </div>
          ))}
        </div>

        {/* Search input */}
        {selected.length < 3 && (
          <div style={{ marginBottom: 8 }}>
            <input
              type="text"
              placeholder="ADD TICKER"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus={false}
              style={{
                width: '100%', background: 'transparent', border: 'none',
                borderBottom: '1px solid #1C1C1A',
                padding: '10px 0', color: '#F0EDE6',
                fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
                letterSpacing: '0.08em', outline: 'none', boxSizing: 'border-box',
              } as React.CSSProperties}
            />
          </div>
        )}

        {/* Search results */}
        {filtered.length > 0 && (
          <div style={{ marginBottom: 16, borderRadius: 8, overflow: 'hidden', border: '1px solid #1C1C1A' }}>
            {filtered.map(a => (
              <button
                key={a.ticker}
                onClick={() => add(a.ticker)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', background: 'none', border: 'none',
                  borderBottom: '1px solid #1C1C1A', padding: '12px 14px',
                  cursor: 'pointer', textAlign: 'left',
                } as React.CSSProperties}
              >
                <span style={{ fontSize: 13, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', fontWeight: 700, width: 80, flexShrink: 0 }}>{a.ticker}</span>
                <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>{getAssetName(a.ticker)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Compare button */}
        <button
          onClick={() => canCompare && onCompare([baseTicker, ...selected])}
          style={{
            width: '100%', border: 'none', borderRadius: 10, padding: 14,
            cursor: canCompare ? 'pointer' : 'default',
            fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, letterSpacing: '0.06em', fontWeight: 700,
            background: canCompare ? '#26ab83' : '#1C1C1A',
            color: canCompare ? '#080807' : '#2C2C2A',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {canCompare ? `VIEW CHART · ${selected.length + 1} ASSETS` : 'VIEW CHART —'}
        </button>

        {/* Dismiss */}
        <button
          onClick={onClose}
          style={{
            marginTop: 12, width: '100%', background: 'none',
            border: '1px solid #1C1C1A', borderRadius: 10, padding: 14,
            color: '#46443D', fontFamily: 'Menlo,Monaco,monospace',
            fontSize: 12, cursor: 'pointer', letterSpacing: '0.06em',
          }}
        >
          DISMISS
        </button>
      </div>
    </div>
  )
}
