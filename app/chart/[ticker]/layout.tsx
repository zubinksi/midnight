import type { Metadata } from 'next'
import { getAsset } from '@/lib/assets'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>
}): Promise<Metadata> {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()
  const asset = getAsset(upperTicker)
  if (!asset) return {}

  return {
    title: `${upperTicker} — Midnight`,
    description: `Live ${asset.name} price on Hyperliquid. After hours, 24/7.`,
    openGraph: {
      title: `${upperTicker} — Midnight`,
      description: `Live ${asset.name} price on Hyperliquid. After hours, 24/7.`,
      images: [`/api/og/${upperTicker}`],
    },
    twitter: {
      card: 'summary_large_image',
      images: [`/api/og/${upperTicker}`],
    },
  }
}

export default function ChartLayout({ children }: { children: React.ReactNode }) {
  return children
}
