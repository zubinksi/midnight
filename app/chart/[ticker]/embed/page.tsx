'use client'

import { use, useState, useCallback, useEffect } from 'react'
import type { AssetInfo } from '@/lib/assets'
import { priceDecimals } from '@/lib/assets'
import { useAssetPrice, usePriceHistory } from '@/lib/hyperliquid'
import { formatPrice, formatChange } from '@/lib/format'
import LivelineChart from '@/components/LivelineChart'

export default function EmbedPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker }  = use(params)
  const upperTicker = ticker.toUpperCase()

  const [assetInfo, setAssetInfo]   = useState<AssetInfo | null>(null)
  const [scrubPrice, setScrubPrice] = useState<number | null>(null)
  const handleScrub = useCallback((p: number | null) => setScrubPrice(p), [])

  useEffect(() => {
    fetch('/api/assets')
      .then(r => r.json() as Promise<AssetInfo[]>)
      .then(list => setAssetInfo(list.find(a => a.ticker === upperTicker) ?? null))
      .catch(() => null)
  }, [upperTicker])

  const coin = assetInfo?.coin ?? `xyz:${upperTicker}`

  const livePrice = useAssetPrice(coin, 800)
  const { data }  = usePriceHistory(coin, '1D')

  const displayPrice = scrubPrice ?? livePrice ?? assetInfo?.price ?? 0
  const open         = data.length > 0 ? data[0].value : (assetInfo?.prevDayPx ?? displayPrice)
  const diff         = displayPrice - open
  const pct          = open !== 0 ? (diff / open) * 100 : 0
  const up           = diff >= 0
  const changeColor  = up ? '#26ab83' : '#E84332'
  const decimals     = priceDecimals(displayPrice)
  const { pctStr }   = formatChange(diff, pct, decimals)

  return (
    <div style={{ background: '#080807', width: '100%', height: '100%', minHeight: 200, padding: '16px 20px 8px', fontFamily: 'Inter,sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: '#46443D', letterSpacing: '0.08em', marginBottom: 4 }}>{upperTicker}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', fontVariantNumeric: 'tabular-nums' }}>
            {displayPrice > 0 ? formatPrice(displayPrice, decimals) : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: changeColor, fontVariantNumeric: 'tabular-nums' }}>{pctStr}</div>
          <div style={{ fontSize: 9, color: '#46443D', marginTop: 4 }}>MIDNIGHT.APP</div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <LivelineChart data={data} value={livePrice ?? displayPrice} color={changeColor} onScrub={handleScrub} />
      </div>
    </div>
  )
}
