import { NextRequest, NextResponse } from 'next/server'

const EVM_RPC = 'https://rpc.hyperliquid.xyz/evm'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const upstream = await fetch(EVM_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      next: { revalidate: 0 },
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
    }
    const data = await upstream.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('[evm proxy]', err)
    return NextResponse.json({ error: 'proxy error' }, { status: 500 })
  }
}
