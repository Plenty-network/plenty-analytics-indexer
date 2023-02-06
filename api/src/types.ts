import Cache from "./infrastructure/Cache";
import DatabaseClient from "./infrastructure/DatabaseClient";

//===============
// Service types
//===============

export interface Config {
  heartbeatURL: string;
  expressPort: string;
  configURL: string;
  ttl: {
    data: number;
    history: number;
  };
  postgres: {
    username: string;
    database: string;
    password: string;
    host: string;
  };
}

export interface Dependencies {
  cache: Cache;
  config: Config;
  dbClient: DatabaseClient;
  getData: () => Promise<Data>;
}

export interface CachedValue {
  data: any;
  storedAt: Date | undefined;
  ttl: number | undefined;
}

export interface Token {
  name: string;
  symbol: string;
  address: string;
  standard: string;
  tokenId: number;
  decimals: number;
}

export interface Data {
  pools: {
    [key: string]: { address: string; token1: Token; token2: Token; type: string };
  };
  tokens: {
    [key: string]: Token;
  };
}

//================
// Database types
//================

export interface DatabaseGetParams {
  table: string;
  select: string;
  where: string;
}

export interface DatabaseInsertParams {
  table: string;
  columns: string;
  values: string;
}

export interface DatabaseUpdateParams {
  table: string;
  set: string;
  where: string;
}

//==========================
// Analytics Response types
//==========================

export enum TransactionType {
  SWAP_TOKEN_1 = "SWAP_TOKEN_1",
  SWAP_TOKEN_2 = "SWAP_TOKEN_2",
  ADD_LIQUIDITY = "ADD_LIQUIDITY",
  REMOVE_LIQUIDITY = "REMOVE_LIQUIDITY",
}

export interface TransactionResponse {
  timestamp: string;
  opHash: string;
  account: string;
  pool: string;
  type: TransactionType;
  token1Amount: string;
  token2Amount: string;
  value: string;
}

export interface PoolResponse {
  pool: string;
  symbol: string;
  type: string;
  volume: {
    value24H: string;
    change24H: string;
    value7D: string;
    history?: { [key: string]: string }[];
  };
  fees: {
    value24H: string;
    change24H: string;
    value7D: string;
    history?: { [key: string]: string }[];
  };
  tvl: {
    token1Amount: string;
    token2Amount: string;
    value: string;
    change24H: string;
    history?: { [key: string]: string }[];
  };
}

export interface PlentyResponse {
  volume: {
    value24H: string;
    change24H: string;
    history?: { [key: string]: string }[];
  };
  fees: {
    value24H: string;
    change24H: string;
    history?: { [key: string]: string }[];
  };
  tvl: {
    value: string;
    change24H: string;
    history?: { [key: string]: string }[];
  };
}

export interface PriceOHLC {
  o: string;
  h: string;
  l: string;
  c: string;
}

export interface TokenResponse {
  token: string;
  name: string;
  contract?: string;
  standard: string;
  tokenId?: number;
  decimals: number;
  price: {
    value: string;
    change24H: string;
    history?: { [key: string]: PriceOHLC }[];
  };
  volume: {
    value24H: string;
    change24H: string;
    value7D: string;
    history?: { [key: string]: string }[];
  };
  fees: {
    value24H: string;
    change24H: string;
    value7D: string;
    history?: { [key: string]: string }[];
  };
  tvl: {
    value: string;
    change24H: string;
    history?: { [key: string]: string }[];
  };
}

//===================
// VE Response types
//===================

interface AggregateItem {
  value: string;
  token1: string;
  token2: string;
}

export interface VEPoolResponse {
  pool: string;
  volume24H: AggregateItem;
  volume7D: AggregateItem;
  fees24H: AggregateItem;
  fees7D: AggregateItem;
  feesEpoch: AggregateItem;
  tvl: AggregateItem;
}

export interface PriceResponse {
  token: string;
  price: string;
}

//========================
// Tracker Response types
//========================

export interface PairResponse {
  tickerId: string;
  base: string;
  target: string;
  poolId: string;
}

export interface TickerResponseV1 {
  tickerId: string;
  baseCurrency: string;
  targetCurrency: string;
  lastPrice: string;
  baseVolume: string;
  targetVolume: string;
  poolId: string;
}

export interface TickerResponseV2 {
  market: string;
  base: string;
  quote: string;
  price_quote: string;
  volume_base: string;
}
