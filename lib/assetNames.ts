const NAMES: Record<string, string> = {
  // US Equities
  AAPL:     'Apple Inc.',
  AMZN:     'Amazon.com',
  AMD:      'AMD',
  COIN:     'Coinbase',
  CRCL:     'Circle Internet',
  GOOGL:    'Alphabet Inc.',
  HOOD:     'Robinhood',
  INTC:     'Intel',
  META:     'Meta Platforms',
  MSFT:     'Microsoft',
  MSTR:     'Strategy',
  MU:       'Micron Technology',
  NFLX:     'Netflix',
  NVDA:     'NVIDIA',
  ORCL:     'Oracle',
  PLTR:     'Palantir',
  RIVN:     'Rivian',
  SNDK:     'SanDisk',
  TSLA:     'Tesla',
  // Korean Equities
  SMSN:     'Samsung Electronics',
  SKHX:     'SK Hynix',
  HYUNDAI:  'Hyundai Motor',
  // ETF Indices
  EWY:      'iShares MSCI South Korea',
  EWJ:      'iShares MSCI Japan',
  USAR:     'iShares US Aggregate Bond',
  // Indices
  XYZ100:   'XYZ U.S. 100',
  SP500:    'S&P 500',
  JP225:    'Nikkei 225',
  KR200:    'KOSPI 200',
  // Commodities
  GOLD:     'Gold',
  SILVER:   'Silver',
  PLATINUM: 'Platinum',
  PALLADIUM:'Palladium',
  COPPER:   'Copper',
  WTIOIL:   'Crude Oil',
  CL:       'Crude Oil',
  BRENTOIL: 'Brent Crude Oil',
  NATGAS:   'Natural Gas',
  URNM:     'Uranium',
  // FX
  JPY:      'Japanese Yen',
  EUR:      'Euro',
  // Pre-IPO
  SPCX:     'SpaceX',
  // Crypto
  BTC:      'Bitcoin',
  ETH:      'Ethereum',
  SOL:      'Solana',
  BNB:      'BNB',
  XRP:      'XRP',
  DOGE:     'Dogecoin',
  AVAX:     'Avalanche',
  LINK:     'Chainlink',
  ADA:      'Cardano',
  SUI:      'Sui',
  HYPE:     'Hyperliquid',
  TON:      'Toncoin',
  ARB:      'Arbitrum',
}

export function getAssetName(ticker: string): string {
  return NAMES[ticker.toUpperCase()] ?? ticker
}
