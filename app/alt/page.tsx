'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { fetchAltTokenList } from '@/lib/altfun'
import type { AltToken } from '@/lib/altfun'

const ALT_FAVORITES_KEY = 'alt-favorites'

function getInitialFavorites(): string[] {
  try {
    const v = localStorage.getItem(ALT_FAVORITES_KEY)
    return v ? JSON.parse(v) : []
  } catch { return [] }
}

function saveFavorites(favs: string[]) {
  try { localStorage.setItem(ALT_FAVORITES_KEY, JSON.stringify(favs)) } catch {}
}

export default function AltPage() {
  const router                            = useRouter()
  const [tokens, setTokens]               = useState<AltToken[]>([])
  const [loading, setLoading]             = useState(true)
  const [progress, setProgress]           = useState(0)
  const [status, setStatus]               = useState('Connecting...')
  const [error, setError]                 = useState<string | null>(null)
  const [search, setSearch]               = useState('')
  const [favorites, setFavorites]         = useState<string[]>([])
  const [filterStarred, setFilterStarred] = useState(false)

  useEffect(() => {
    setFavorites(getInitialFavorites())

    fetchAltTokenList((pct, msg) => {
      setProgress(pct)
      setStatus(msg)
    })
      .then(data => {
        setTokens(data)
        setError(null)
      })
      .catch(err => {
        console.error('[alt tokens]', err)
        setError((err as Error).message ?? 'Failed to load tokens')
      })
      .finally(() => setLoading(false))
  }, [])

  const toggleFavorite = (address: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites(prev => {
      const next = prev.includes(address)
        ? prev.filter(a => a !== address)
        : [...prev, address]
      saveFavorites(next)
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tokens.filter(t => {
      if (filterStarred && !favorites.includes(t.address)) return false
      if (!q) return true
      return t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.perpTicker.toLowerCase().includes(q)
    })
  }, [tokens, search, filterStarred, favorites])

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ padding: 'calc(env(safe-area-inset-top) + 62px) 24px 0' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace' }}>Explore Coins</div>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace' }}>On HyperEVM.</div>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="SEARCH TOKENS"
            value={search}
            onChange={e => setSearch(e.target.value)}
            disabled={loading}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              borderBottom: '1px solid #1C1C1A', padding: '10px 0',
              color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace',
              fontSize: 12, letterSpacing: '0.08em', outline: 'none',
              boxSizing: 'border-box', marginBottom: 16,
              opacity: loading ? 0.3 : 1,
            } as React.CSSProperties}
          />

          {/* Filters */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {([['all', 'ALL'], ['starred', '★']] as const).map(([key, label]) => {
              const active = key === 'starred' ? filterStarred : !filterStarred
              return (
                <button
                  key={key}
                  onClick={() => setFilterStarred(key === 'starred')}
                  style={{
                    background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: 'none', borderRadius: 4, padding: '3px 10px',
                    fontSize: 11, fontFamily: 'Menlo,Monaco,monospace',
                    color: active ? '#F0EDE6' : '#46443D',
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer', transition: 'color 0.2s, background 0.15s',
                  }}
                >{label}</button>
              )
            })}
          </div>
        </div>

        {/* Token list */}
        <div style={{ padding: '0 24px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>

          {/* Loading progress */}
          {loading && (
            <div style={{ padding: '32px 0' }}>
              <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em', marginBottom: 12 }}>
                {status}
              </div>
              {/* Progress bar */}
              <div style={{ height: 2, background: '#1C1C1A', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  background: '#46443D',
                  borderRadius: 1,
                  width: `${progress}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: '40px 0' }}>
              <div style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em', marginBottom: 8 }}>
                ERROR
              </div>
              <div style={{ fontSize: 11, color: '#E84332', fontFamily: 'Menlo,Monaco,monospace', lineHeight: 1.5 }}>
                {error}
              </div>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', fontSize: 12 }}>
              {tokens.length === 0 ? 'NO TOKENS FOUND' : 'NO RESULTS'}
            </div>
          )}

          {filtered.map(token => {
            const starred = favorites.includes(token.address)
            const dir = token.isLong ? '↑' : '↓'
            return (
              <div
                key={token.address}
                onClick={() => router.push(`/alt/${token.address}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '16px 0', borderBottom: '1px solid #1C1C1A', cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#F0EDE6', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.04em' }}>
                      {token.ticker}
                    </span>
                    <span style={{ fontSize: 11, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {token.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#46443D', fontFamily: 'Menlo,Monaco,monospace', letterSpacing: '0.06em' }}>
                    {dir} {token.leverage}× {token.perpTicker}
                  </div>
                </div>
                <button
                  onClick={e => toggleFavorite(token.address, e)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 20, color: starred ? '#F0C84A' : '#2C2C2A',
                    padding: '0 4px', lineHeight: 1, flexShrink: 0,
                  }}
                >★</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
