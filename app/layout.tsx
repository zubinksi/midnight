import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'neue.market — Track Markets. 24/7.',
  description: 'Real-time stock, index, commodity, and FX prices on Hyperliquid. The only venue with 24/7 markets.',
  metadataBase: new URL('https://neue.market'),
  openGraph: {
    title: 'neue.market — Track Markets. 24/7.',
    description: 'Real-time stock, index, commodity, and FX prices on Hyperliquid.',
    siteName: 'neue.market',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#080807',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
