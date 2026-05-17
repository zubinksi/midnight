'use client'

// Alt.fun token data — calls HyperEVM directly from the browser.

const EVM_RPC = 'https://rpc.hyperliquid.xyz/evm'
const BONDING_ADDRESS = '0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB'
const TOKEN_LAUNCHED_TOPIC = '0xfbc2208107bf7df90abee76bf0fc7ccd04797858f418a4794797239da28cf0a3'

const SEL_GET_TOKEN_INFO    = '0x1f69565f'
const SEL_UNDERLYING_SYMBOL = '0xd90a730e'
const SEL_IS_LONG           = '0x202a61a1'
const SEL_TARGET_LEVERAGE   = '0xd6c946ea'
const SEL_EXCHANGE_RATE     = '0x3ba0b9a9'
const SEL_POOL              = '0x16f0115b'

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

// ─── JSON-RPC ────────────────────────────────────────────────────────────────

let _id = 1

async function evmPost<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(EVM_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: _id++, method, params }),
  })
  if (!res.ok) throw new Error(`HyperEVM HTTP ${res.status}`)
  const json = await res.json() as { result?: T; error?: { code: number; message: string } }
  if (json.error) throw new Error(`HyperEVM RPC error ${json.error.code}: ${json.error.message}`)
  if (json.result === undefined) throw new Error('HyperEVM: no result')
  return json.result
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

function toHex(n: number): string {
  return '0x' + n.toString(16)
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0')
}

// ─── Deployment block discovery ───────────────────────────────────────────────

// Binary search for the first block where contractAddr has code deployed.
async function findDeploymentBlock(contractAddr: string, currentBlock: number): Promise<number> {
  let lo = 0, hi = currentBlock
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const code = await evmPost<string>('eth_getCode', [contractAddr, toHex(mid)])
    if (!code || code === '0x') {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

// ─── eth_getLogs with pagination ──────────────────────────────────────────────

interface TokenLaunchedLog { topics: string[]; data: string }

async function fetchAllLogs(fromBlock: number, toBlock: number): Promise<TokenLaunchedLog[]> {
  const CHUNK   = 1000
  const PARALLEL = 8
  const chunks: Array<{ from: number; to: number }> = []
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    chunks.push({ from: start, to: Math.min(start + CHUNK - 1, toBlock) })
  }

  const allLogs: TokenLaunchedLog[] = []
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(c =>
        evmPost<TokenLaunchedLog[]>('eth_getLogs', [{
          address:   BONDING_ADDRESS,
          topics:    [TOKEN_LAUNCHED_TOPIC],
          fromBlock: toHex(c.from),
          toBlock:   toHex(c.to),
        }]).catch(() => [] as TokenLaunchedLog[])
      )
    )
    for (const r of results) allLogs.push(...r)
  }
  return allLogs
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchAltTokenList(): Promise<AltToken[]> {
  const currentBlockHex = await evmPost<string>('eth_blockNumber', [])
  const currentBlock    = parseInt(currentBlockHex, 16)

  const deployBlock = await findDeploymentBlock(BONDING_ADDRESS, currentBlock)
  const logs        = await fetchAllLogs(deployBlock, currentBlock)

  if (logs.length === 0) return []

  const rawTokens = logs.map(log => {
    if (log.topics.length < 4) return null
    const address   = '0x' + log.topics[1].slice(26)
    const creator   = '0x' + log.topics[2].slice(26)
    const ltAddress = '0x' + log.topics[3].slice(26)
    const data = log.data.replace('0x', '')
    const name   = decodeString(data, 0)
    const ticker = decodeString(data, 32)
    return { address, creator, ltAddress, name, ticker }
  }).filter(Boolean) as Array<{ address: string; creator: string; ltAddress: string; name: string; ticker: string }>

  if (rawTokens.length === 0) return []

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

    const perpTicker = symbolHex && symbolHex !== '0x' ? decodeString(symbolHex.replace('0x', ''), 0) : null
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
