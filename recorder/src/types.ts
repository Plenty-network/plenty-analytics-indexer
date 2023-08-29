import BigNumber from "bignumber.js";
import DatabaseClient from "./infrastructure/DatabaseClient";
import TzktProvider from "./infrastructure/TzktProvider";

//========
// Common
//========

export interface Config {
  heartbeatURL: string;
  tzktURL: string;
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
  getPools: () => Promise<Pools>;
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
  where?: string;
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
  contract: string[];
  entrypoint: string[];
  level: number;
  limit: number;
  offset: number;
  select: string;
}

export type OperationItem = {
  hash: string;
  target: { address: string };
};

export type OperationCollection = Array<OperationItem>;

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
  FA12 = "FA1.2",
  FA2 = "FA2",
  TEZ = "TEZ",
}

export interface Token {
  id: number;
  name: string;
  symbol: string;
  decimals: number;
  standard: TokenStandard;
  address?: string;
  tokenId?: number;
  thumbnailUri?: string;
  originChain: string;
}

export interface Tokens {
  [key: string]: Token;
}

export enum PoolType {
  V2_STABLE = "STABLE",
  V2_VOLATILE = "VOLATILE",
  V2_TEZ = "TEZ",
  V3 = "V3",
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

//=================
// Processor types
//=================

export interface PlentyTransaction {
  id: number;
  hash: string;
  timestamp: number;
  account: string;
  pool: Pool;
  reserves: { token1: BigNumber; token2: BigNumber };
  txnType: TransactionType;
  txnAmounts: { token1: BigNumber; token2: BigNumber };
  txnFees: { token1: BigNumber; token2: BigNumber };
  txnPrices: { token1: BigNumber; token2: BigNumber };
  txnValue: { token1: BigNumber; token2: BigNumber };
  txnFeesValue: { token1: BigNumber; token2: BigNumber };
}

export enum Period {
  HOUR = "HOUR",
  DAY = "DAY",
}

export enum TransactionType {
  SWAP_TOKEN_1 = "SWAP_TOKEN_1",
  SWAP_TOKEN_2 = "SWAP_TOKEN_2",
  ADD_LIQUIDITY = "ADD_LIQUIDITY",
  REMOVE_LIQUIDITY = "REMOVE_LIQUIDITY",
}
