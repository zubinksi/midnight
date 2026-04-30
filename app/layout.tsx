import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Midnight — After Hours. 24/7.',
  description: 'Real-time stock, index, and commodity prices on Hyperliquid. The only venue with 24/7 markets.',
  metadataBase: new URL('https://midnight.app'),
  openGraph: {
    title: 'Midnight — After Hours. 24/7.',
    description: 'Real-time stock, index, and commodity prices on Hyperliquid.',
    siteName: 'Midnight',
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
