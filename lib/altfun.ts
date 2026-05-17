// Alt.fun token data fetching via HyperEVM JSON-RPC

const EVM_PROXY = '/api/evm'
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
  address: string      // token ERC-20 address
  creator: string
  pair: string         // bonding curve pair address
  ltAddress: string    // BounceTech LT address
  name: string
  ticker: string
  perpTicker: string   // HL perp that backs the LT (e.g. "OIL")
  isLong: boolean
  leverage: number     // targetLeverage as integer
}

export interface AltTokenDetails extends AltToken {
  marketCapUsd: number | null   // current market cap from pool reserves
  volume24hUsd: number | null   // 24hr HL perp volume (proxy)
}

// ─── ABI helpers ─────────────────────────────────────────────────────────────

function hexSlice(hex: string, byteStart: number, byteEnd: number): string {
  return hex.slice(byteStart * 2, byteEnd * 2)
}

function decodeUint256(hex: string, byteOffset: number): bigint {
  return BigInt('0x' + hexSlice(hex, byteOffset, byteOffset + 32))
}

function decodeAddress(hex: string, byteOffset: number): string {
  // address is 20 bytes, right-aligned in a 32-byte slot
  return '0x' + hexSlice(hex, byteOffset + 12, byteOffset + 32)
}

function decodeString(hex: string, ptrOffset: number): string {
  const strOffset = Number(decodeUint256(hex, ptrOffset))
  const length    = Number(decodeUint256(hex, strOffset))
  if (length === 0) return ''
  const strHex = hexSlice(hex, strOffset + 32, strOffset + 32 + length)
  return Buffer.from(strHex, 'hex').toString('utf8')
}

// ─── JSON-RPC ─────────────────────────────────────────────────────────────────

let _rpcId = 1

async function evmPost<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(EVM_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params }),
  })
  if (!res.ok) throw new Error(`EVM proxy ${res.status}`)
  const json = await res.json() as { result?: T; error?: { message: string } }
  if (json.error) throw new Error(`EVM RPC: ${json.error.message}`)
  return json.result as T
}

async function evmCall(to: string, data: string): Promise<string> {
  return evmPost<string>('eth_call', [{ to, data }, 'latest'])
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0')
}

// ─── Contract reads ───────────────────────────────────────────────────────────

interface TokenInfoRaw {
  creator: string
  pair: string
  ltAddress: string
  name: string
  ticker: string
}

async function getTokenInfo(bondingAddr: string, tokenAddr: string): Promise<TokenInfoRaw | null> {
  try {
    const data   = SEL_GET_TOKEN_INFO + padAddress(tokenAddr)
    const result = (await evmCall(bondingAddr, data)).replace('0x', '')
    if (result.length < 128) return null
    // Static fields: creator(slot0), pair(slot1), ltAddress(slot2)
    const creator   = decodeAddress(result, 0)
    const pair      = decodeAddress(result, 32)
    const ltAddress = decodeAddress(result, 64)
    // Dynamic fields: name(ptr@96), ticker(ptr@128)
    const name   = decodeString(result, 96)
    const ticker = decodeString(result, 128)
    return { creator, pair, ltAddress, name, ticker }
  } catch { return null }
}

async function getUnderlyingSymbol(ltAddr: string): Promise<string | null> {
  try {
    const result = (await evmCall(ltAddr, SEL_UNDERLYING_SYMBOL)).replace('0x', '')
    if (result.length < 128) return null
    return decodeString(result, 0)
  } catch { return null }
}

async function getIsLong(ltAddr: string): Promise<boolean> {
  try {
    const result = (await evmCall(ltAddr, SEL_IS_LONG)).replace('0x', '')
    return decodeUint256(result, 0) !== BigInt(0)
  } catch { return true }
}

async function getTargetLeverage(ltAddr: string): Promise<number> {
  try {
    const result = (await evmCall(ltAddr, SEL_TARGET_LEVERAGE)).replace('0x', '')
    return Number(decodeUint256(result, 0))
  } catch { return 5 }
}

interface PoolData { tokenReserve: bigint; assetReserve: bigint }

async function getPool(pairAddr: string): Promise<PoolData | null> {
  try {
    const result = (await evmCall(pairAddr, SEL_POOL)).replace('0x', '')
    if (result.length < 192) return null
    return {
      tokenReserve: decodeUint256(result, 0),
      assetReserve: decodeUint256(result, 32),
    }
  } catch { return null }
}

async function getExchangeRate(ltAddr: string): Promise<bigint | null> {
  try {
    const result = (await evmCall(ltAddr, SEL_EXCHANGE_RATE)).replace('0x', '')
    return decodeUint256(result, 0)
  } catch { return null }
}

// ─── Token list from events ───────────────────────────────────────────────────

interface TokenLaunchedLog {
  topics: string[]
  data: string
  blockNumber: string
}

export async function fetchAltTokenList(): Promise<AltToken[]> {
  const logs = await evmPost<TokenLaunchedLog[]>('eth_getLogs', [{
    address: BONDING_ADDRESS,
    topics:  [TOKEN_LAUNCHED_TOPIC],
    fromBlock: '0x0',
    toBlock:   'latest',
  }])

  if (!Array.isArray(logs)) return []

  // Parse each event log
  const rawTokens = logs.map(log => {
    if (log.topics.length < 4) return null
    const tokenAddr = '0x' + log.topics[1].slice(26)
    const creatorAddr = '0x' + log.topics[2].slice(26)
    const ltAddr    = '0x' + log.topics[3].slice(26)
    const data = log.data.replace('0x', '')
    // data: (string name, string ticker, uint256 k)
    // slot0: ptr to name = 0x60 (96)
    // slot1: ptr to ticker
    // slot2: k (static)
    const name   = decodeString(data, 0)
    const ticker = decodeString(data, 32)
    return { address: tokenAddr, creator: creatorAddr, ltAddress: ltAddr, name, ticker }
  }).filter(Boolean) as Array<{ address: string; creator: string; ltAddress: string; name: string; ticker: string }>

  if (rawTokens.length === 0) return []

  // Fetch HL perp details for each LT in parallel (batch to avoid rate limits)
  const results: AltToken[] = []
  const batchSize = 10
  for (let i = 0; i < rawTokens.length; i += batchSize) {
    const batch = rawTokens.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(async tok => {
      const [perpTicker, isLong, leverage, info] = await Promise.all([
        getUnderlyingSymbol(tok.ltAddress),
        getIsLong(tok.ltAddress),
        getTargetLeverage(tok.ltAddress),
        getTokenInfo(BONDING_ADDRESS, tok.address),
      ])
      if (!perpTicker) return null
      return {
        address:   tok.address,
        creator:   tok.creator,
        pair:      info?.pair ?? '',
        ltAddress: tok.ltAddress,
        name:      info?.name ?? tok.name,
        ticker:    info?.ticker ?? tok.ticker,
        perpTicker,
        isLong,
        leverage,
      } satisfies AltToken
    }))
    results.push(...batchResults.filter(Boolean) as AltToken[])
  }

  return results
}

export async function fetchAltTokenDetails(token: AltToken): Promise<AltTokenDetails> {
  const [pool, exchangeRate] = await Promise.all([
    token.pair ? getPool(token.pair) : Promise.resolve(null),
    getExchangeRate(token.ltAddress),
  ])

  let marketCapUsd: number | null = null
  if (pool && exchangeRate !== null && pool.tokenReserve > BigInt(0)) {
    // price of alt token in USDC ≈ (assetReserve / tokenReserve) * (exchangeRate / 1e18)
    const SCALE = BigInt(10) ** BigInt(18)
    const priceNumerator   = pool.assetReserve * exchangeRate
    const priceDenominator = pool.tokenReserve * SCALE
    if (priceDenominator > BigInt(0)) {
      const priceFloat = Number(priceNumerator) / Number(priceDenominator)
      // Use assetReserve as proxy for circulating value
      const assetFloat = Number(pool.assetReserve) / 1e18
      marketCapUsd = assetFloat * (Number(exchangeRate) / 1e18)
    }
  }

  return { ...token, marketCapUsd, volume24hUsd: null }
}

// ─── Client-side hook ─────────────────────────────────────────────────────────

export function formatMarketCap(mc: number | null): string {
  if (mc === null || mc === 0) return '—'
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`
  if (mc >= 1e3) return `$${(mc / 1e3).toFixed(1)}K`
  return `$${mc.toFixed(0)}`
}
