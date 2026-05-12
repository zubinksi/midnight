import { NextResponse } from 'next/server'

const HL_PROXY = 'http://localhost:3001/api/hl'

async function hlPost(body: unknown) {
  const r = await fetch(HL_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const data = await r.json()
  return { status: r.status, isArray: Array.isArray(data), preview: JSON.stringify(data).slice(0, 200) }
}

export async function GET() {
  const results: Record<string, unknown> = {}
  // Verify proxy works at all
  try { results.allMids = await hlPost({ type: 'allMids' }) } catch (e) { results.allMids = String(e) }
  // Try vault endpoints
  try { results.vaultSummaries = await hlPost({ type: 'vaultSummaries' }) } catch (e) { results.vaultSummaries = String(e) }
  try { results.vaultDetails_hlp = await hlPost({ type: 'vaultDetails', vaultAddress: '0x1719884eb866cb12b2287399b15f7db5e7d775ea' }) } catch (e) { results.vaultDetails_hlp = String(e) }
  return NextResponse.json(results)
}
