import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'neue.markets — Track Markets. 24/7.',
  description: 'Real-time stock, index, commodity, and FX prices on Hyperliquid. The only venue with 24/7 markets.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://neue.markets')
  ),
  openGraph: {
    title: 'neue.markets — Track Markets. 24/7.',
    description: 'Real-time stock, index, commodity, and FX prices on Hyperliquid.',
    siteName: 'neue.markets',
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
