import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

export const metadata: Metadata = {
  title: 'neue.markets — Track Markets. 24/7.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://neue.markets'),
  openGraph: {
    title: '',
    description: '',
    siteName: 'neue.markets',
  },
  twitter: {
    card: 'summary_large_image',
    title: '',
    description: '',
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
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
