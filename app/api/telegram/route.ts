import { NextResponse } from 'next/server'

export interface TelegramPost {
  channel: string   // display label
  text: string
  time: number      // unix ms
  url: string
}

const CHANNELS = [
  { name: 'mlmonchain',             label: 'ML On Chain' },
  { name: 'tradexyz_announcements', label: 'trade.xyz'   },
]

// Module-level cache — survives across requests in the same lambda warm instance
let cached: { posts: TelegramPost[]; ts: number } | null = null
const CACHE_TTL = 4 * 60 * 1000   // 4 minutes

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function scrapeChannel(name: string, label: string): Promise<TelegramPost[]> {
  const res = await fetch(`https://t.me/s/${name}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) return []
  const html = await res.text()

  const posts: TelegramPost[] = []

  // Each message block is anchored by data-post="channel/id"
  // We split on that and process each chunk independently
  const chunks = html.split(/(?=<div[^>]+data-post=")/)

  for (const chunk of chunks) {
    // Post URL
    const postMatch = chunk.match(/data-post="([^"]+)"/)
    if (!postMatch) continue
    const [, dataPost] = postMatch
    const postId = dataPost.split('/').pop()
    if (!postId) continue

    // Timestamp
    const timeMatch = chunk.match(/<time[^>]+datetime="([^"]+)"/)
    if (!timeMatch) continue
    const time = new Date(timeMatch[1]).getTime()
    if (isNaN(time)) continue

    // Message text — Telegram uses class="tgme_widget_message_text js-message_text"
    // The div content rarely contains nested <div>, so a greedy match to the first </div> works.
    const textMatch = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    if (!textMatch) continue

    const text = stripHtml(textMatch[1])
    if (!text || text.length < 3) continue

    posts.push({
      channel: label,
      text: text.slice(0, 500),
      time,
      url: `https://t.me/${name}/${postId}`,
    })
  }

  // Return latest first, cap at 12 per channel
  return posts.sort((a, b) => b.time - a.time).slice(0, 12)
}

export async function GET() {
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.posts, { headers: { 'Cache-Control': 'no-store' } })
  }

  const results = await Promise.allSettled(
    CHANNELS.map(c => scrapeChannel(c.name, c.label))
  )

  const posts: TelegramPost[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') posts.push(...r.value)
  }

  // Interleave by time so channels don't all clump together
  posts.sort((a, b) => b.time - a.time)

  cached = { posts: posts.slice(0, 20), ts: Date.now() }
  return NextResponse.json(cached.posts, { headers: { 'Cache-Control': 'no-store' } })
}
