import { NextResponse } from 'next/server'

// HyperEVM only allows residential IPs, so we cannot fetch token data server-side.
// The alt page fetches directly from the browser. This route exists as a placeholder.
export async function GET() {
  return NextResponse.json([], {
    headers: { 'Cache-Control': 'no-store' },
  })
}
