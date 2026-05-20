'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { LivelineSeries } from 'liveline'
import type { ETFFlowsData, DailyRow } from '@/app/api/etf-flows/route'
import type { InflowBarPoint } from '@/components/ETFInflowsBarChart'
import { useAssetPrice } from '@/lib/hyperliquid'
import ETFInflowsBarChart from '@/components/ETFInflowsBarChart'

const LivelineMulti = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

const MONO = 'Inter,sans-serif'
const ETF_COLORS = { total: '#F0EDE6', thyp: '#26ab83', bhyp: '#F0C84A' }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtUSD(usd: number, sign = false) {
  const s = sign && usd >= 0 ? '+' : usd < 0 ? '-' : ''
  const abs = Math.abs(usd)
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${s}$${(abs / 1_000).toFixed(0)}K`
  return `${s}$${abs.toFixed(0)}`
}

function fmtTime(t: number) {
  const d = new Date(t * 1000)
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate()
}

function DailyHistoryTable({ rows, circulatingSupply }: { rows: DailyRow[]; circulatingSupply: number }) {
  const COL = { fontSize: 9, color: '#46443D', fontFamily: MONO, letterSpacing: '0.06em' }
  const CELL = { fontSize: 11, color: '#8A8880', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' as const }
  const sorted = [...rows].reverse()
  return (
    <div style={{ borderTop: '1px solid #1C1C1A', marginTop: 16, padding: '16px 24px 0' }}>
      <div style={{ fontSize: 10, color: '#46443D', fontFamily: MONO, letterSpacing: '0.1em', marginBottom: 12 }}>DAILY HISTORY</div>
      <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 1fr 1fr 52px', columnGap: 8, marginBottom: 6 }}>
        <div style={COL}>DATE</div>
        <div style={{ ...COL, textAlign: 'right' }}>AUM</div>
        <div style={{ ...COL, textAlign: 'right' }}>INFLOWS</div>
        <div style={{ ...COL, textAlign: 'right' }}>VOLUME</div>
        <div style={{ ...COL, textAlign: 'right' }}>% FLOAT</div>
      </div>
      {sorted.map(row => {
        const totalInflow = (row.bhypInflow ?? 0) + (row.thypInflow ?? 0)
        const totalVolume = (row.bhypVolume ?? 0) + (row.thypVolume ?? 0)
        const hasInflow   = row.bhypInflow != null || row.thypInflow != null
        const hasVolume   = row.bhypVolume != null || row.thypVolume != null
        const floatPct    = hasInflow && circulatingSupply > 0 && row.hypePrice && row.hypePrice > 0
          ? (totalInflow / row.hypePrice / circulatingSupply * 100).toFixed(2) + '%'
          : '—'
        return (
          <div key={row.time} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 1fr 1fr 52px', columnGap: 8, paddingBottom: 10 }}>
            <div style={{ ...CELL, color: '#F0EDE6' }}>{fmtTime(row.time)}</div>
            <div style={{ ...CELL, textAlign: 'right' }}>{row.totalAum > 0 ? fmtUSD(row.totalAum) : '—'}</div>
            <div style={{ ...CELL, textAlign: 'right', color: hasInflow ? '#F0EDE6' : '#46443D' }}>
              {hasInflow ? fmtUSD(totalInflow, true) : '—'}
            </div>
            <div style={{ ...CELL, textAlign: 'right' }}>{hasVolume ? fmtUSD(totalVolume) : '—'}</div>
            <div style={{ ...CELL, textAlign: 'right' }}>{floatPct}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function ETFFlowsPage() {
  const router        = useRouter()
  const [flows, setFlows]         = useState<ETFFlowsData | null>(null)
  const [mounted, setMounted]     = useState(false)
  const [hoveredInflow, setHoveredInflow] = useState<InflowBarPoint | null>(null)
  const livePrice     = useAssetPrice('HYPE', 5000)
  const currentPrice  = livePrice ?? 0

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    fetch('/api/etf-flows')
      .then(r => r.json() as Promise<ETFFlowsData>)
      .then(setFlows)
      .catch(() => {})
  }, [])

  const bhyp      = flows?.bhyp
  const thyp      = flows?.thyp
  const bhypToday = bhyp?.today ?? null
  const thypToday = thyp?.today ?? null
  const hasLive   = bhypToday !== null || thypToday !== null

  const bhypHype   = bhyp?.current ?? 0
  const thypHype   = thyp?.current ?? 0
  const bhypDeltaH = (bhyp?.prevClose ?? 0) > 0 ? bhypHype - (bhyp?.prevClose ?? 0) : null
  const thypDeltaH = (thyp?.prevClose ?? 0) > 0 ? thypHype - (thyp?.prevClose ?? 0) : null

  const thypHistory = thyp?.history ?? []
  const bhypHistory = bhyp?.history ?? []

  const timeSet    = new Set([...thypHistory.map(p => p.time), ...bhypHistory.map(p => p.time)])
  const times      = [...timeSet].sort((a, b) => a - b)
  const thypByTime = Object.fromEntries(thypHistory.map(p => [p.time, p]))
  const bhypByTime = Object.fromEntries(bhypHistory.map(p => [p.time, p]))

  // Farside actual daily inflow histories
  const bhypInflowHistory = bhyp?.inflowHistory ?? []
  const thypInflowHistory = thyp?.inflowHistory ?? []
  const bhypInflowByTime  = Object.fromEntries(bhypInflowHistory.map(p => [p.time, p.usd]))
  const thypInflowByTime  = Object.fromEntries(thypInflowHistory.map(p => [p.time, p.usd]))

  // Build AUM series with forward-fill so gaps between series don't drop to zero
  let lastThypUsd = 0, lastBhypUsd = 0
  const thypAum: { time: number; value: number }[] = []
  const bhypAum: { time: number; value: number }[] = []
  const totalAum: { time: number; value: number }[] = []
  for (const t of times) {
    if (thypByTime[t]) lastThypUsd = thypByTime[t].usd
    if (bhypByTime[t]) lastBhypUsd = bhypByTime[t].usd
    thypAum.push({ time: t, value: lastThypUsd })
    bhypAum.push({ time: t, value: lastBhypUsd })
    totalAum.push({ time: t, value: lastThypUsd + lastBhypUsd })
  }

  const hasBhypHistory = bhypHistory.length > 0
  const aumSeries: LivelineSeries[] | undefined = hasBhypHistory ? [
    { id: 'total', data: totalAum, value: totalAum.at(-1)?.value ?? 0, color: ETF_COLORS.total, label: 'TOTAL' },
    { id: 'thyp',  data: thypAum,  value: thypAum.at(-1)?.value  ?? 0, color: ETF_COLORS.thyp,  label: 'THYP'  },
    { id: 'bhyp',  data: bhypAum,  value: bhypAum.at(-1)?.value  ?? 0, color: ETF_COLORS.bhyp,  label: 'BHYP'  },
  ] : undefined
  const aumData    = hasBhypHistory ? totalAum : thypAum
  const aumColor   = hasBhypHistory ? ETF_COLORS.total : ETF_COLORS.thyp
  const aumLabel   = hasBhypHistory ? 'TOTAL AUM' : 'THYP AUM'

  // Bar chart: Farside actual flows when available, otherwise delta-shares from THYP API history
  const hasFarsideData = bhypInflowHistory.length > 0 || thypInflowHistory.length > 0
  const inflowBarData: { time: number; total: number; bhyp: number; thyp: number }[] = hasFarsideData
    ? (() => {
        const ts = [...new Set([
          ...bhypInflowHistory.map(p => p.time),
          ...thypInflowHistory.map(p => p.time),
        ])].sort((a, b) => a - b)
        return ts.map(t => {
          const bi = bhypInflowByTime[t] ?? 0
          const ti = thypInflowByTime[t] ?? 0
          return { time: t, total: bi + ti, bhyp: bi, thyp: ti }
        })
      })()
    : thypHistory.slice(1).map((p, i) => {
        const prev = thypHistory[i] // slice(1) means index i in slice = index i+1 in original
        const ti = (p.units - prev.units) * p.navPerShare
        return { time: p.time, total: ti, bhyp: 0, thyp: ti }
      })

  const hasAumChart = aumData.length >= 2
  const chartWindow = hasAumChart
    ? Math.ceil((aumData.at(-1)!.time - aumData[0].time) * 1.05) + 86400
    : undefined

  const totalLiveAum    = (bhypToday?.aum ?? 0) + (thypToday?.aum ?? 0) > 0
    ? (bhypToday?.aum ?? 0) + (thypToday?.aum ?? 0) : null
  const totalLiveInflow = bhypToday?.inflowUsd != null || thypToday?.inflowUsd != null
    ? (bhypToday?.inflowUsd ?? 0) + (thypToday?.inflowUsd ?? 0) : null

  const circulatingSupply = flows?.circulatingSupply ?? 0

  return (
    <div style={{ background: '#080807', minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ padding: 'calc(env(safe-area-inset-top) + 60px) 24px 0' }}>
          <button
            onClick={() => window.history.length > 1 ? router.back() : router.push('/chart/HYPE')}
            style={{ background: 'none', border: 'none', color: '#46443D', cursor: 'pointer', padding: '4px 0', lineHeight: 1, display: 'flex', alignItems: 'center' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="12,4 6,10 12,16" />
            </svg>
          </button>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F0EDE6', fontFamily: MONO, letterSpacing: '0.08em', marginTop: 8 }}>HYPE ETF FLOWS</div>
        </div>

        {/* Table: TOTAL first, then ETF breakdown — inside a card */}
        <div style={{ margin: '20px 16px 0' }}>
          <div style={{ background: '#0F0F0D', border: '1px solid #1C1C1A', borderRadius: 16, padding: '16px 16px 4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: '#46443D', fontFamily: MONO, letterSpacing: '0.06em' }}>ETFs</div>
              <div style={{ textAlign: 'right', fontSize: 9, color: '#46443D', fontFamily: MONO, letterSpacing: '0.06em' }}>AUM</div>
              <div style={{ textAlign: 'right', fontSize: 9, color: '#46443D', fontFamily: MONO, letterSpacing: '0.06em' }}>
                DAILY EST.
              </div>
            </div>

            {/* TOTAL row */}
            {(bhypHype + thypHype) > 0 && (
              <>
                <ETFTableRow label="TOTAL" issuer="" color={ETF_COLORS.total}
                  usd={(bhypHype + thypHype) * currentPrice} hype={bhypHype + thypHype}
                  deltaHype={bhypDeltaH !== null || thypDeltaH !== null ? (bhypDeltaH ?? 0) + (thypDeltaH ?? 0) : null}
                  currentPrice={currentPrice}
                  liveAum={totalLiveAum}
                  liveInflowUsd={totalLiveInflow} />
              </>
            )}

            {/* ETF breakdown */}
            <div style={{ borderTop: '1px solid #1C1C1A', paddingTop: 12 }}>
              <ETFTableRow label="BHYP" issuer="BITWISE"  color={ETF_COLORS.bhyp}
                usd={bhypHype * currentPrice} hype={bhypHype} deltaHype={bhypDeltaH} currentPrice={currentPrice}
                liveAum={bhypToday?.aum} liveInflowUsd={bhypToday?.inflowUsd} />
              <ETFTableRow label="THYP" issuer="21SHARES" color={ETF_COLORS.thyp}
                usd={thypHype * currentPrice} hype={thypHype} deltaHype={thypDeltaH} currentPrice={currentPrice}
                liveAum={thypToday?.aum} liveInflowUsd={thypToday?.inflowUsd} />
            </div>
          </div>
        </div>

        {/* AUM chart */}
        <div style={{ marginTop: 16 }}>
          <div style={{ padding: '16px 24px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: '#46443D', fontFamily: MONO, letterSpacing: '0.1em' }}>{aumLabel}</span>
          </div>
          {hasAumChart && mounted ? (
            <div className={aumSeries ? 'll-wrap' : undefined}>
              <LivelineMulti
                data={aumData}
                value={aumData.at(-1)?.value ?? 0}
                color={aumColor}
                series={aumSeries}
                theme="dark"
                scrub
                grid
                lineWidth={1.5}
                window={chartWindow}
                formatValue={v => fmtUSD(v)}
                formatTime={fmtTime}
                padding={{ left: 24 }}
                style={{ width: '100%', height: 180 }}
              />
            </div>
          ) : (
            <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, color: '#2C2C2A', fontFamily: MONO }}>{mounted ? 'NO HISTORY' : ''}</span>
            </div>
          )}
        </div>

        {/* Daily inflows bar chart — tooltip in header row */}
        <div style={{ borderTop: '1px solid #1C1C1A', marginTop: 16 }}>
          <div style={{ padding: '16px 24px 0', display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 10, color: '#46443D', fontFamily: MONO, letterSpacing: '0.1em', flexShrink: 0 }}>DAILY INFLOWS</span>
            {hoveredInflow && (
              <span style={{ fontSize: 10, color: (hoveredInflow.total ?? 0) >= 0 ? ETF_COLORS.total : '#E84332', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                {fmtUSD(hoveredInflow.total, true)}
              </span>
            )}
          </div>
          {inflowBarData.length > 0
            ? <div style={{ padding: '0 24px' }}>
                <ETFInflowsBarChart data={inflowBarData} onHover={setHoveredInflow} />
              </div>
            : <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: '#2C2C2A', fontFamily: MONO }}>NO HISTORY</span>
              </div>
          }
        </div>

        {/* Historical data table */}
        {flows?.dailyHistory && flows.dailyHistory.length > 0 && (
          <DailyHistoryTable rows={flows.dailyHistory} circulatingSupply={circulatingSupply} />
        )}

        <div style={{ height: 'max(env(safe-area-inset-bottom), 40px)' }} />
      </div>
    </div>
  )
}

function ETFTableRow({ label, issuer, color, usd, hype, deltaHype, currentPrice, liveAum, liveInflowUsd }: {
  label: string; issuer: string; color: string
  usd: number; hype: number; deltaHype: number | null; currentPrice: number
  liveAum?: number | null; liveInflowUsd?: number | null
}) {
  const displayUsd       = liveAum ?? usd
  const displayHype      = liveAum && currentPrice > 0 ? liveAum / currentPrice : hype
  const isLiveDelta      = liveInflowUsd != null
  const deltaUsd         = isLiveDelta ? liveInflowUsd! : (deltaHype !== null ? deltaHype * currentPrice : null)
  const deltaHypeDisplay = isLiveDelta && currentPrice > 0 ? liveInflowUsd! / currentPrice : deltaHype
  const up               = (deltaUsd ?? 0) >= 0
  const dColor           = up ? '#26ab83' : '#E84332'

  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 8 }

  return (
    <div style={{ ...grid, alignItems: 'start', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 2 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#F0EDE6', fontFamily: MONO }}>{label}</div>
          <div style={{ fontSize: 9, color: '#46443D', fontFamily: MONO, letterSpacing: '0.06em' }}>{issuer}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: displayUsd > 0 ? '#F0EDE6' : '#2C2C2A', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
          {displayUsd > 0 ? fmtUSD(displayUsd) : '—'}
        </div>
        {displayHype > 0 && (
          <div style={{ fontSize: 9, color: '#46443D', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {Math.round(displayHype).toLocaleString('en-US')} HYPE
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        {deltaUsd !== null ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: dColor, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {isLiveDelta ? '~' : ''}{fmtUSD(deltaUsd, true)}
            </div>
            {deltaHypeDisplay !== null && (
              <div style={{ fontSize: 9, color: up ? '#1a7a5e' : '#a02a1e', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {up ? '+' : ''}{Math.round(Math.abs(deltaHypeDisplay)).toLocaleString('en-US')} HYPE
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 15, color: '#2C2C2A', fontFamily: MONO }}>—</div>
        )}
      </div>
    </div>
  )
}
