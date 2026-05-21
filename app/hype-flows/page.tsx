'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { LivelineSeries } from 'liveline'
import type { HypeFlowsData, HypeStratTransaction, AssistFundDailyBuy } from '@/app/api/hype-flows/route'
import type { ETFFlowsData, DailyRow } from '@/app/api/etf-flows/route'
import type { InflowBarPoint } from '@/components/ETFInflowsBarChart'
import ETFInflowsBarChart from '@/components/ETFInflowsBarChart'
import { useAssetPrice } from '@/lib/hyperliquid'

const LivelineChart = dynamic(() => import('liveline').then(m => m.Liveline), { ssr: false })

const MONO   = 'Inter,sans-serif'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const COLORS = {
  cream:     '#F0EDE6',
  thyp:      '#26ab83',
  bhyp:      '#F0C84A',
  strat:     '#7B8CE8',
  assist:    '#E87B4A',
  dim:       '#46443D',
  dimmer:    '#2C2C2A',
  border:    '#1C1C1A',
  card:      '#0F0F0D',
  bg:        '#080807',
}

type Tab = 'etf' | 'strat' | 'assist'

function fmtUSD(usd: number, sign = false) {
  const s = sign && usd >= 0 ? '+' : usd < 0 ? '-' : ''
  const abs = Math.abs(usd)
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${s}$${(abs / 1_000).toFixed(0)}K`
  return `${s}$${abs.toFixed(0)}`
}

function fmtHYPE(h: number, sign = false) {
  const s = sign && h >= 0 ? '+' : h < 0 ? '-' : ''
  const abs = Math.abs(h)
  if (abs >= 1_000_000) return `${s}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${s}${(abs / 1_000).toFixed(0)}K`
  return `${s}${Math.round(abs).toLocaleString()}`
}

function fmtTime(t: number) {
  const d = new Date(t * 1000)
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate()
}

function fmtDate(t: number) {
  const d = new Date(t * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// ─── Summary card ────────────────────────────────────────────────────────────

function SummaryCard({ flows, livePrice }: { flows: HypeFlowsData; livePrice: number }) {
  const hp     = livePrice || flows.hypePrice
  const etfH   = flows.etf ? (flows.etf.bhyp.current + (flows.etf.thyp?.current ?? 0)) : 0
  const stratH = flows.hypestrat.totalHype
  const assistH= flows.assistFund.totalHype
  const total  = flows.summary.totalHype
  const COL    = { fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }
  const VAL    = { fontSize: 13, fontWeight: 700 as const, color: COLORS.cream, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' as const }
  const SUB    = { fontSize: 9, color: COLORS.dim, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' as const, marginTop: 2 }

  const rows: { label: string; color: string; hype: number }[] = [
    { label: 'ETFs',        color: COLORS.cream,  hype: etfH    },
    { label: 'HYPE STRAT',  color: COLORS.strat,  hype: stratH  },
    { label: 'ASSIST FUND', color: COLORS.assist, hype: assistH },
  ]

  return (
    <div style={{ margin: '20px 16px 0', background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: '16px 16px 12px' }}>
      {/* Totals row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 8, marginBottom: 14 }}>
        <div>
          <div style={COL}>TOTAL HYPE</div>
          <div style={{ ...VAL, marginTop: 4 }}>{total > 0 ? fmtHYPE(total) : '—'}</div>
          <div style={SUB}>{total > 0 ? fmtUSD(total * hp) : ''}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={COL}>% SUPPLY</div>
          <div style={{ ...VAL, marginTop: 4 }}>{flows.summary.floatPct > 0 ? flows.summary.floatPct.toFixed(1) + '%' : '—'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={COL}>30-DAY NET</div>
          <div style={{ ...VAL, marginTop: 4, color: flows.summary.hype30dChange >= 0 ? COLORS.thyp : '#E84332' }}>
            {flows.summary.hype30dChange !== 0 ? fmtHYPE(flows.summary.hype30dChange, true) : '—'}
          </div>
          <div style={SUB}>HYPE</div>
        </div>
      </div>

      {/* Per-source breakdown */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }}>{r.label}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 11, color: COLORS.cream, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                {r.hype > 0 ? fmtHYPE(r.hype) : '—'}
              </span>
              {r.hype > 0 && hp > 0 && (
                <span style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', marginLeft: 8 }}>
                  {fmtUSD(r.hype * hp)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'etf',    label: 'ETFs'        },
    { id: 'strat',  label: 'HYPE STRAT'  },
    { id: 'assist', label: 'ASSIST FUND' },
  ]
  return (
    <div style={{ display: 'flex', gap: 6, padding: '16px 16px 0' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            background:    tab === t.id ? '#1A1A18' : 'none',
            border:        `1px solid ${tab === t.id ? '#2C2C2A' : 'transparent'}`,
            borderRadius:  8,
            padding:       '6px 10px',
            fontSize:      9,
            color:         tab === t.id ? COLORS.cream : COLORS.dim,
            fontFamily:    MONO,
            letterSpacing: '0.08em',
            cursor:        'pointer',
            flexShrink:    0,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── ETF tab ─────────────────────────────────────────────────────────────────

const HISTORY_PAGE_SIZE = 7
const ET_OFFSET = -4 * 3600

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
  const dColor           = up ? COLORS.thyp : '#E84332'
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 8 }
  return (
    <div style={{ ...grid, alignItems: 'start', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 2 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.cream, fontFamily: MONO }}>{label}</div>
          <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }}>{issuer}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: displayUsd > 0 ? COLORS.cream : COLORS.dimmer, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
          {displayUsd > 0 ? fmtUSD(displayUsd) : '—'}
        </div>
        {displayHype > 0 && (
          <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
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
          <div style={{ fontSize: 15, color: COLORS.dimmer, fontFamily: MONO }}>—</div>
        )}
      </div>
    </div>
  )
}

function ETFDailyHistoryTable({ rows, circulatingSupply }: { rows: DailyRow[]; circulatingSupply: number }) {
  const [expanded, setExpanded] = useState(false)
  const todayMidnight = Math.floor((Date.now() / 1000 + ET_OFFSET) / 86400) * 86400
  const COL  = { fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }
  const CELL = { fontSize: 11, color: '#8A8880', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' as const }
  const sorted  = [...rows].reverse()
  const visible = expanded ? sorted : sorted.slice(0, HISTORY_PAGE_SIZE)
  const hasMore = sorted.length > HISTORY_PAGE_SIZE
  return (
    <div style={{ marginTop: 16, padding: '16px 24px 0' }}>
      <div style={{ fontSize: 10, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.1em', marginBottom: 12 }}>DAILY HISTORY</div>
      <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 1fr 1fr 52px', columnGap: 8, marginBottom: 6 }}>
        <div style={COL}>DATE</div>
        <div style={{ ...COL, textAlign: 'right' }}>AUM</div>
        <div style={{ ...COL, textAlign: 'right' }}>INFLOWS</div>
        <div style={{ ...COL, textAlign: 'right' }}>VOLUME</div>
        <div style={{ ...COL, textAlign: 'right' }}>% FLOAT</div>
      </div>
      {visible.map(row => {
        const totalInflow = (row.bhypInflow ?? 0) + (row.thypInflow ?? 0)
        const totalVolume = (row.bhypVolume ?? 0) + (row.thypVolume ?? 0)
        const hasInflow   = row.bhypInflow != null || row.thypInflow != null
        const hasVolume   = row.bhypVolume != null || row.thypVolume != null
        const isToday     = row.time === todayMidnight && hasInflow
        const floatPct    = hasInflow && circulatingSupply > 0 && row.hypePrice && row.hypePrice > 0
          ? (totalInflow / row.hypePrice / circulatingSupply * 100).toFixed(2) + '%' : '—'
        const EST = { fontStyle: 'italic' as const, color: '#6A6860' }
        return (
          <div key={row.time} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 1fr 1fr 52px', columnGap: 8, paddingBottom: 10 }}>
            <div style={{ ...CELL, color: COLORS.cream, ...(isToday ? EST : {}) }}>{fmtTime(row.time)}</div>
            <div style={{ ...CELL, textAlign: 'right', ...(isToday ? EST : {}) }}>{row.totalAum > 0 ? fmtUSD(row.totalAum) : '—'}</div>
            <div style={{ ...CELL, textAlign: 'right', color: hasInflow ? (isToday ? EST.color : COLORS.cream) : COLORS.dim, ...(isToday ? { fontStyle: 'italic' } : {}) }}>
              {hasInflow ? `${isToday ? '~' : ''}${fmtUSD(totalInflow, true)}` : '—'}
            </div>
            <div style={{ ...CELL, textAlign: 'right', ...(isToday ? EST : {}) }}>{hasVolume ? fmtUSD(totalVolume) : '—'}</div>
            <div style={{ ...CELL, textAlign: 'right', ...(isToday ? EST : {}) }}>{floatPct}</div>
          </div>
        )
      })}
      {hasMore && (
        <button onClick={() => setExpanded(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em', padding: '4px 0 12px' }}>
          {expanded ? 'SHOW LESS' : `SHOW ALL ${sorted.length} DAYS`}
        </button>
      )}
    </div>
  )
}

function ETFTab({ etf, livePrice, mounted }: { etf: ETFFlowsData; livePrice: number; mounted: boolean }) {
  const [hoveredInflow, setHoveredInflow] = useState<InflowBarPoint | null>(null)
  const ETF_COLORS = { total: COLORS.cream, thyp: COLORS.thyp, bhyp: COLORS.bhyp }

  const bhyp      = etf.bhyp
  const thyp      = etf.thyp
  const bhypToday = bhyp.today ?? null
  const thypToday = thyp?.today ?? null
  const bhypHype  = bhyp.current ?? 0
  const thypHype  = thyp?.current ?? 0
  const bhypDeltaH = (bhyp.prevClose ?? 0) > 0 ? bhypHype - (bhyp.prevClose ?? 0) : null
  const thypDeltaH = (thyp?.prevClose ?? 0) > 0 ? thypHype - (thyp?.prevClose ?? 0) : null

  const thypHistory = thyp?.history ?? []
  const bhypHistory = bhyp.history ?? []
  const timeSet    = new Set([...thypHistory.map(p => p.time), ...bhypHistory.map(p => p.time)])
  const times      = [...timeSet].sort((a, b) => a - b)
  const thypByTime = Object.fromEntries(thypHistory.map(p => [p.time, p]))
  const bhypByTime = Object.fromEntries(bhypHistory.map(p => [p.time, p]))

  let lastThypUsd = 0, lastBhypUsd = 0
  const thypAumSeries: { time: number; value: number }[] = []
  const bhypAumSeries: { time: number; value: number }[] = []
  const totalAumSeries: { time: number; value: number }[] = []
  for (const t of times) {
    if (thypByTime[t]) lastThypUsd = thypByTime[t].usd
    if (bhypByTime[t]) lastBhypUsd = bhypByTime[t].usd
    thypAumSeries.push({ time: t, value: lastThypUsd })
    bhypAumSeries.push({ time: t, value: lastBhypUsd })
    totalAumSeries.push({ time: t, value: lastThypUsd + lastBhypUsd })
  }

  const hasBhypHistory = bhypHistory.length > 0
  const aumSeries: LivelineSeries[] | undefined = hasBhypHistory ? [
    { id: 'total', data: totalAumSeries, value: totalAumSeries.at(-1)?.value ?? 0, color: ETF_COLORS.total, label: 'TOTAL' },
    { id: 'thyp',  data: thypAumSeries,  value: thypAumSeries.at(-1)?.value  ?? 0, color: ETF_COLORS.thyp,  label: 'THYP'  },
    { id: 'bhyp',  data: bhypAumSeries,  value: bhypAumSeries.at(-1)?.value  ?? 0, color: ETF_COLORS.bhyp,  label: 'BHYP'  },
  ] : undefined
  const aumData  = hasBhypHistory ? totalAumSeries : thypAumSeries
  const aumColor = hasBhypHistory ? ETF_COLORS.total : ETF_COLORS.thyp
  const aumLabel = hasBhypHistory ? 'TOTAL AUM' : 'THYP AUM'
  const hasAumChart = aumData.length >= 2
  const chartWindow = hasAumChart ? Math.ceil((aumData.at(-1)!.time - aumData[0].time) * 1.05) + 86400 : undefined

  const bhypInflowHistory = bhyp.inflowHistory ?? []
  const thypInflowHistory = thyp?.inflowHistory ?? []
  const bhypInflowByTime  = Object.fromEntries(bhypInflowHistory.map(p => [p.time, p.usd]))
  const thypInflowByTime  = Object.fromEntries(thypInflowHistory.map(p => [p.time, p.usd]))
  const hasFarsideData    = bhypInflowHistory.length > 0 || thypInflowHistory.length > 0

  const inflowBarData: InflowBarPoint[] = hasFarsideData
    ? (() => {
        const ts = [...new Set([...bhypInflowHistory.map(p => p.time), ...thypInflowHistory.map(p => p.time)])].sort((a, b) => a - b)
        return ts.map(t => {
          const bi = bhypInflowByTime[t] ?? 0
          const ti = thypInflowByTime[t] ?? 0
          return { time: t, total: bi + ti, bhyp: bi, thyp: ti }
        })
      })()
    : thypHistory.slice(1).map((p, i) => {
        const prev = thypHistory[i]
        const ti = (p.units - prev.units) * p.navPerShare
        return { time: p.time, total: ti, bhyp: 0, thyp: ti }
      })

  const totalLiveAum    = (bhypToday?.aum ?? 0) + (thypToday?.aum ?? 0) > 0
    ? (bhypToday?.aum ?? 0) + (thypToday?.aum ?? 0) : null
  const totalLiveInflow = bhypToday?.inflowUsd != null || thypToday?.inflowUsd != null
    ? (bhypToday?.inflowUsd ?? 0) + (thypToday?.inflowUsd ?? 0) : null

  return (
    <>
      {/* Top table */}
      <div style={{ margin: '16px 16px 0' }}>
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: '16px 16px 4px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }}>ETFs</div>
            <div style={{ textAlign: 'right', fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }}>AUM</div>
            <div style={{ textAlign: 'right', fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }}>DAILY EST.</div>
          </div>
          {(bhypHype + thypHype) > 0 && (
            <ETFTableRow label="TOTAL" issuer="" color={ETF_COLORS.total}
              usd={(bhypHype + thypHype) * livePrice} hype={bhypHype + thypHype}
              deltaHype={bhypDeltaH !== null || thypDeltaH !== null ? (bhypDeltaH ?? 0) + (thypDeltaH ?? 0) : null}
              currentPrice={livePrice} liveAum={totalLiveAum} liveInflowUsd={totalLiveInflow} />
          )}
          <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 12 }}>
            <ETFTableRow label="BHYP" issuer="BITWISE"  color={ETF_COLORS.bhyp}
              usd={bhypHype * livePrice} hype={bhypHype} deltaHype={bhypDeltaH} currentPrice={livePrice}
              liveAum={bhypToday?.aum} liveInflowUsd={bhypToday?.inflowUsd} />
            <ETFTableRow label="THYP" issuer="21SHARES" color={ETF_COLORS.thyp}
              usd={thypHype * livePrice} hype={thypHype} deltaHype={thypDeltaH} currentPrice={livePrice}
              liveAum={thypToday?.aum} liveInflowUsd={thypToday?.inflowUsd} />
          </div>
        </div>
      </div>

      {/* Daily history table */}
      {etf.dailyHistory?.length > 0 && (
        <ETFDailyHistoryTable rows={etf.dailyHistory} circulatingSupply={etf.circulatingSupply} />
      )}

      {/* Daily inflows chart */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 16 }}>
        <div style={{ padding: '16px 24px 0', display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 10, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.1em', flexShrink: 0 }}>DAILY INFLOWS</span>
          {hoveredInflow && (
            <span style={{ fontSize: 10, color: (hoveredInflow.total ?? 0) >= 0 ? COLORS.cream : '#E84332', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {fmtUSD(hoveredInflow.total, true)}
            </span>
          )}
        </div>
        {inflowBarData.length > 0
          ? <div style={{ padding: '0 24px' }}><ETFInflowsBarChart data={inflowBarData} onHover={setHoveredInflow} /></div>
          : <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, color: COLORS.dimmer, fontFamily: MONO }}>NO HISTORY</span>
            </div>
        }
      </div>

      {/* AUM chart */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 16 }}>
        <div style={{ padding: '16px 24px 8px' }}>
          <span style={{ fontSize: 10, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.1em' }}>{aumLabel}</span>
        </div>
        {hasAumChart && mounted ? (
          <div className={aumSeries ? 'll-wrap' : undefined}>
            <LivelineChart data={aumData} value={aumData.at(-1)?.value ?? 0} color={aumColor}
              series={aumSeries} theme="dark" scrub grid lineWidth={1.5} window={chartWindow}
              formatValue={v => fmtUSD(v)} formatTime={fmtTime}
              padding={{ left: 24 }} style={{ width: '100%', height: 180 }} />
          </div>
        ) : (
          <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, color: COLORS.dimmer, fontFamily: MONO }}>{mounted ? 'NO HISTORY' : ''}</span>
          </div>
        )}
      </div>
    </>
  )
}

// ─── HYPE STRAT tab ──────────────────────────────────────────────────────────

function buildStepSeries(txns: HypeStratTransaction[], nowSec: number) {
  if (txns.length === 0) return []
  const pts: { time: number; value: number }[] = []
  pts.push({ time: txns[0].time - 86400, value: 0 })
  for (let i = 0; i < txns.length; i++) {
    pts.push({ time: txns[i].time, value: txns[i].balance })
    if (i + 1 < txns.length) pts.push({ time: txns[i + 1].time - 1, value: txns[i].balance })
  }
  pts.push({ time: nowSec, value: txns.at(-1)!.balance })
  return pts
}

function HypeStratTab({ txns, totalHype, hypePrice, mounted }: {
  txns: HypeStratTransaction[]; totalHype: number; hypePrice: number; mounted: boolean
}) {
  const COL  = { fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em' }
  const CELL = { fontSize: 11, color: '#8A8880', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' as const }
  const nowSec = Math.floor(Date.now() / 1000)
  const stepData = buildStepSeries(txns, nowSec)
  const chartWindow = stepData.length >= 2
    ? Math.ceil((stepData.at(-1)!.time - stepData[0].time) * 1.05) + 86400 * 7
    : undefined

  return (
    <>
      {/* Summary */}
      <div style={{ margin: '16px 16px 0', background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
          <div>
            <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em', marginBottom: 4 }}>HYPE HELD</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.cream, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {totalHype > 0 ? fmtHYPE(totalHype) : '—'}
            </div>
            {totalHype > 0 && hypePrice > 0 && (
              <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {fmtUSD(totalHype * hypePrice)}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em', marginBottom: 4 }}>AVG COST</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.cream, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {txns.length > 0 && txns.at(-1)!.avgCost != null ? `$${txns.at(-1)!.avgCost}` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Transaction table */}
      <div style={{ marginTop: 16, padding: '0 24px' }}>
        <div style={{ fontSize: 10, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.1em', marginBottom: 12 }}>TRANSACTIONS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr 1fr 1fr', columnGap: 8, marginBottom: 6 }}>
          <div style={COL}>DATE</div>
          <div style={{ ...COL, textAlign: 'right' }}>ACQUIRED</div>
          <div style={{ ...COL, textAlign: 'right' }}>BALANCE</div>
          <div style={{ ...COL, textAlign: 'right' }}>USD PAID</div>
        </div>
        {[...txns].reverse().map(tx => (
          <div key={tx.time} style={{ display: 'grid', gridTemplateColumns: '76px 1fr 1fr 1fr', columnGap: 8, paddingBottom: 10 }}>
            <div style={{ ...CELL, color: COLORS.cream }}>{fmtDate(tx.time)}</div>
            <div style={{ ...CELL, textAlign: 'right', color: COLORS.thyp }}>+{fmtHYPE(tx.netChange)}</div>
            <div style={{ ...CELL, textAlign: 'right' }}>{fmtHYPE(tx.balance)}</div>
            <div style={{ ...CELL, textAlign: 'right' }}>
              {tx.usdValue != null ? fmtUSD(tx.usdValue) : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Cumulative holdings chart */}
      {stepData.length >= 2 && (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 16 }}>
          <div style={{ padding: '16px 24px 8px' }}>
            <span style={{ fontSize: 10, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.1em' }}>CUMULATIVE HYPE HELD</span>
          </div>
          {mounted ? (
            <LivelineChart
              data={stepData}
              value={stepData.at(-1)?.value ?? 0}
              color={COLORS.strat}
              theme="dark" scrub grid lineWidth={1.5}
              window={chartWindow}
              formatValue={v => `${fmtHYPE(v)} HYPE`}
              formatTime={t => {
                const d = new Date(t * 1000)
                return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
              }}
              padding={{ left: 24 }}
              style={{ width: '100%', height: 180 }}
            />
          ) : (
            <div style={{ height: 180 }} />
          )}
        </div>
      )}
    </>
  )
}

// ─── Assist Fund tab ──────────────────────────────────────────────────────────

function AssistFundBarChart({ data, onHover }: {
  data: AssistFundDailyBuy[]
  onHover?: (point: AssistFundDailyBuy | null) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const recent = data.slice(-30)
  if (recent.length === 0) return null
  const maxHype = Math.max(...recent.map(d => d.hype), 1)
  const PAD_B = 24, PAD_R = 48, H = 160
  const chartH = H - PAD_B
  const groupW = (400 - PAD_R) / recent.length
  const barW   = Math.max(groupW * 0.6, 2)

  function handleEnter(i: number) {
    setHovered(i)
    onHover?.(recent[i])
  }
  function handleLeave() {
    setHovered(null)
    onHover?.(null)
  }

  return (
    <svg width="100%" viewBox={`0 0 ${400} ${H}`} preserveAspectRatio="none"
      style={{ display: 'block', cursor: 'crosshair' }} onMouseLeave={handleLeave}>
      {recent.map((d, i) => {
        const x  = i * groupW
        const bH = (d.hype / maxHype) * (chartH - 4)
        const y  = chartH - bH
        return (
          <g key={d.time} onMouseEnter={() => handleEnter(i)}>
            <rect x={x} y={0} width={groupW} height={chartH} fill="transparent" />
            <rect x={x + (groupW - barW) / 2} y={y} width={barW} height={bH}
              fill={COLORS.assist} opacity={hovered === i ? 1 : 0.8} rx={1} />
          </g>
        )
      })}
      <text x={400 - PAD_R + 4} y={12} fontSize={8} fill={COLORS.dimmer} fontFamily={MONO}>
        {fmtHYPE(maxHype)}
      </text>
      <text x={0} y={H - 4} fontSize={8} fill={COLORS.dimmer} fontFamily={MONO}>{fmtTime(recent[0].time)}</text>
      <text x={400 - PAD_R} y={H - 4} fontSize={8} fill={COLORS.dimmer} fontFamily={MONO} textAnchor="end">{fmtTime(recent.at(-1)!.time)}</text>
    </svg>
  )
}

function AssistFundTab({ totalHype, dailyBuys, hypePrice }: {
  totalHype: number; dailyBuys: AssistFundDailyBuy[]; hypePrice: number
}) {
  const [hoveredBuy, setHoveredBuy] = useState<AssistFundDailyBuy | null>(null)
  const total30d = dailyBuys
    .filter(d => d.time >= Math.floor(Date.now() / 1000) - 30 * 86400)
    .reduce((s, d) => s + d.hype, 0)

  return (
    <>
      {/* Summary */}
      <div style={{ margin: '16px 16px 0', background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
          <div>
            <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em', marginBottom: 4 }}>HYPE HELD</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.cream, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {totalHype > 0 ? fmtHYPE(totalHype) : '—'}
            </div>
            {totalHype > 0 && hypePrice > 0 && (
              <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {fmtUSD(totalHype * hypePrice)}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.06em', marginBottom: 4 }}>30-DAY BUYS</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: total30d > 0 ? COLORS.assist : COLORS.dimmer, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {total30d > 0 ? `+${fmtHYPE(total30d)}` : '—'}
            </div>
            {total30d > 0 && <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: MONO, marginTop: 2 }}>HYPE</div>}
          </div>
        </div>
      </div>

      {/* Daily buys chart */}
      {dailyBuys.length > 0 ? (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 16 }}>
          <div style={{ padding: '16px 24px 0', display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 10, color: COLORS.dim, fontFamily: MONO, letterSpacing: '0.1em', flexShrink: 0 }}>DAILY HYPE BUYS</span>
            {hoveredBuy && (
              <span style={{ fontSize: 10, color: COLORS.assist, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                +{fmtHYPE(hoveredBuy.hype)} HYPE
              </span>
            )}
          </div>
          <div style={{ padding: '0 24px' }}>
            <AssistFundBarChart data={dailyBuys} onHover={setHoveredBuy} />
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 24, padding: '0 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: COLORS.dimmer, fontFamily: MONO, lineHeight: 1.8, letterSpacing: '0.06em' }}>
            TRANSACTION HISTORY UNAVAILABLE
          </div>
          <div style={{ fontSize: 9, color: '#1E1E1C', fontFamily: MONO, lineHeight: 1.8, marginTop: 4 }}>
            Balance sourced from on-chain state
          </div>
        </div>
      )}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HypeFlowsPage() {
  const router = useRouter()
  const [flows, setFlows]   = useState<HypeFlowsData | null>(null)
  const [tab, setTab]       = useState<Tab>('etf')
  const [mounted, setMounted] = useState(false)
  const livePrice = useAssetPrice('HYPE', 5000)
  const hp = livePrice ?? flows?.hypePrice ?? 0

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    fetch('/api/hype-flows')
      .then(r => r.json() as Promise<HypeFlowsData>)
      .then(setFlows)
      .catch(() => {})
  }, [])

  return (
    <div style={{ background: COLORS.bg, minHeight: '100dvh' }}>
      <div style={{ maxWidth: 430, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ padding: 'calc(env(safe-area-inset-top) + 60px) 24px 0' }}>
          <button
            onClick={() => {
              if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
                router.back()
              } else {
                router.push('/')
              }
            }}
            style={{ background: 'none', border: 'none', color: COLORS.dim, cursor: 'pointer', padding: '4px 0', lineHeight: 1, display: 'flex', alignItems: 'center' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="12,4 6,10 12,16" />
            </svg>
          </button>
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.cream, fontFamily: MONO, letterSpacing: '0.08em', marginTop: 8 }}>HYPE FLOWS</div>
        </div>

        {/* Summary card — always visible */}
        {flows && <SummaryCard flows={flows} livePrice={hp} />}

        {/* Tab bar */}
        <TabBar tab={tab} onChange={setTab} />

        {/* Tab content */}
        {flows ? (
          <>
            {tab === 'etf' && flows.etf && (
              <ETFTab etf={flows.etf} livePrice={hp} mounted={mounted} />
            )}
            {tab === 'strat' && (
              <HypeStratTab
                txns={flows.hypestrat.transactions}
                totalHype={flows.hypestrat.totalHype}
                hypePrice={hp}
                mounted={mounted}
              />
            )}
            {tab === 'assist' && (
              <AssistFundTab
                totalHype={flows.assistFund.totalHype}
                dailyBuys={flows.assistFund.dailyBuys}
                hypePrice={hp}
              />
            )}
          </>
        ) : (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, color: COLORS.dimmer, fontFamily: MONO }}>{mounted ? 'LOADING...' : ''}</span>
          </div>
        )}

        <div style={{ height: 'max(env(safe-area-inset-bottom), 40px)' }} />
      </div>
    </div>
  )
}
