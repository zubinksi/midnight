import { NextResponse } from 'next/server'

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
  thyp: null           // wallet addresses not yet public
  ts: number
}

let cache: { data: ETFFlowsData; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

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

interface SpotBalance { coin: string; total: string }
interface SpotState { balances: SpotBalance[] }
interface DelegatorSummary { delegated: string; undelegating: string }

async function getWalletHype(address: string): Promise<number> {
  const [spot, staking] = await Promise.allSettled([
    hlPost<SpotState>({ type: 'spotClearinghouseState', user: address }),
    hlPost<DelegatorSummary>({ type: 'delegatorSummary', delegator: address }),
  ])
  const spotHype = spot.status === 'fulfilled'
    ? parseFloat(spot.value.balances.find(b => b.coin === 'HYPE')?.total ?? '0')
    : 0
  const stakedHype = staking.status === 'fulfilled'
    ? parseFloat(staking.value.delegated ?? '0') + parseFloat(staking.value.undelegating ?? '0')
    : 0
  return spotHype + stakedHype
}

async function scrapeBHYP(): Promise<{ hype: number; asOf: string }> {
  try {
    const res = await fetch('https://bhypetf.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      next: { revalidate: 0 },
    })
    if (!res.ok) return { hype: 0, asOf: '' }
    const html = await res.text()
    // "Hyyperliquid in Trust  95,319.78"
    const holdingsMatch = html.match(/Hy+perliquid in Trust[\s\S]{0,300}?([\d,]+\.\d+)/i)
    const dateMatch     = html.match(/Data as of[^<]*?(\d{2}\/\d{2}\/\d{4})/i)
    return {
      hype:  holdingsMatch ? parseFloat(holdingsMatch[1].replace(/,/g, '')) : 0,
      asOf:  dateMatch ? dateMatch[1] : '',
    }
  } catch {
    return { hype: 0, asOf: '' }
  }
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  const [w1, w2, bhypScrape] = await Promise.allSettled([
    getWalletHype(BHYP_WALLETS[0]),
    getWalletHype(BHYP_WALLETS[1]),
    scrapeBHYP(),
  ])

  const bhypCurrent =
    (w1.status === 'fulfilled' ? w1.value : 0) +
    (w2.status === 'fulfilled' ? w2.value : 0)
  const { hype: bhypPrev, asOf: bhypAsOf } =
    bhypScrape.status === 'fulfilled' ? bhypScrape.value : { hype: 0, asOf: '' }

  const data: ETFFlowsData = {
    bhyp: { current: bhypCurrent, prevClose: bhypPrev, prevAsOf: bhypAsOf },
    thyp: null,
    ts: Date.now(),
  }

  cache = { data, ts: Date.now() }
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
