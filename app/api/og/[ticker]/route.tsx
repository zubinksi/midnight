import { ImageResponse } from '@vercel/og'
import { getAssetName } from '@/lib/assetNames'
import { priceDecimals } from '@/lib/assets'

export const runtime = 'edge'

const HL = 'https://api.hyperliquid.xyz/info'

interface AssetData { price: number; prevDayPx: number }

async function fetchAssetData(ticker: string): Promise<AssetData | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 2500)

  try {
    // Fetch xyz and perp in parallel
    const [xyzRes, perpRes] = await Promise.allSettled([
      fetch(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }), signal: ctrl.signal }),
      fetch(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }), signal: ctrl.signal }),
    ])

    // Helper: scan metaAndAssetCtxs response for the ticker
    const scan = (raw: unknown): AssetData | null => {
      if (!Array.isArray(raw)) return null
      const metas: Array<{ name: string }> = raw[0]?.universe ?? []
      const ctxs: Array<{ markPx: string; midPx: string | null; prevDayPx: string }> = raw[1] ?? []
      for (let i = 0; i < metas.length; i++) {
        const name = metas[i]?.name ?? ''
        const t = name.startsWith('xyz:') ? name.slice(4) : name
        if (t !== ticker) continue
        const ctx = ctxs[i]
        const price = parseFloat(ctx?.markPx ?? ctx?.midPx ?? '0') || 0
        const prevDayPx = parseFloat(ctx?.prevDayPx ?? '0') || 0
        if (price > 0) return { price, prevDayPx }
      }
      return null
    }

    for (const res of [xyzRes, perpRes]) {
      if (res.status !== 'fulfilled' || !res.value.ok) continue
      const result = scan(await res.value.json())
      if (result) { clearTimeout(t); return result }
    }
  } catch { /* timeout or network error */ }

  clearTimeout(t)
  return null
}

function formatPrice(price: number): string {
  const d = priceDecimals(price)
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()
  const assetName   = getAssetName(upperTicker)
  const data        = await fetchAssetData(upperTicker)

  const price     = data?.price ?? 0
  const prevDay   = data?.prevDayPx ?? 0
  const diff      = prevDay > 0 ? price - prevDay : 0
  const pct       = prevDay > 0 ? (diff / prevDay) * 100 : 0
  const up        = diff >= 0
  const changeColor = up ? '#26ab83' : '#E84332'
  const pctStr    = prevDay > 0 ? `${up ? '+' : ''}${pct.toFixed(2)}%` : null
  const priceStr  = price > 0 ? formatPrice(price) : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#080807',
          display: 'flex',
          padding: 48,
        }}
      >
        {/* Card — mirrors share modal */}
        <div
          style={{
            flex: 1,
            background: '#0F0F0E',
            borderRadius: 24,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#1C1C1A',
            padding: '48px 64px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          {/* Top row: ticker + name (left) | branding (right) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 22, color: '#46443D', letterSpacing: '0.08em' }}>
                {upperTicker}
              </span>
              <span style={{ fontSize: 20, color: '#46443D', marginTop: 6 }}>
                {assetName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, background: '#26ab83', marginRight: 12 }} />
              <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.1em' }}>NEUE.MARKETS</span>
            </div>
          </div>

          {/* Price + change */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <span
              style={{
                fontSize: priceStr && priceStr.length > 9 ? 80 : 100,
                fontWeight: 700,
                color: '#F0EDE6',
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              {priceStr ?? upperTicker}
            </span>
            {pctStr && (
              <div
                style={{
                  display: 'flex',
                  background: up ? '#26ab8326' : '#E8433226',
                  borderRadius: 8,
                  padding: '12px 24px',
                  marginBottom: 8,
                  marginLeft: 32,
                }}
              >
                <span style={{ fontSize: 44, fontWeight: 600, color: changeColor, letterSpacing: '-0.01em' }}>
                  {pctStr}
                </span>
              </div>
            )}
          </div>

          {/* Bottom */}
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 18, color: '#46443D', letterSpacing: '0.08em' }}>
              LIVE ON HYPERLIQUID
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
