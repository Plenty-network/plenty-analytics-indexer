import DatabaseClient from "./infrastructure/DatabaseClient";
import TzktProvider from "./infrastructure/TzktProvider";

//===============
// Service types
//===============

export interface Config {
  heartbeatURL: string;
  tzktURL: string;
  configURL: string;
  blockPort: string;
  reorgLag: number;
  tzktLimit: number;
  tzktOffset: number;
  ttl: {
    data: number;
  };
  postgres: {
    username: string;
    database: string;
    password: string;
    host: string;
  };
  tezCtezPool: string;
  indexingStart: string;
}

export interface Dependecies {
  config: Config;
  dbClient: DatabaseClient;
  tzktProvider: TzktProvider;
  getData: () => Promise<Data>;
}

export interface BlockData {
  level: number;
}

export interface CachedValue {
  data: any;
  storedAt: Date | undefined;
  ttl: number | undefined;
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

//================
// API call types
//================

export interface GetTransactionParameters {
  contract: string;
  entrypoint: string[];
  level: number;
  limit: number;
  offset: number;
  select: string;
}

export interface Transaction {
  id: number;
  level: number;
  hash: string;
  timestamp: string;
  sender: {
    address: string;
  };
  target:
    | {
        address: string;
      }
    | undefined;
  initiator:
    | {
        address: string;
      }
    | undefined;
  amount: number;
  parameter:
    | {
        entrypoint: string;
        value: any;
      }
    | undefined;
  storage: any;
}

//=====================
// Plenty config types
//=====================

export enum TokenStandard {
  TEZ = "TEZ",
  FA12 = "FA1.2",
  FA2 = "FA2",
}

export interface Token {
  symbol: string;
  decimals: number;
  standard: TokenStandard;
  address?: string;
  tokenId?: number;
}

export interface Tokens {
  [key: string]: Token;
}

export enum PoolType {
  STABLE = "STABLE",
  VOLATILE = "VOLATILE",
}

export interface Pool {
  address: string;
  token1: Token;
  token2: Token;
  fees: number;
  type: PoolType;
}

export interface Pools {
  [key: string]: Pool;
}

export interface Data {
  pools: Pools;
}

//=================
// Processor types
//=================

export enum PricingType {
  SWAP = "SWAP",
  STORAGE = "STORAGE",
}

export interface Pair {
  address: string;
  type: PoolType;
  token1: {
    data: Token;
    pool: number;
    amount: number;
    price: number;
  };
  token2: {
    data: Token;
    pool: number;
    amount: number;
    price: number;
  };
  fees: number;
  transactionType?: TransactionType;
}

export enum AggregateType {
  HOUR = "HOUR",
  DAY = "DAY",
}

export enum TransactionType {
  SWAP_TOKEN_1 = "SWAP_TOKEN_1",
  SWAP_TOKEN_2 = "SWAP_TOKEN_2",
  ADD_LIQUIDITY = "ADD_LIQUIDITY",
  REMOVE_LIQUIDITY = "REMOVE_LIQUIDITY",
}

export interface TransactionRecord {
  ts: number;
  type: TransactionType;
  aggregateType: AggregateType;
  pair: Pair;
}

export interface PlentyRecord {
  ts: number;
  aggregateType: AggregateType;
  tradeValue: number;
  feesValue: number;
}
