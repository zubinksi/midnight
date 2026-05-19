import { NextRequest, NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

// BHYP custody wallets published at bhypetf.com
const BHYP_WALLETS = [
  '0x6183AeCb22b09b4CB167F2B42C611243C7E74318',
  '0x4C7eA3E9b0E7f0f2aB0D60c22b6D12fF81C09899',
]

export interface ETFFlowsData {
  bhyp: {
    current: number    // real-time HYPE from chain (spot + staked)
    prevClose: number  // previous day official figure from ETF website
    prevAsOf: string   // "MM/DD/YYYY"
  }
  thyp: {
    current: number
    prevClose: number
    prevAsOf: string
  } | null
  ts: number
}

let cache: { data: ETFFlowsData; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function hlPost<T>(body: unknown): Promise<T> {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`hl ${res.status}`)
  return res.json() as Promise<T>
}

interface SpotBalance { coin: string; token: number; total: string }
interface SpotState { balances: SpotBalance[] }

async function getWalletHype(address: string): Promise<{ spot: number; staked: number; rawSpot: SpotBalance[]; rawStaking: unknown }> {
  const [spotRes, stakingRes] = await Promise.allSettled([
    hlPost<SpotState>({ type: 'spotClearinghouseState', user: address }),
    hlPost<Record<string, string>>({ type: 'delegatorSummary', delegator: address }),
  ])

  const rawSpot = spotRes.status === 'fulfilled' ? (spotRes.value.balances ?? []) : []
  const rawStaking = stakingRes.status === 'fulfilled' ? stakingRes.value : stakingRes.reason?.message ?? 'failed'

  // HYPE may appear as "HYPE" or by token index 150
  const hypeBalance = rawSpot.find(b => b.coin === 'HYPE' || b.token === 150)
  const spot = hypeBalance ? parseFloat(hypeBalance.total) : 0

  const staking = stakingRes.status === 'fulfilled'
    ? parseFloat(stakingRes.value.delegated ?? '0') + parseFloat(stakingRes.value.undelegating ?? '0')
    : 0

  return { spot, staked: staking, rawSpot, rawStaking }
}

async function scrapeBHYP(): Promise<{ hype: number; asOf: string; rawHtml: string }> {
  try {
    const res = await fetch('https://bhypetf.com/', { headers: BROWSER_HEADERS, next: { revalidate: 0 } })
    if (!res.ok) return { hype: 0, asOf: '', rawHtml: `HTTP ${res.status}` }
    const html = await res.text()
    const holdingsMatch = html.match(/Hy+perliquid in Trust[\s\S]{0,300}?([\d,]+\.\d+)/i)
    const dateMatch     = html.match(/Data as of[^<]*?(\d{2}\/\d{2}\/\d{4})/i)
    return {
      hype:    holdingsMatch ? parseFloat(holdingsMatch[1].replace(/,/g, '')) : 0,
      asOf:    dateMatch ? dateMatch[1] : '',
      rawHtml: html.slice(0, 3000),
    }
  } catch (e) {
    return { hype: 0, asOf: '', rawHtml: String(e) }
  }
}

async function scrapeTHYP(): Promise<{ hype: number; asOf: string; rawHtml: string }> {
  try {
    const res = await fetch('https://www.21shares.com/en-us/products-us/thyp', {
      headers: { ...BROWSER_HEADERS, 'Referer': 'https://www.21shares.com/' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return { hype: 0, asOf: '', rawHtml: `HTTP ${res.status}` }
    const html = await res.text()

    // "COIN ENTITLEMENT ... 312513.1653" — may appear in HTML or __NEXT_DATA__
    let hype = 0
    let asOf = ''

    // Try plain HTML pattern first
    const coinEntMatch = html.match(/COIN\s+ENTITLEMENT[\s\S]{0,300}?([\d,]+\.\d{2,})/i)
    if (coinEntMatch) hype = parseFloat(coinEntMatch[1].replace(/,/g, ''))

    // Try __NEXT_DATA__ JSON
    if (hype === 0) {
      const ndMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
      if (ndMatch) {
        try {
          const nd = JSON.parse(ndMatch[1])
          const str = JSON.stringify(nd)
          // Look for coinEntitlement key or a number near "HYPE"
          const m = str.match(/"coinEntitlement"\s*:\s*"?([\d.]+)"?/)
            ?? str.match(/"entitlement"\s*:\s*"?([\d.]+)"?/)
          if (m) hype = parseFloat(m[1])
        } catch {}
      }
    }

    const dateMatch = html.match(/As of\s+([A-Z][a-z]+ \d{1,2},?\s*\d{4})/i)
    if (dateMatch) asOf = dateMatch[1]

    return { hype, asOf, rawHtml: html.slice(0, 3000) }
  } catch (e) {
    return { hype: 0, asOf: '', rawHtml: String(e) }
  }
}

export async function GET(req: NextRequest) {
  // ?debug — returns raw API responses to diagnose data issues
  if (new URL(req.url).searchParams.has('debug')) {
    const [w1, w2, bhyp, thyp] = await Promise.allSettled([
      getWalletHype(BHYP_WALLETS[0]),
      getWalletHype(BHYP_WALLETS[1]),
      scrapeBHYP(),
      scrapeTHYP(),
    ])
    return NextResponse.json({
      wallet1: w1.status === 'fulfilled' ? w1.value : { error: String((w1 as PromiseRejectedResult).reason) },
      wallet2: w2.status === 'fulfilled' ? w2.value : { error: String((w2 as PromiseRejectedResult).reason) },
      bhypScrape: bhyp.status === 'fulfilled' ? bhyp.value : { error: String((bhyp as PromiseRejectedResult).reason) },
      thypScrape: thyp.status === 'fulfilled' ? thyp.value : { error: String((thyp as PromiseRejectedResult).reason) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  const [w1, w2, bhypScrape, thypScrape] = await Promise.allSettled([
    getWalletHype(BHYP_WALLETS[0]),
    getWalletHype(BHYP_WALLETS[1]),
    scrapeBHYP(),
    scrapeTHYP(),
  ])

  const w1data = w1.status === 'fulfilled' ? w1.value : { spot: 0, staked: 0 }
  const w2data = w2.status === 'fulfilled' ? w2.value : { spot: 0, staked: 0 }
  const bhypCurrent = (w1data.spot + w1data.staked) + (w2data.spot + w2data.staked)

  const { hype: bhypPrev, asOf: bhypAsOf } =
    bhypScrape.status === 'fulfilled' ? bhypScrape.value : { hype: 0, asOf: '' }

  const { hype: thypCurrent, asOf: thypAsOf } =
    thypScrape.status === 'fulfilled' ? thypScrape.value : { hype: 0, asOf: '' }

  const data: ETFFlowsData = {
    bhyp: { current: bhypCurrent, prevClose: bhypPrev, prevAsOf: bhypAsOf },
    thyp: thypCurrent > 0 ? { current: thypCurrent, prevClose: 0, prevAsOf: thypAsOf } : null,
    ts: Date.now(),
  }

  cache = { data, ts: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
