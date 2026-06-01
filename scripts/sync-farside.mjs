#!/usr/bin/env node
// Scrapes Farside Investors HYPE ETF flow data and stores it in Upstash Redis.
// Runs as a GitHub Actions cron job twice daily on weekdays (~44 req/month).
//
// Farside blocks datacenter IPs. This script tries a direct fetch first and
// only falls back to ScraperAPI if blocked, preserving free-tier credits.
// ScraperAPI free tier: 1,000 req/month. Sign up at scraperapi.com.

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, SCRAPER_API_KEY } = process.env

if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN')
  process.exit(1)
}

if (!SCRAPER_API_KEY) {
  console.error('Missing SCRAPER_API_KEY')
  process.exit(1)
}

const TARGET_URL = 'https://farside.co.uk/hyp/'

function parseFarsideHtml(html) {
  const dateRegex = /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/
  const rows = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = []
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let tdMatch
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
    }
    if (cells.length < 3 || !dateRegex.test(cells[0])) continue
    const dm = cells[0].match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
    if (!dm) continue
    const time = Math.floor(new Date(`${dm[2]} ${dm[1]}, ${dm[3]} UTC`).getTime() / 1000)
    if (isNaN(time)) continue
    const parseM = (s) => {
      const clean = s.replace(/,/g, '').trim()
      if (!clean || clean === '-') return null
      const n = parseFloat(clean)
      return isNaN(n) ? null : Math.round(n * 1_000_000)
    }
    rows.push({ time, bhyp: parseM(cells[1]), thyp: parseM(cells[2]) })
  }
  return rows.sort((a, b) => a.time - b.time)
}

async function fetchDirect() {
  const res = await fetch(TARGET_URL, {
    headers: {
      'Accept': 'text/html,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; midnight-sync/1.0)',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  if (html.length < 1000) throw new Error(`Response too short (${html.length} bytes)`)
  return html
}

async function fetchViaScraperApi() {
  const fetchUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(TARGET_URL)}`
  const res = await fetch(fetchUrl, { headers: { 'Accept': 'text/html,*/*' } })
  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`)
  const html = await res.text()
  if (html.length < 1000) throw new Error(`Response too short (${html.length} bytes)`)
  return html
}

async function main() {
  let html
  try {
    console.log('Attempting direct fetch...')
    html = await fetchDirect()
    console.log('Direct fetch succeeded.')
  } catch (e) {
    console.log(`Direct fetch failed (${e.message}), falling back to ScraperAPI...`)
    try {
      html = await fetchViaScraperApi()
      console.log('ScraperAPI fetch succeeded.')
    } catch (e2) {
      console.error('ScraperAPI fetch failed:', e2.message)
      process.exit(1)
    }
  }

  const rows = parseFarsideHtml(html)
  if (rows.length === 0) {
    console.error('No rows parsed from Farside HTML')
    process.exit(1)
  }

  console.log(`Parsed ${rows.length} rows (${new Date(rows[0].time * 1000).toDateString()} – ${new Date(rows.at(-1).time * 1000).toDateString()})`)

  const upstashRes = await fetch(UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', 'farside-hyp-flows', JSON.stringify(rows), 'EX', '172800']),
  })

  if (!upstashRes.ok) {
    console.error(`Upstash write failed: HTTP ${upstashRes.status}`)
    process.exit(1)
  }

  console.log('Upstash write result:', await upstashRes.json())
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
