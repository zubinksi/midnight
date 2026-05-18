import { NextRequest, NextResponse } from 'next/server'

export interface TelegramPost {
  channel: string
  text: string
  time: number    // unix ms
  url: string
}

const CHANNELS = [
  { name: 'mlmonchain',             label: 'ML On Chain' },
  { name: 'tradexyz_announcements', label: 'trade.xyz'   },
]

let cached: { posts: TelegramPost[]; ts: number } | null = null
const CACHE_TTL = 4 * 60 * 1000

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // Numeric entities first (&#036; &#x24; etc.), then named ones
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g,        (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Walk forward tracking <div> depth so nested divs don't trip us up.
function extractDivContent(html: string, afterOpenTag: number): string {
  let depth = 1, i = afterOpenTag
  while (i < html.length && depth > 0) {
    const nextOpen  = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div', i)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      if (depth === 0) return html.slice(afterOpenTag, nextClose)
      i = nextClose + 5
    }
  }
  return ''
}

// Try several class names in order — pure text posts use tgme_widget_message_text,
// photo/media posts with captions may use a different wrapper.
const TEXT_SELECTORS = [
  'tgme_widget_message_text',
  'tgme_widget_message_caption',
]

function extractText(chunk: string): string {
  for (const sel of TEXT_SELECTORS) {
    const idx = chunk.indexOf(`class="${sel}`)
    if (idx === -1) continue
    const tagClose = chunk.indexOf('>', idx)
    if (tagClose === -1) continue
    const raw = extractDivContent(chunk, tagClose + 1)
    const text = stripHtml(raw)
    if (text.length >= 2) return text
  }
  return ''
}

async function scrapeChannel(name: string, label: string): Promise<TelegramPost[]> {
  const res = await fetch(`https://t.me/s/${name}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) {
    console.warn(`[telegram] ${name} HTTP ${res.status}`)
    return []
  }
  const html = await res.text()
  console.log(`[telegram] ${name} html length=${html.length}`)

  const posts: TelegramPost[] = []
  const chunks = html.split(/(?=<div[^>]+data-post=")/)
  console.log(`[telegram] ${name} chunks=${chunks.length}`)

  for (const chunk of chunks) {
    const postMatch = chunk.match(/data-post="([^"]+)"/)
    if (!postMatch) continue
    const postId = postMatch[1].split('/').pop()
    if (!postId) continue

    const timeMatch = chunk.match(/<time[^>]+datetime="([^"]+)"/)
    if (!timeMatch) continue
    const time = new Date(timeMatch[1]).getTime()
    if (isNaN(time)) continue

    const text = extractText(chunk)
    if (!text) continue

    posts.push({
      channel: label,
      text: text.slice(0, 500),
      time,
      url: `https://t.me/${name}/${postId}`,
    })
  }

  console.log(`[telegram] ${name} posts=${posts.length}`)
  return posts.sort((a, b) => b.time - a.time).slice(0, 12)
}

export async function GET(req: NextRequest) {
  // ?debug=channelname — returns raw HTML for inspection
  const debug = new URL(req.url).searchParams.get('debug')
  if (debug) {
    const res = await fetch(`https://t.me/s/${debug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    })
    const html = await res.text()
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
  }

  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.posts, { headers: { 'Cache-Control': 'no-store' } })
  }

  const results = await Promise.allSettled(
    CHANNELS.map(c => scrapeChannel(c.name, c.label))
  )

  const posts: TelegramPost[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') posts.push(...r.value)
    else console.warn('[telegram] channel failed', r.reason)
  }

  posts.sort((a, b) => b.time - a.time)
  cached = { posts: posts.slice(0, 20), ts: Date.now() }
  return NextResponse.json(cached.posts, { headers: { 'Cache-Control': 'no-store' } })
}
