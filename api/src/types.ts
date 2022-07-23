import DatabaseClient from "./infrastructure/DatabaseClient";

//===============
// Service types
//===============

export interface Config {
  heartbeatURL: string;
  expressPort: string;
  configURL: string;
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
  data: {
    amm: string[];
    token: string[];
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

//================
// Response types
//================

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
  amm: string;
  type: TransactionType;
  token1Amount: string;
  token2Amount: string;
  value: string;
}

export interface PoolResponse {
  amm: string;
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

export interface PriceOHLC {
  o: string;
  h: string;
  l: string;
  c: string;
}

export interface TokenResponse {
  token: string;
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
