#!/usr/bin/env node
// Scrapes Hyperliquid Strategies transaction history from CoinGecko and stores
// it in Upstash Redis. Runs as a GitHub Actions cron job weekly.
//
// CoinGecko blocks datacenter IPs and doesn't have a public API for this data.
// Set SCRAPER_API_KEY to route through ScraperAPI residential IPs (render=true
// for JS-rendered pages).
//
// The hardcoded baseline in app/api/hype-flows/route.ts always acts as fallback,
// so this script only needs to detect NEW transactions beyond that baseline.

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, SCRAPER_API_KEY } = process.env

if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN')
  process.exit(1)
}

if (!SCRAPER_API_KEY) {
  console.error('Missing SCRAPER_API_KEY')
  process.exit(1)
}

// Known transactions hardcoded in the API route — we skip these to avoid storing
// redundant data (the API route merges KV with the hardcoded baseline).
const BASELINE_TIMES = new Set([
  1733097600, // 2025-12-02
  1739232000, // 2026-02-11
])

function parseHtmlTransactions(html) {
  const rows = []
  // Look for date patterns like 2026-02-11 or 2025-12-02 near numeric HYPE balances
  // The CoinGecko treasury table has columns: Date, HYPE Balance, Net Change, Transaction Value, Avg Cost
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = []
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let tdMatch
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
    }
    if (cells.length < 3) continue
    const dateMatch = cells[0]?.match(/(\d{4}-\d{2}-\d{2})/)
    if (!dateMatch) continue
    const time = Math.floor(new Date(dateMatch[1] + 'T00:00:00Z').getTime() / 1000)
    if (isNaN(time)) continue

    const parseNum = (s) => {
      if (!s || s === '-') return null
      const clean = s.replace(/[$,+\s]/g, '').replace(/M$/i, '000000').replace(/K$/i, '000')
      const n = parseFloat(clean)
      return isNaN(n) ? null : n
    }

    const balance   = parseNum(cells[1])
    const netChange = parseNum(cells[2])
    if (!balance || !netChange) continue

    // USD value may be in cells[3], avg cost in cells[4]
    const usdRaw = parseNum(cells[3])
    const avgRaw = parseNum(cells[4])
    // CoinGecko shows USD in millions (e.g. "$129.5M") — parseNum handles M suffix above
    // but the raw display is like "$129.5M" so we multiply by 1_000_000 if not already done
    // Actually parseNum replaces M with 000000 so $129.5M → 129.5000000 which is wrong.
    // Let's fix: match M/B suffix before stripping
    const parseUSD = (s) => {
      if (!s || s === '-') return null
      const m = s.replace(/[$,\s]/g, '').match(/^([0-9.]+)([MBK]?)$/)
      if (!m) return null
      const n = parseFloat(m[1])
      if (isNaN(n)) return null
      if (m[2] === 'B') return Math.round(n * 1_000_000_000)
      if (m[2] === 'M') return Math.round(n * 1_000_000)
      if (m[2] === 'K') return Math.round(n * 1_000)
      return Math.round(n)
    }

    rows.push({
      time,
      balance:   Math.round(balance),
      netChange: Math.round(Math.abs(netChange)),
      usdValue:  usdRaw != null ? parseUSD(cells[3]) : null,
      avgCost:   avgRaw != null ? parseFloat(String(avgRaw).replace(/[$,]/g, '')) : null,
    })
  }
  return rows.sort((a, b) => a.time - b.time)
}

async function scrapeWithScraperApi(targetUrl, render = false) {
  const params = new URLSearchParams({ api_key: SCRAPER_API_KEY, url: targetUrl })
  if (render) params.set('render', 'true')
  const fetchUrl = `http://api.scraperapi.com?${params}`
  const res = await fetch(fetchUrl, { headers: { Accept: 'text/html,*/*' } })
  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`)
  return res.text()
}

async function main() {
  const targetUrl = 'https://www.coingecko.com/en/treasuries/companies/hyperliquid-strategies-inc'
  console.log('Fetching HypeStrat transaction history from CoinGecko via ScraperAPI...')

  let html
  try {
    // Try without JS rendering first (faster, cheaper)
    html = await scrapeWithScraperApi(targetUrl, false)
    if (html.length < 2000) {
      console.log('Response too short, retrying with JS rendering...')
      html = await scrapeWithScraperApi(targetUrl, true)
    }
  } catch (e) {
    console.error('ScraperAPI fetch failed:', e.message)
    process.exit(1)
  }

  if (html.length < 2000) {
    console.error(`Response too short (${html.length} bytes) — likely blocked`)
    process.exit(1)
  }

  // Try to extract from __NEXT_DATA__ JSON blob first (most reliable)
  let transactions = []
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1])
      // CoinGecko page props structure may vary — walk common paths
      const pageProps = nextData?.props?.pageProps ?? {}
      const txSource = pageProps?.transactions ?? pageProps?.company?.transactions ?? pageProps?.data?.transactions ?? []
      if (Array.isArray(txSource) && txSource.length > 0) {
        console.log(`Found ${txSource.length} transactions in __NEXT_DATA__`)
        for (const tx of txSource) {
          const dateStr = tx.date ?? tx.transaction_date ?? tx.created_at ?? ''
          const time = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : 0
          if (!time) continue
          transactions.push({
            time:      Math.floor(time / 86400) * 86400, // normalize to midnight UTC
            balance:   Math.round(parseFloat(tx.token_quantity ?? tx.balance ?? tx.hype_balance ?? 0)),
            netChange: Math.round(Math.abs(parseFloat(tx.net_change ?? tx.quantity_change ?? 0))),
            usdValue:  tx.value_usd != null ? Math.round(parseFloat(tx.value_usd)) : null,
            avgCost:   tx.avg_cost != null ? parseFloat(tx.avg_cost) : null,
          })
        }
      }
    } catch (e) {
      console.log('Could not parse __NEXT_DATA__:', e.message)
    }
  }

  // Fall back to HTML table parsing
  if (transactions.length === 0) {
    console.log('Falling back to HTML table parsing...')
    transactions = parseHtmlTransactions(html)
  }

  if (transactions.length === 0) {
    console.error('No transactions parsed from CoinGecko page')
    process.exit(1)
  }

  console.log(`Parsed ${transactions.length} transactions`)

  // Filter to only NEW transactions not already in the hardcoded baseline
  const newTxns = transactions.filter(t => !BASELINE_TIMES.has(t.time))
  if (newTxns.length === 0) {
    console.log('No new transactions beyond hardcoded baseline — nothing to store')
    process.exit(0)
  }

  console.log(`${newTxns.length} new transaction(s) to store`)

  // Write to Upstash — 14-day TTL (weekly cron will refresh)
  const upstashRes = await fetch(UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', 'hypestrat-transactions', JSON.stringify(newTxns), 'EX', String(14 * 86400)]),
  })

  if (!upstashRes.ok) {
    console.error(`Upstash write failed: HTTP ${upstashRes.status}`)
    process.exit(1)
  }

  console.log('Upstash write result:', await upstashRes.json())
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
