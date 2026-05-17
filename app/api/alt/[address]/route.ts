import { NextResponse } from 'next/server'

// HyperEVM only allows residential IPs; token details are fetched client-side.
export async function GET() {
  return NextResponse.json({ error: 'use client-side fetching' }, { status: 404 })
}
