// SSE endpoint — streams allMids from Hyperliquid every 2s.
// ?type=xyz  → allMids with dex:"xyz" (real-world assets)
// ?type=perp → allMids (crypto perps)
//
// One long-lived connection per user instead of polling every 2s.
// EventSource auto-reconnects on timeout/disconnect.

export const runtime = 'edge'

const HL_API    = 'https://api.hyperliquid.xyz/info'
const POLL_MS   = 2_000

export async function GET(req: Request): Promise<Response> {
  const type  = new URL(req.url).searchParams.get('type')
  const hlBody = type === 'xyz'
    ? { type: 'allMids', dex: 'xyz' }
    : { type: 'allMids' }

  const encoder = new TextEncoder()

  const body = new ReadableStream({
    async start(controller) {
      let closed = false
      req.signal.addEventListener('abort', () => { closed = true })

      while (!closed) {
        try {
          const res = await fetch(HL_API, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(hlBody),
            signal:  req.signal,
          })
          if (res.ok) {
            const data = await res.json()
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          }
        } catch {
          if (closed) break
        }
        if (closed) break
        await new Promise<void>(r => setTimeout(r, POLL_MS))
      }

      try { controller.close() } catch { /* already closed */ }
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
