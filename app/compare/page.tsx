'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { AssetInfo } from '@/lib/assets'
import { getAssetName } from '@/lib/assetNames'
import { COMPARE_COLORS } from '@/components/CompareModal'

const STORAGE_KEY = 'neue-saved-compares'

interface SavedCompare {
  tickers: string[]
  savedAt: number
}

function loadSaved(): SavedCompare[] {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? (JSON.parse(v) as SavedCompare[]) : []
  } catch { return [] }
}

function writeSaved(list: SavedCompare[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch {}
}

export default function ComparePage() {
  const router = useRouter()
  const [assets, setAssets]     = useState<AssetInfo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch]     = useState('')
  const [saved, setSaved]       = useState<SavedCompare[]>([])

  useEffect(() => {
    setSaved(loadSaved())
    Promise.all([
      fetch('/api/assets').then(r => r.json() as Promise<AssetInfo[]>),
      fetch('/api/crypto').then(r => r.json() as Promise<AssetInfo[]>),
    ]).then(([xyz, crypto]) => setAssets([...xyz, ...crypto])).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return assets
      .filter(a => !selected.includes(a.ticker))
      .filter(a =>
        a.ticker.toLowerCase().includes(q) ||
        getAssetName(a.ticker).toLowerCase().includes(q)
      )
      .slice(0, 6)
  }, [search, assets, selected])

  const add    = (ticker: string) => { if (selected.length >= 4) return; setSelected(p => [...p, ticker]); setSearch('') }
  const remove = (ticker: string) => setSelected(p => p.filter(t => t !== ticker))

  const canCompare = selected.length >= 2

  const viewChart = () => {
    if (!canCompare) return
    router.push(`/compare/${selected.join('_')}`)
  }

  const saveCompare = () => {
    if (!canCompare) return
    const key = [...selected].sort().join('_')
    const next = [
      { tickers: selected, savedAt: Date.now() },
      ...loadSaved().filter(s => [...s.tickers].sort().join('_') !== key),
    ].slice(0, 20)
    writeSaved(next)
    setSaved(next)
  }

  const removeSaved = (idx: number) => {
    const next = saved.filter((_, i) => i !== idx)
    writeSaved(next)
    setSaved(next)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#080807', overflow: 'hidden' }}>
      <div style={{ maxWidth: 430, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ flexShrink: 0, padding: '0 24px', paddingTop: 'calc(env(safe-area-inset-top) + 62px)' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={S.hero}>Compare</div>
            <div style={{ ...S.hero, color: '#46443D' }}>Assets.</div>
          </div>
        </div>

        {/* Builder + saved — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 24px' } as React.CSSProperties}>

          {/* Chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
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
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARE_COLORS[i], flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{t}</span>
                <span style={{ fontSize: 10, color: '#46443D', marginLeft: 2 }}>✕</span>
              </button>
            ))}
            {Array.from({ length: 4 - selected.length }).map((_, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                border: '1px dashed #1C1C1A', borderRadius: 8, padding: '6px 12px',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1C1C1A', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#2C2C2A', fontFamily: 'Menlo,Monaco,monospace' }}>···</span>
              </div>
            ))}
          </div>

          {/* Search */}
          {selected.length < 4 && (
            <div style={{ marginBottom: 8 }}>
              <input
                type="text"
                placeholder="ADD TICKER"
                value={search}
                onChange={e => setSearch(e.target.value)}
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

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 40 }}>
            <button
              onClick={viewChart}
              style={{
                flex: 1, border: 'none', borderRadius: 10, padding: 14,
                cursor: canCompare ? 'pointer' : 'default',
                fontFamily: 'Menlo,Monaco,monospace', fontSize: 12, letterSpacing: '0.06em', fontWeight: 700,
                background: canCompare ? '#26ab83' : '#1C1C1A',
                color: canCompare ? '#080807' : '#2C2C2A',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {canCompare ? `VIEW CHART · ${selected.length}` : 'VIEW CHART —'}
            </button>
            <button
              onClick={saveCompare}
              title="Save comparison"
              style={{
                flexShrink: 0, border: 'none', borderRadius: 10, padding: '14px 18px',
                cursor: canCompare ? 'pointer' : 'default',
                fontFamily: 'Menlo,Monaco,monospace', fontSize: 16,
                background: '#1C1C1A',
                color: canCompare ? '#F0C84A' : '#2C2C2A',
                transition: 'color 0.15s',
              }}
            >★</button>
          </div>

          {/* Saved section */}
          {saved.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.1em', marginBottom: 12 }}>SAVED</div>
              {saved.map((s, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1C1C1A', gap: 10 }}
                >
                  <button
                    onClick={() => router.push(`/compare/${s.tickers.join('_')}`)}
                    style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {s.tickers.map((t, i) => (
                        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: COMPARE_COLORS[i], display: 'inline-block', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>{t}</span>
                        </span>
                      ))}
                    </div>
                  </button>
                  <button
                    onClick={() => removeSaved(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2C2C2A', fontSize: 16, padding: '4px 8px', flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
            </>
          )}

          <div style={{ height: 'max(env(safe-area-inset-bottom), 32px)' }} />
        </div>
      </div>
    </div>
  )
}

const S = {
  hero: { fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' } as React.CSSProperties,
}
