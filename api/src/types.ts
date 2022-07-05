import DatabaseClient from "./infrastructure/DatabaseClient";
import TzktProvider from "./infrastructure/TzktProvider";

export interface Config {
  heartbeatURL: string;
  tzktURL: string;
  configURL: string;
  port: string;
  tzktLimit: number;
  tzktOffset: number;
  sharedDirectory: string;
  tezGraph: string;
  tezGraphLimit: number;
  rpc: string;
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

export interface DatabaseGetParams {
  table: string;
  select: string;
  where: string;
}

export interface DatabaseGetFunctionParams {
  function: string;
  select: string;
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
export interface TransactionsResponse {
  opHash: string;
  totalValue: string;
  tokenOneAmount: string;
  tokenTwoAmount: string;
  userAccount: string;
  timeStamp: Date;
  ammAddress: string;
  tokenOneSymbol: string;
  tokenTwoSymbol: string;
}

export interface PoolsResponse {
  amm: string;
  tvl: string;
  volume24Hours: string;
  volume7Days: string;
  tokenOneSymbol: string;
  tokenTwoSymbol: string;
}



// Data(contracts) related types and interfaces.

export enum TokenType {
  TEZ = "TEZ",
  FA12 = "FA1.2",
  FA2 = "FA2",
}

export interface Token {
  address: string | undefined;
  symbol: string;
  type: TokenType;
  tokenId: number | undefined;
  decimals: number;
  mapId: number | undefined;
}

export interface Tokens {
  [key: string]: Token;
}

export enum AmmType {
  FLAT = "FLAT",
  NORMAL = "NORMAL",
  META = "META",
}

export interface AmmContract {
  address: string;
  token1: string;
  token2: string;
  type: AmmType;
  gaugeAddress: string | undefined;
  bribeAddress: string | undefined;
  token1Precision: string | undefined;
  token2Precision: string | undefined;
  lpToken: Token | string;
}

export interface AmmContracts {
  [key: string]: AmmContract;
}

export interface Data {
  tokens: Tokens;
  amm: AmmContracts;
}