import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>
}): Promise<Metadata> {
  const { ticker } = await params
  const upperTicker = ticker.toUpperCase()

  return {
    title: `${upperTicker} — neue.market`,
    description: `Live ${upperTicker} price on Hyperliquid. Track markets 24/7.`,
    openGraph: {
      title: `${upperTicker} — neue.market`,
      description: `Live ${upperTicker} price on Hyperliquid. Track markets 24/7.`,
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
