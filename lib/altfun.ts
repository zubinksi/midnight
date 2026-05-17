'use client'

// Alt.fun token data — calls HyperEVM directly from the browser.
// HyperEVM rate-limits aggressively; all calls are throttled and cached.

const EVM_RPC = 'https://rpc.hyperliquid.xyz/evm'
const BONDING_ADDRESS = '0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB'
const TOKEN_LAUNCHED_TOPIC = '0xfbc2208107bf7df90abee76bf0fc7ccd04797858f418a4794797239da28cf0a3'

const SEL_GET_TOKEN_INFO    = '0x1f69565f'
const SEL_UNDERLYING_SYMBOL = '0xd90a730e'
const SEL_IS_LONG           = '0x202a61a1'
const SEL_TARGET_LEVERAGE   = '0xd6c946ea'
const SEL_EXCHANGE_RATE     = '0x3ba0b9a9'
const SEL_POOL              = '0x16f0115b'

// localStorage keys
const LS_DEPLOY_BLOCK = 'alt-deploy-block'
const LS_SCAN_CURSOR  = 'alt-scan-cursor'
const LS_RAW_LOGS     = 'alt-raw-logs'       // cached parsed log entries
const LS_TOKENS       = 'alt-tokens-v2'      // final token list

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

// ─── JSON-RPC (throttled) ─────────────────────────────────────────────────────

let _id = 1

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function evmPost<T>(method: string, params: unknown[], retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(EVM_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: _id++, method, params }),
    })
    if (!res.ok) throw new Error(`HyperEVM HTTP ${res.status}`)
    const json = await res.json() as { result?: T; error?: { code: number; message: string } }
    if (json.error) {
      if (json.error.code === -32005 && attempt < retries) {
        // Rate limited — back off
        await sleep(1000 * (attempt + 1))
        continue
      }
      throw new Error(`HyperEVM RPC error ${json.error.code}: ${json.error.message}`)
    }
    if (json.result === undefined) throw new Error('HyperEVM: no result')
    return json.result
  }
  throw new Error('HyperEVM: max retries exceeded')
}

async function evmCallBatch(calls: Array<{ to: string; data: string }>): Promise<(string | null)[]> {
  if (calls.length === 0) return []
  const batch = calls.map((c, i) => ({
    jsonrpc: '2.0', id: i + 1,
    method: 'eth_call',
    params: [{ to: c.to, data: c.data }, 'latest'],
  }))
  const res = await fetch(EVM_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  })
  if (!res.ok) throw new Error(`HyperEVM HTTP ${res.status}`)
  const responses = await res.json() as Array<{ id: number; result?: string }>
  const out = new Array<string | null>(calls.length).fill(null)
  for (const r of responses) {
    const i = r.id - 1
    if (i >= 0 && i < calls.length && r.result !== undefined) out[i] = r.result
  }
  return out
}

function toHex(n: number): string { return '0x' + n.toString(16) }
function padAddress(addr: string): string {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0')
}

// ─── Deployment block (binary search, cached) ─────────────────────────────────

async function getOrFindDeployBlock(currentBlock: number): Promise<number> {
  try {
    const cached = localStorage.getItem(LS_DEPLOY_BLOCK)
    if (cached) return parseInt(cached)
  } catch {}

  // Binary search with 200ms throttle between calls
  let lo = 0, hi = currentBlock
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const code = await evmPost<string>('eth_getCode', [BONDING_ADDRESS, toHex(mid)])
    await sleep(200)
    if (!code || code === '0x') lo = mid + 1
    else hi = mid
  }

  try { localStorage.setItem(LS_DEPLOY_BLOCK, String(lo)) } catch {}
  return lo
}

// ─── Log fetching (sequential, throttled) ─────────────────────────────────────

interface RawLog { address: string; creator: string; ltAddress: string; name: string; ticker: string }

function parseLog(log: { topics: string[]; data: string }): RawLog | null {
  if (log.topics.length < 4) return null
  const address   = '0x' + log.topics[1].slice(26)
  const creator   = '0x' + log.topics[2].slice(26)
  const ltAddress = '0x' + log.topics[3].slice(26)
  const data = log.data.replace('0x', '')
  const name   = decodeString(data, 0)
  const ticker = decodeString(data, 32)
  return { address, creator, ltAddress, name, ticker }
}

async function scanLogs(
  fromBlock: number,
  toBlock: number,
  onProgress?: (scanned: number, total: number) => void,
): Promise<RawLog[]> {
  const CHUNK = 1000
  const chunks: Array<[number, number]> = []
  for (let s = fromBlock; s <= toBlock; s += CHUNK) {
    chunks.push([s, Math.min(s + CHUNK - 1, toBlock)])
  }

  const results: RawLog[] = []
  for (let i = 0; i < chunks.length; i++) {
    const [from, to] = chunks[i]
    try {
      const logs = await evmPost<Array<{ topics: string[]; data: string }>>('eth_getLogs', [{
        address: BONDING_ADDRESS,
        topics:  [TOKEN_LAUNCHED_TOPIC],
        fromBlock: toHex(from),
        toBlock:   toHex(to),
      }])
      for (const log of logs) {
        const parsed = parseLog(log)
        if (parsed) results.push(parsed)
      }
    } catch {
      // Skip chunks that error (rate limit retries handled inside evmPost)
    }
    onProgress?.(i + 1, chunks.length)
    await sleep(150) // throttle between chunks
  }
  return results
}

// ─── Token detail enrichment ──────────────────────────────────────────────────

async function enrichTokens(rawTokens: RawLog[]): Promise<AltToken[]> {
  const calls = rawTokens.flatMap(t => [
    { to: t.ltAddress,     data: SEL_UNDERLYING_SYMBOL },
    { to: t.ltAddress,     data: SEL_IS_LONG },
    { to: t.ltAddress,     data: SEL_TARGET_LEVERAGE },
    { to: BONDING_ADDRESS, data: SEL_GET_TOKEN_INFO + padAddress(t.address) },
  ])
  const results = await evmCallBatch(calls)

  const tokens: AltToken[] = []
  for (let i = 0; i < rawTokens.length; i++) {
    const t           = rawTokens[i]
    const symbolHex   = results[i * 4]
    const isLongHex   = results[i * 4 + 1]
    const leverageHex = results[i * 4 + 2]
    const infoHex     = results[i * 4 + 3]

    const perpTicker = symbolHex && symbolHex !== '0x'
      ? decodeString(symbolHex.replace('0x', ''), 0) : null
    if (!perpTicker) continue

    const isLong   = isLongHex ? decodeUint256(isLongHex.replace('0x', ''), 0) !== BigInt(0) : true
    const leverage = leverageHex ? Number(decodeUint256(leverageHex.replace('0x', ''), 0)) : 5

    let pair = '', name = t.name, ticker = t.ticker
    if (infoHex && infoHex !== '0x') {
      const h = infoHex.replace('0x', '')
      if (h.length >= 128) {
        pair   = decodeAddress(h, 32)
        name   = decodeString(h, 96) || t.name
        ticker = decodeString(h, 128) || t.ticker
      }
    }

    tokens.push({ address: t.address, creator: t.creator, pair, ltAddress: t.ltAddress, name, ticker, perpTicker, isLong, leverage })
  }
  return tokens
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchAltTokenList(
  onProgress?: (pct: number, status: string) => void,
): Promise<AltToken[]> {
  onProgress?.(0, 'Connecting...')

  const currentBlockHex = await evmPost<string>('eth_blockNumber', [])
  const currentBlock    = parseInt(currentBlockHex, 16)

  // Load caches
  let cachedRawLogs: RawLog[] = []
  let scanCursor: number | null = null
  let cachedTokens: AltToken[] | null = null
  try {
    const raw = localStorage.getItem(LS_RAW_LOGS)
    if (raw) cachedRawLogs = JSON.parse(raw)
    const cur = localStorage.getItem(LS_SCAN_CURSOR)
    if (cur) scanCursor = parseInt(cur)
    const tok = localStorage.getItem(LS_TOKENS)
    if (tok) cachedTokens = JSON.parse(tok)
  } catch {}

  const fromBlock = scanCursor ?? await (async () => {
    onProgress?.(0, 'Finding contract deploy block...')
    return getOrFindDeployBlock(currentBlock)
  })()

  if (fromBlock > currentBlock) {
    // Nothing new to scan
    return cachedTokens ?? []
  }

  const totalBlocks = currentBlock - fromBlock
  const numChunks   = Math.ceil(totalBlocks / 1000)

  if (numChunks > 0) {
    onProgress?.(0, `Scanning ${numChunks} block chunks...`)
    const newLogs = await scanLogs(fromBlock, currentBlock, (done, total) => {
      onProgress?.(Math.round((done / total) * 100), `Scanning blocks ${done}/${total}...`)
    })

    const allRaw = [...cachedRawLogs, ...newLogs]
    try {
      localStorage.setItem(LS_RAW_LOGS, JSON.stringify(allRaw))
      localStorage.setItem(LS_SCAN_CURSOR, String(currentBlock + 1))
    } catch {}

    if (allRaw.length === 0) return []

    onProgress?.(100, 'Loading token details...')
    const tokens = await enrichTokens(allRaw)
    try { localStorage.setItem(LS_TOKENS, JSON.stringify(tokens)) } catch {}
    return tokens
  }

  return cachedTokens ?? []
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
