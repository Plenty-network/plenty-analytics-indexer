import { Client, QueryResult } from "pg";

import { Config, DatabaseGetParams, DatabaseInsertParams, DatabaseUpdateParams } from "../types";

export default class DatabaseClient {
  private _dbClient: Client;

  constructor(config: Config) {
    this._dbClient = new Client({
      user: config.postgres.username,
      host: config.postgres.host,
      database: config.postgres.database,
      password: config.postgres.password,
      port: 5432,
    });
  }

  async init(): Promise<void> {
    try {
      await this._dbClient.connect();

      await this._dbClient.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='transaction_type') THEN
            CREATE TYPE transaction_type AS ENUM (
              'SWAP_TOKEN_1',
              'SWAP_TOKEN_2',
              'ADD_LIQUIDITY',
              'REMOVE_LIQUIDITY'
            );
          END IF;
        END $$;
      `);

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS transaction (
          id numeric PRIMARY KEY,
          ts numeric(10, 0) NOT NULL,
          hash varchar NOT NULL,
          pool varchar(36) NOT NULL,
          account varchar(36) NOT NULL,
          type transaction_type NOT NULL,
          token_1_amount numeric(36, 12) NOT NULL,
          token_2_amount numeric(36, 12) NOT NULL,
          value numeric(36, 12) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS plenty_aggregate_hour (
          ts numeric(10, 0) PRIMARY KEY,
          volume_value numeric(36, 12) NOT NULL,
          fees_value numeric(36, 12) NOT NULL,
          tvl_value numeric(36, 12) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS plenty_aggregate_day (
          ts numeric(10, 0) PRIMARY KEY,
          volume_value numeric(36, 12) NOT NULL,
          fees_value numeric(36, 12) NOT NULL,
          tvl_value numeric(36, 12) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS token_aggregate_hour (
          ts numeric(10, 0) NOT NULL,
          token numeric(10, 0) NOT NULL,
          open_price numeric(36, 12) NOT NULL,
          high_price numeric(36, 12) NOT NULL,
          low_price numeric(36, 12) NOT NULL,
          close_price numeric(36, 12) NOT NULL,
          volume numeric(36, 12) NOT NULL,
          volume_value numeric(36, 12) NOT NULL,
          fees numeric(36, 12) NOT NULL,
          fees_value numeric(36, 12) NOT NULL,
          locked numeric(36, 12) NOT NULL,
          locked_value numeric(36, 12) NOT NULL,
          PRIMARY KEY (ts, token)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS token_aggregate_day (
          ts numeric(10, 0) NOT NULL,
          token numeric(10, 0) NOT NULL,
          open_price numeric(36, 12) NOT NULL,
          high_price numeric(36, 12) NOT NULL,
          low_price numeric(36, 12) NOT NULL,
          close_price numeric(36, 12) NOT NULL,
          volume numeric(36, 12) NOT NULL,
          volume_value numeric(36, 12) NOT NULL,
          fees numeric(36, 12) NOT NULL,
          fees_value numeric(36, 12) NOT NULL,
          locked numeric(36, 12) NOT NULL,
          locked_value numeric(36, 12) NOT NULL,
          PRIMARY KEY (ts, token)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS pool_aggregate_hour (
          ts numeric(10, 0) NOT NULL,
          pool varchar(36) NOT NULL,
          token_1_volume numeric(36, 12) NOT NULL,
          token_2_volume numeric(36, 12) NOT NULL,
          volume_value numeric(36, 12) NOT NULL,
          token_1_fees numeric(36, 12) NOT NULL,
          token_2_fees numeric(36, 12) NOT NULL,
          fees_value numeric(36, 12) NOT NULL,
          token_1_locked numeric(36, 12) NOT NULL,
          token_2_locked numeric(36, 12) NOT NULL,
          locked_value numeric(36, 12) NOT NULL,
          PRIMARY KEY (ts, pool)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS pool_aggregate_day (
          ts numeric(10, 0) NOT NULL,
          pool varchar(36) NOT NULL,
          token_1_volume numeric(36, 12) NOT NULL,
          token_2_volume numeric(36, 12) NOT NULL,
          volume_value numeric(36, 12) NOT NULL,
          token_1_fees numeric(36, 12) NOT NULL,
          token_2_fees numeric(36, 12) NOT NULL,
          fees_value numeric(36, 12) NOT NULL,
          token_1_locked numeric(36, 12) NOT NULL,
          token_2_locked numeric(36, 12) NOT NULL,
          locked_value numeric(36, 12) NOT NULL,
          PRIMARY KEY (ts, pool)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS price_spot (
          ts numeric(10, 0) NOT NULL,
          token numeric(10, 0) NOT NULL,
          value numeric(36, 12) NOT NULL,
          PRIMARY KEY (ts, token)
        );`
      );
    } catch (err) {
      throw err;
    }
  }

  async get(params: DatabaseGetParams): Promise<QueryResult<any>> {
    try {
      const res = await this._dbClient.query(
        `SELECT ${params.select} FROM ${params.table} WHERE ${params.where} LIMIT 1;`
      );
      return res;
    } catch (err) {
      throw err;
    }
  }

  async getAll(params: DatabaseGetParams): Promise<QueryResult<any>> {
    try {
      const res = await this._dbClient.query(`SELECT ${params.select} FROM ${params.table};`);
      return res;
    } catch (err) {
      throw err;
    }
  }

  async insert(params: DatabaseInsertParams): Promise<QueryResult<any>> {
    try {
      const res = await this._dbClient.query(`INSERT INTO ${params.table} ${params.columns} VALUES ${params.values};`);
      return res;
    } catch (err) {
      throw err;
    }
  }

  async update(params: DatabaseUpdateParams): Promise<QueryResult<any>> {
    try {
      const res = await this._dbClient.query(`UPDATE ${params.table} SET ${params.set} WHERE ${params.where};`);
      return res;
    } catch (err) {
      throw err;
    }
  }

  async raw(query: string): Promise<QueryResult<any>> {
    try {
      const res = await this._dbClient.query(query);
      return res;
    } catch (err) {
      throw err;
    }
  }
}
