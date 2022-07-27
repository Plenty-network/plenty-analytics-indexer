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

export interface Data {
  amm: string[];
  token: string[];
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
  pool: string;
  type: TransactionType;
  token1Amount: string;
  token2Amount: string;
  value: string;
}

export interface PoolResponse {
  pool: string;
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
