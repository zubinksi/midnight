'use client'

// Alt.fun token data.
// Event logs: Hypurrscan indexed API (one request, no block range limit)
// Contract reads: HyperEVM eth_call batch (browser only — server IPs are blocked)

const HYPURRSCAN = 'https://trace.hypurrscan.io/api/v1'
const EVM_RPC    = 'https://rpc.hyperliquid.xyz/evm'

const BONDING_ADDRESS       = '0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB'
const TOKEN_LAUNCHED_TOPIC  = '0xfbc2208107bf7df90abee76bf0fc7ccd04797858f418a4794797239da28cf0a3'

const SEL_GET_TOKEN_INFO    = '0x1f69565f'
const SEL_UNDERLYING_SYMBOL = '0xd90a730e'
const SEL_IS_LONG           = '0x202a61a1'
const SEL_TARGET_LEVERAGE   = '0xd6c946ea'
const SEL_EXCHANGE_RATE     = '0x3ba0b9a9'
const SEL_POOL              = '0x16f0115b'

const LS_TOKENS     = 'alt-tokens-v6'
const LS_TOKENS_TS  = 'alt-tokens-ts-v6'
const CACHE_TTL_MS  = 30 * 60 * 1000

export interface AltToken {
  address: string
  creator: string
  pair: string
  ltAddress: string
  name: string
  ticker: string
  perpTicker: string
  isLong: boolean
  leverage: number
}

export interface AltTokenDetails extends AltToken {
  marketCapUsd: number | null
}

// ─── ABI helpers ─────────────────────────────────────────────────────────────

function hexSlice(hex: string, byteStart: number, byteEnd: number): string {
  return hex.slice(byteStart * 2, byteEnd * 2)
}

function decodeUint256(hex: string, byteOffset: number): bigint {
  const chunk = hexSlice(hex, byteOffset, byteOffset + 32)
  return chunk ? BigInt('0x' + chunk) : BigInt(0)
}

function decodeAddress(hex: string, byteOffset: number): string {
  return '0x' + hexSlice(hex, byteOffset + 12, byteOffset + 32)
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return new TextDecoder().decode(bytes)
}

function decodeString(hex: string, ptrOffset: number): string {
  try {
    const strOffset = Number(decodeUint256(hex, ptrOffset))
    const length    = Number(decodeUint256(hex, strOffset))
    if (length === 0 || length > 1024) return ''
    return hexToUtf8(hexSlice(hex, strOffset + 32, strOffset + 32 + length))
  } catch { return '' }
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0')
}

// ─── Hypurrscan: fetch all TokenLaunched logs ─────────────────────────────────

interface HypurrLog {
  address: string
  block_number: number
  data: string
  topic0: string
  topic1: string
  topic2: string
  topic3: string
}

async function fetchTokenLogs(): Promise<HypurrLog[]> {
  // Primary: Hypurrscan indexed API (single request, no block range limit)
  try {
    const res = await fetch(`${HYPURRSCAN}/indexed/event-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: BONDING_ADDRESS,
        topic0:  TOKEN_LAUNCHED_TOPIC,
        limit:   10000,
        offset:  0,
      }),
    })
    if (res.ok) {
      const raw = await res.json()
      // Handle direct array or wrapped { logs/result/data: [...] }
      if (Array.isArray(raw)) return raw as HypurrLog[]
      const json = raw as { logs?: HypurrLog[]; result?: HypurrLog[]; data?: HypurrLog[]; error?: string }
      const list = json.logs ?? json.result ?? json.data
      if (!json.error && Array.isArray(list)) return list
      console.warn('[altfun] Hypurrscan unexpected shape', JSON.stringify(raw).slice(0, 300))
    } else {
      console.warn('[altfun] Hypurrscan HTTP', res.status)
    }
  } catch (e) { console.warn('[altfun] Hypurrscan failed', e) }

  // Fallback: Blockscout REST API v2 (hyperscan.com), paginated
  const logs: HypurrLog[] = []
  let url: string | null =
    `https://www.hyperscan.com/api/v2/addresses/${BONDING_ADDRESS}/logs` +
    `?topic0=${TOKEN_LAUNCHED_TOPIC}`

  while (url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Blockscout ${res.status}`)
    const json = await res.json() as {
      items: Array<{ topics: string[]; data: string; block_number: number }>
      next_page_params?: Record<string, string | number> | null
    }
    for (const item of (Array.isArray(json.items) ? json.items : [])) {
      if (item.topics[0]?.toLowerCase() !== TOKEN_LAUNCHED_TOPIC) continue
      logs.push({
        address:      BONDING_ADDRESS,
        block_number: item.block_number,
        data:         item.data,
        topic0:       item.topics[0] ?? '',
        topic1:       item.topics[1] ?? '',
        topic2:       item.topics[2] ?? '',
        topic3:       item.topics[3] ?? '',
      })
    }
    if (json.next_page_params) {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(json.next_page_params).map(([k, v]) => [k, String(v)]))
      )
      url = `https://www.hyperscan.com/api/v2/addresses/${BONDING_ADDRESS}/logs?${params}&topic0=${TOKEN_LAUNCHED_TOPIC}`
    } else {
      url = null
    }
  }
  return logs
}

// ─── HyperEVM: batch eth_call ────────────────────────────────────────────────

// HyperEVM enforces a hard limit of 20 calls per JSON-RPC batch.
const EVM_BATCH_CHUNK = 20

async function evmCallChunk(calls: Array<{ to: string; data: string }>): Promise<(string | null)[]> {
  const batch = calls.map((c, i) => ({
    jsonrpc: '2.0', id: i + 1,
    method: 'eth_call',
    params: [{ to: c.to, data: c.data }, 'latest'],
  }))
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt))
    let raw: unknown
    try {
      const res = await fetch(EVM_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (!res.ok) return new Array(calls.length).fill(null)
      raw = await res.json()
    } catch { return new Array(calls.length).fill(null) }
    if (!Array.isArray(raw)) {
      const code = (raw as { error?: { code?: number } })?.error?.code
      if (code === -32005) continue  // rate limited — back off and retry
      return new Array(calls.length).fill(null)
    }
    const out = new Array<string | null>(calls.length).fill(null)
    for (const r of raw as Array<{ id: number; result?: string }>) {
      const i = r.id - 1
      if (i >= 0 && i < calls.length && r.result !== undefined) out[i] = r.result
    }
    return out
  }
  return new Array(calls.length).fill(null)
}

async function evmCallBatch(
  calls: Array<{ to: string; data: string }>,
  onChunk?: (done: number, total: number) => void,
): Promise<(string | null)[]> {
  if (calls.length === 0) return []
  const out = new Array<string | null>(calls.length).fill(null)
  for (let i = 0; i < calls.length; i += EVM_BATCH_CHUNK) {
    const results = await evmCallChunk(calls.slice(i, i + EVM_BATCH_CHUNK))
    for (let j = 0; j < results.length; j++) out[i + j] = results[j]
    onChunk?.(Math.min(i + EVM_BATCH_CHUNK, calls.length), calls.length)
  }
  return out
}

// ─── Token enrichment ─────────────────────────────────────────────────────────

interface RawToken { address: string; creator: string; ltAddress: string; name: string; ticker: string }

function parseLog(log: HypurrLog): RawToken | null {
  if (!log.topic1 || !log.topic2 || !log.topic3) return null
  const address   = '0x' + log.topic1.slice(26)
  const creator   = '0x' + log.topic2.slice(26)
  const ltAddress = '0x' + log.topic3.slice(26)
  const data = log.data.replace('0x', '')
  const name   = decodeString(data, 0)
  const ticker = decodeString(data, 32)
  return { address, creator, ltAddress, name, ticker }
}

async function enrichTokens(
  rawTokens: RawToken[],
  onProgress?: (pct: number, status: string) => void,
): Promise<AltToken[]> {
  // 3 calls per token (skip getTokenInfo — pair fetched on detail page only)
  const calls = rawTokens.flatMap(t => [
    { to: t.ltAddress, data: SEL_UNDERLYING_SYMBOL },
    { to: t.ltAddress, data: SEL_IS_LONG },
    { to: t.ltAddress, data: SEL_TARGET_LEVERAGE },
  ])
  const total = calls.length
  const results = await evmCallBatch(calls, (done) => {
    const tokensDone = Math.floor(done / 3)
    onProgress?.(50 + Math.round((done / total) * 45), `Loading ${tokensDone}/${rawTokens.length} tokens...`)
  })

  const tokens: AltToken[] = []
  for (let i = 0; i < rawTokens.length; i++) {
    const t           = rawTokens[i]
    const symbolHex   = results[i * 3]
    const isLongHex   = results[i * 3 + 1]
    const leverageHex = results[i * 3 + 2]

    const perpTicker = symbolHex && symbolHex !== '0x'
      ? decodeString(symbolHex.replace('0x', ''), 0) : null
    if (!perpTicker) continue

    const isLong   = isLongHex ? decodeUint256(isLongHex.replace('0x', ''), 0) !== BigInt(0) : true
    const leverage = leverageHex ? Number(decodeUint256(leverageHex.replace('0x', ''), 0)) : 5

    tokens.push({ address: t.address, creator: t.creator, pair: '', ltAddress: t.ltAddress, name: t.name, ticker: t.ticker, perpTicker, isLong, leverage })
  }
  return tokens
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchAltTokenList(
  onProgress?: (pct: number, status: string) => void,
): Promise<AltToken[]> {
  // Return cache if fresh
  try {
    const ts = localStorage.getItem(LS_TOKENS_TS)
    if (ts && Date.now() - parseInt(ts) < CACHE_TTL_MS) {
      const cached = localStorage.getItem(LS_TOKENS)
      if (cached) return JSON.parse(cached)
    }
  } catch {}

  onProgress?.(10, 'Fetching token logs...')
  const logs = await fetchTokenLogs()
  console.log(`[altfun] fetchTokenLogs → ${logs.length} logs`)

  onProgress?.(30, `Parsing ${logs.length} logs...`)
  const rawTokens = logs.map(parseLog).filter(Boolean) as RawToken[]
  console.log(`[altfun] parseLog → ${rawTokens.length} raw tokens`)
  if (rawTokens.length === 0) return []

  onProgress?.(50, `Loading details for ${rawTokens.length} tokens...`)
  const tokens = await enrichTokens(rawTokens, onProgress)
  console.log(`[altfun] enrichTokens → ${tokens.length} tokens`)

  try {
    localStorage.setItem(LS_TOKENS, JSON.stringify(tokens))
    localStorage.setItem(LS_TOKENS_TS, String(Date.now()))
  } catch {}

  onProgress?.(100, 'Done')
  return tokens
}

export async function fetchAltTokenDetails(token: AltToken): Promise<AltTokenDetails> {
  if (!token.pair) return { ...token, marketCapUsd: null }

  const [poolResult, rateResult] = await evmCallBatch([
    { to: token.pair,      data: SEL_POOL },
    { to: token.ltAddress, data: SEL_EXCHANGE_RATE },
  ])

  let marketCapUsd: number | null = null
  if (poolResult && poolResult !== '0x' && rateResult && rateResult !== '0x') {
    const assetReserve = decodeUint256(poolResult.replace('0x', ''), 32)
    const exchangeRate = decodeUint256(rateResult.replace('0x', ''), 0)
    const tokenReserve = decodeUint256(poolResult.replace('0x', ''), 0)
    if (tokenReserve > BigInt(0)) {
      marketCapUsd = (Number(assetReserve) / 1e18) * (Number(exchangeRate) / 1e18)
    }
  }

  return { ...token, marketCapUsd }
}

export function formatMarketCap(mc: number | null): string {
  if (mc === null || mc === 0) return '—'
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`
  if (mc >= 1e3) return `$${(mc / 1e3).toFixed(1)}K`
  return `$${mc.toFixed(0)}`
}
