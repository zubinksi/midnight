'use client'

import { use, useState, useCallback } from 'react'
import { getAsset } from '@/lib/assets'
import { useAssetPrice, usePriceHistory } from '@/lib/hyperliquid'
import { formatPrice, formatChange } from '@/lib/format'
import LivelineChart from '@/components/LivelineChart'

export default function EmbedPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params)
  const upperTicker = ticker.toUpperCase()
  const asset = getAsset(upperTicker)
  const [scrubPrice, setScrubPrice] = useState<number | null>(null)

  const livePrice = useAssetPrice(upperTicker, 800)
  const { data } = usePriceHistory(upperTicker, '1D')

  const handleScrub = useCallback((p: number | null) => setScrubPrice(p), [])

  if (!asset) return null

  const displayPrice = scrubPrice ?? livePrice ?? asset.seedPrice
  const open = data.length > 0 ? data[0].value : asset.seedPrice
  const diff = displayPrice - open
  const pct = open !== 0 ? (diff / open) * 100 : 0
  const up = diff >= 0
  const changeColor = up ? '#26ab83' : '#E84332'
  const { pctStr } = formatChange(diff, pct, asset.decimals)

  return (
    <div style={{
      background: '#080807',
      width: '100%',
      height: '100%',
      minHeight: 200,
      padding: '16px 20px 8px',
      fontFamily: 'Menlo,Monaco,monospace',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: '#46443D', letterSpacing: '0.08em', marginBottom: 4 }}>{upperTicker}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#F0EDE6', fontVariantNumeric: 'tabular-nums' }}>
            {formatPrice(upperTicker, displayPrice)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: changeColor, fontVariantNumeric: 'tabular-nums' }}>{pctStr}</div>
          <div style={{ fontSize: 9, color: '#46443D', marginTop: 4 }}>MIDNIGHT.APP</div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <LivelineChart
          data={data}
          value={livePrice ?? asset.seedPrice}
          color={changeColor}
          theme="dark"
          onScrub={handleScrub}
        />
      </div>
    </div>
  )
}
