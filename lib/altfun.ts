'use client'

// Alt.fun token data — calls HyperEVM directly from the browser.
// HyperEVM only allows residential IPs so this cannot run server-side.

const EVM_RPC = 'https://rpc.hyperliquid.xyz/evm'
const BONDING_ADDRESS = '0xb68811BcC0e4FcD825aA49F9453b065ddF752FcB'
const TOKEN_LAUNCHED_TOPIC = '0xfbc2208107bf7df90abee76bf0fc7ccd04797858f418a4794797239da28cf0a3'

// keccak256-derived function selectors (precomputed)
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

// ─── ABI helpers (browser-safe, no Buffer) ───────────────────────────────────

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
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
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

// ─── Batch JSON-RPC ──────────────────────────────────────────────────────────

interface RpcRequest { id: number; method: string; params: unknown[] }
interface RpcResponse<T> { id: number; result?: T; error?: { message: string } }

let _rpcId = 1

async function evmBatch<T>(requests: Omit<RpcRequest, 'id'>[]): Promise<(T | null)[]> {
  const batch = requests.map(r => ({ jsonrpc: '2.0', id: _rpcId++, method: r.method, params: r.params }))
  const idMap = new Map(batch.map((b, i) => [b.id, i]))
  const res = await fetch(EVM_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  })
  if (!res.ok) throw new Error(`EVM RPC ${res.status}`)
  const responses = await res.json() as RpcResponse<T>[]
  const out = new Array<T | null>(requests.length).fill(null)
  for (const r of responses) {
    const idx = idMap.get(r.id)
    if (idx !== undefined && r.result !== undefined) out[idx] = r.result
  }
  return out
}

async function evmCall(to: string, data: string): Promise<string | null> {
  const [result] = await evmBatch<string>([{ method: 'eth_call', params: [{ to, data }, 'latest'] }])
  return result
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0')
}

// ─── Contract reads ───────────────────────────────────────────────────────────

async function getTokenInfo(tokenAddr: string): Promise<{ pair: string; name: string; ticker: string } | null> {
  const data   = SEL_GET_TOKEN_INFO + padAddress(tokenAddr)
  const result = await evmCall(BONDING_ADDRESS, data)
  if (!result || result === '0x') return null
  const hex = result.replace('0x', '')
  if (hex.length < 128) return null
  const pair   = decodeAddress(hex, 32)
  const name   = decodeString(hex, 96)
  const ticker = decodeString(hex, 128)
  return { pair, name, ticker }
}

// ─── Token list from events ───────────────────────────────────────────────────

interface TokenLaunchedLog {
  topics: string[]
  data: string
}

export async function fetchAltTokenList(): Promise<AltToken[]> {
  const [logs] = await evmBatch<TokenLaunchedLog[]>([{
    method: 'eth_getLogs',
    params: [{
      address:   BONDING_ADDRESS,
      topics:    [TOKEN_LAUNCHED_TOPIC],
      fromBlock: '0x0',
      toBlock:   'latest',
    }],
  }])

  if (!Array.isArray(logs) || logs.length === 0) return []

  // Parse event logs — indexed fields come from topics, dynamic from data
  const rawTokens = logs.map(log => {
    if (log.topics.length < 4) return null
    const address   = '0x' + log.topics[1].slice(26)
    const creator   = '0x' + log.topics[2].slice(26)
    const ltAddress = '0x' + log.topics[3].slice(26)
    const data = log.data.replace('0x', '')
    // data encodes (string name, string ticker, uint256 k)
    const name   = decodeString(data, 0)
    const ticker = decodeString(data, 32)
    return { address, creator, ltAddress, name, ticker }
  }).filter(Boolean) as Array<{ address: string; creator: string; ltAddress: string; name: string; ticker: string }>

  if (rawTokens.length === 0) return []

  // Batch all LT calls: underlyingSymbol, isLong, targetLeverage per token
  const ltRequests = rawTokens.flatMap(t => [
    { method: 'eth_call', params: [{ to: t.ltAddress, data: SEL_UNDERLYING_SYMBOL }, 'latest'] },
    { method: 'eth_call', params: [{ to: t.ltAddress, data: SEL_IS_LONG }, 'latest'] },
    { method: 'eth_call', params: [{ to: t.ltAddress, data: SEL_TARGET_LEVERAGE }, 'latest'] },
  ])
  const ltResults = await evmBatch<string>(ltRequests)

  // Also fetch token info for the pair address (needed for market cap)
  const infoResults = await Promise.all(rawTokens.map(t => getTokenInfo(t.address).catch(() => null)))

  const tokens: AltToken[] = []
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i]
    const symbolHex = ltResults[i * 3]
    const isLongHex = ltResults[i * 3 + 1]
    const leverageHex = ltResults[i * 3 + 2]

    const perpTicker = symbolHex && symbolHex !== '0x' ? decodeString(symbolHex.replace('0x', ''), 0) : null
    if (!perpTicker) continue

    const isLong  = isLongHex ? decodeUint256(isLongHex.replace('0x', ''), 0) !== BigInt(0) : true
    const leverage = leverageHex ? Number(decodeUint256(leverageHex.replace('0x', ''), 0)) : 5
    const info = infoResults[i]

    tokens.push({
      address:   t.address,
      creator:   t.creator,
      pair:      info?.pair ?? '',
      ltAddress: t.ltAddress,
      name:      info?.name || t.name,
      ticker:    info?.ticker || t.ticker,
      perpTicker,
      isLong,
      leverage,
    })
  }

  return tokens
}

export async function fetchAltTokenDetails(token: AltToken): Promise<AltTokenDetails> {
  if (!token.pair) return { ...token, marketCapUsd: null }

  const [poolResult, rateResult] = await evmBatch<string>([
    { method: 'eth_call', params: [{ to: token.pair,      data: SEL_POOL          }, 'latest'] },
    { method: 'eth_call', params: [{ to: token.ltAddress, data: SEL_EXCHANGE_RATE }, 'latest'] },
  ])

  let marketCapUsd: number | null = null
  if (poolResult && poolResult !== '0x' && rateResult && rateResult !== '0x') {
    const poolHex = poolResult.replace('0x', '')
    const rateHex = rateResult.replace('0x', '')
    const tokenReserve  = decodeUint256(poolHex, 0)
    const assetReserve  = decodeUint256(poolHex, 32)
    const exchangeRate  = decodeUint256(rateHex, 0)
    if (tokenReserve > BigInt(0)) {
      const assetFloat = Number(assetReserve) / 1e18
      const rateFloat  = Number(exchangeRate) / 1e18
      marketCapUsd = assetFloat * rateFloat
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
