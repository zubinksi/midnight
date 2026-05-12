import { NextResponse } from 'next/server'

const HL_API = 'https://api.hyperliquid.xyz/info'

async function hlPost(body: unknown) {
  const r = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const data = await r.json()
  return { status: r.status, preview: JSON.stringify(data).slice(0, 400) }
}

export async function GET() {
  const results: Record<string, unknown> = {}
  // Test known vault addresses from the nktkas SDK test suite
  try { results.vaultSummaries = await hlPost({ type: 'vaultSummaries' }) } catch (e) { results.vaultSummaries = String(e) }
  try { results.hlp = await hlPost({ type: 'vaultDetails', vaultAddress: '0x1719884eb866cb12b2287399b15f7db5e7d775ea' }) } catch (e) { results.hlp = String(e) }
  try { results.parent = await hlPost({ type: 'vaultDetails', vaultAddress: '0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0' }) } catch (e) { results.parent = String(e) }
  return NextResponse.json(results)
}
