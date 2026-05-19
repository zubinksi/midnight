'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const sheetRef      = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    const handle = dragHandleRef.current
    const sheet  = sheetRef.current
    if (!handle || !sheet) return
    let startY = 0, dy = 0
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY; dy = 0
      sheet.style.animation = 'none'
      sheet.style.transition = 'none'
    }
    const onMove = (e: TouchEvent) => {
      dy = Math.max(0, e.touches[0].clientY - startY)
      sheet.style.transform = `translateY(${dy}px)`
      e.preventDefault()
    }
    const onEnd = () => {
      if (dy > 120) {
        sheet.style.transition = 'transform 0.25s ease'
        sheet.style.transform  = 'translateY(100%)'
        setTimeout(onClose, 220)
      } else {
        sheet.style.transition = 'transform 0.25s ease'
        sheet.style.transform  = 'translateY(0)'
        dy = 0
      }
    }
    handle.addEventListener('touchstart', onStart, { passive: true })
    handle.addEventListener('touchmove',  onMove,  { passive: false })
    handle.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      handle.removeEventListener('touchstart', onStart)
      handle.removeEventListener('touchmove',  onMove)
      handle.removeEventListener('touchend',   onEnd)
    }
  }, [onClose])

  const hasBase    = baseTicker.length > 0
  const maxSelected = hasBase ? 3 : 4
  const totalSlots  = hasBase ? 4 : 4
  const filledCount = (hasBase ? 1 : 0) + selected.length

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
    if (selected.length >= maxSelected) return
    setSelected(prev => [...prev, ticker])
    setSearch('')
  }

  const remove = (ticker: string) => setSelected(prev => prev.filter(t => t !== ticker))

  const canCompare = hasBase ? selected.length > 0 : selected.length > 1

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
        ref={sheetRef}
        className="slide-up"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430,
          background: '#161614',
          borderTop: '1px solid #2A2A28',
          borderRadius: '20px 20px 0 0',
          padding: '28px 24px',
          paddingBottom: 'max(48px, env(safe-area-inset-bottom))',
        }}
      >
        {/* Drag zone: handle + header */}
        <div
          ref={dragHandleRef}
          style={{ margin: '-28px -24px 0', padding: '28px 24px 0', touchAction: 'none' }}
        >
          <div style={{ width: 36, height: 4, background: '#3C3C3A', borderRadius: 2, margin: '0 auto 20px' }} />
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '-0.01em', lineHeight: 1 }}>
              Compare
            </div>
            <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.08em', marginTop: 6 }}>
              SELECT UP TO {totalSlots} ASSETS
            </div>
          </div>
        </div>

        {/* Ticker chips */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {/* Base ticker (locked) */}
          {hasBase && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#1C1C1A',
              border: `1px solid ${COMPARE_COLORS[0]}40`,
              borderRadius: 10, padding: '9px 14px',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[0], flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{baseTicker}</span>
            </div>
          )}

          {/* Selected tickers */}
          {selected.map((t, i) => {
            const color = COMPARE_COLORS[hasBase ? i + 1 : i]
            return (
              <button
                key={t}
                onClick={() => remove(t)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: '#1C1C1A',
                  border: `1px solid ${color}40`,
                  borderRadius: 10, padding: '9px 14px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{t}</span>
                <span style={{ fontSize: 11, color: '#46443D', marginLeft: 2 }}>✕</span>
              </button>
            )
          })}

          {/* Empty slots */}
          {Array.from({ length: maxSelected - selected.length }).map((_, i) => {
            const colorIdx = filledCount + i
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                border: '1px dashed #2A2A28', borderRadius: 10, padding: '9px 14px',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[colorIdx] ?? '#2A2A28', opacity: 0.25, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace' }}>···</span>
              </div>
            )
          })}
        </div>

        {/* Search input */}
        {selected.length < maxSelected && (
          <div style={{ marginBottom: 8 }}>
            <input
              type="text"
              placeholder="ADD TICKER"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus={false}
              style={{
                width: '100%',
                background: '#1C1C1A',
                border: '1px solid #2A2A28',
                borderRadius: 10,
                padding: '12px 14px',
                color: '#F0EDE6',
                fontFamily: 'Menlo,Monaco,monospace', fontSize: 12,
                letterSpacing: '0.08em', outline: 'none', boxSizing: 'border-box',
              } as React.CSSProperties}
            />
          </div>
        )}

        {/* Search results */}
        {filtered.length > 0 && (
          <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #2A2A28' }}>
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
          onClick={() => canCompare && onCompare(hasBase ? [baseTicker, ...selected] : selected)}
          disabled={!canCompare}
          style={{
            width: '100%', border: 'none', borderRadius: 10, padding: 14,
            cursor: canCompare ? 'pointer' : 'default',
            fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, letterSpacing: '0.06em', fontWeight: 700,
            background: canCompare ? '#26ab83' : '#1C1C1A',
            color: canCompare ? '#080807' : '#2C2C2A',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {canCompare ? `VIEW CHART · ${filledCount} ASSETS` : 'VIEW CHART'}
        </button>
      </div>
    </div>
  )
}
