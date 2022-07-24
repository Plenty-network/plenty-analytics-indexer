import DatabaseClient from "./infrastructure/DatabaseClient";
import TzktProvider from "./infrastructure/TzktProvider";

//===============
// Service types
//===============

export interface Config {
  heartbeatURL: string;
  tzktURL: string;
  configURL: string;
  port: string;
  tzktLimit: number;
  tzktOffset: number;
  sharedDirectory: string;
  postgres: {
    username: string;
    database: string;
    password: string;
    host: string;
  };
}

export interface Dependecies {
  config: Config;
  dbClient: DatabaseClient;
  tzktProvider: TzktProvider;
  data: Data;
}

export interface BlockData {
  hash: string;
  timestamp: string;
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
  firstLevel: number;
  lastLevel: number;
  limit: number;
  offset: number;
  select: string;
}

export interface Transaction {
  id: number;
  level: number;
  hash: number;
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

export enum TokenVariant {
  TEZ = "TEZ",
  FA12 = "FA1.2",
  FA2 = "FA2",
}

export interface Token {
  address: string | undefined;
  symbol: string;
  variant: TokenVariant;
  tokenId: number | undefined;
  decimals: number;
}

export interface Tokens {
  [key: string]: Token;
}

export enum AmmType {
  STABLE = "STABLE",
  VOLATILE = "VOLATILE",
}

export interface AmmContract {
  address: string;
  token1: Token;
  token2: Token;
  type: AmmType;
}

export interface AmmContracts {
  [key: string]: AmmContract;
}

export interface Data {
  amm: AmmContracts;
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
  type: AmmType;
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
