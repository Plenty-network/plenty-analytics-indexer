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

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS swap (
          id NUMERIC PRIMARY KEY,
          ts NUMERIC NOT NULL,
          hash VARCHAR NOT NULL,
          amm VARCHAR NOT NULL,
          account VARCHAR NOT NULL,
          is_swap_1 BOOLEAN NOT NULL,
          token_1_amount NUMERIC(15, 6) NOT NULL,
          token_2_amount NUMERIC(15, 6) NOT NULL,
          value NUMERIC(15, 6) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS add_liquidity (
          id NUMERIC PRIMARY KEY,
          ts NUMERIC NOT NULL,
          hash VARCHAR NOT NULL,
          amm VARCHAR NOT NULL,
          account VARCHAR NOT NULL,
          token_1_amount NUMERIC(15, 6) NOT NULL,
          token_2_amount NUMERIC(15, 6) NOT NULL,
          value NUMERIC(15, 6) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS remove_liquidity (
          id NUMERIC PRIMARY KEY,
          ts NUMERIC NOT NULL,
          hash VARCHAR NOT NULL,
          amm VARCHAR NOT NULL,
          account VARCHAR NOT NULL,
          token_1_amount NUMERIC(15, 6) NOT NULL,
          token_2_amount NUMERIC(15, 6) NOT NULL,
          value NUMERIC(15, 6) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS plenty_aggregate_hour (
          ts NUMERIC PRIMARY KEY,
          volume_value NUMERIC(15, 6) NOT NULL,
          fees_value NUMERIC(15, 6) NOT NULL,
          locked_value NUMERIC(15, 6) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS plenty_aggregate_day (
          ts NUMERIC PRIMARY KEY,
          volume_value NUMERIC(15, 6) NOT NULL,
          fees_value NUMERIC(15, 6) NOT NULL,
          locked_value NUMERIC(15, 6) NOT NULL
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS token_aggregate_hour (
          ts NUMERIC NOT NULL,
          token VARCHAR NOT NULL,
          open_price NUMERIC(15, 6) NOT NULL,
          high_price NUMERIC(15, 6) NOT NULL,
          low_price NUMERIC(15, 6) NOT NULL,
          close_price NUMERIC(15, 6) NOT NULL,
          volume NUMERIC (15, 6) NOT NULL,
          volume_value NUMERIC (15, 6) NOT NULL,
          fees NUMERIC (15, 6) NOT NULL,
          fees_value NUMERIC(15, 6) NOT NULL,
          locked NUMERIC(15, 6) NOT NULL,
          locked_value NUMERIC(15, 6) NOT NULL,
          PRIMARY KEY (ts, token)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS token_aggregate_day (
          ts NUMERIC NOT NULL,
          token VARCHAR NOT NULL,
          open_price NUMERIC(15, 6) NOT NULL,
          high_price NUMERIC(15, 6) NOT NULL,
          low_price NUMERIC(15, 6) NOT NULL,
          close_price NUMERIC(15, 6) NOT NULL,
          volume NUMERIC (15, 6) NOT NULL,
          volume_value NUMERIC (15, 6) NOT NULL,
          fees NUMERIC (15, 6) NOT NULL,
          fees_value NUMERIC(15, 6) NOT NULL,
          locked NUMERIC(15, 6) NOT NULL,
          locked_value NUMERIC(15, 6) NOT NULL,
          PRIMARY KEY (ts, token)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS amm_aggregate_hour (
          ts BIGINT,
          amm VARCHAR,
          token_1_volume NUMERIC(15, 6) NOT NULL,
          token_1_volume_value NUMERIC(15, 6) NOT NULL,
          token_2_volume NUMERIC(15, 6) NOT NULL,
          token_2_volume_value NUMERIC(15, 6) NOT NULL,
          token_1_fees NUMERIC(15, 6) NOT NULL,
          token_1_fees_value NUMERIC(15, 6) NOT NULL,
          token_2_fees NUMERIC(15, 6) NOT NULL,
          token_2_fees_value NUMERIC(15, 6) NOT NULL,
          token_1_locked NUMERIC(15, 6) NOT NULL,
          token_1_locked_value NUMERIC(15, 6) NOT NULL,
          token_2_locked NUMERIC(15, 6) NOT NULL,
          token_2_locked_value NUMERIC(15, 6) NOT NULL,
          PRIMARY KEY (ts, amm)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS amm_aggregate_day (
          ts BIGINT,
          amm VARCHAR,
          token_1_volume NUMERIC(15, 6) NOT NULL,
          token_1_volume_value NUMERIC(15, 6) NOT NULL,
          token_2_volume NUMERIC(15, 6) NOT NULL,
          token_2_volume_value NUMERIC(15, 6) NOT NULL,
          token_1_fees NUMERIC(15, 6) NOT NULL,
          token_1_fees_value NUMERIC(15, 6) NOT NULL,
          token_2_fees NUMERIC(15, 6) NOT NULL,
          token_2_fees_value NUMERIC(15, 6) NOT NULL,
          token_1_locked NUMERIC(15, 6) NOT NULL,
          token_1_locked_value NUMERIC(15, 6) NOT NULL,
          token_2_locked NUMERIC(15, 6) NOT NULL,
          token_2_locked_value NUMERIC(15, 6) NOT NULL,
          PRIMARY KEY (ts, amm)
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS last_indexed (
          amm VARCHAR PRIMARY KEY,
          level NUMERIC
        );`
      );

      await this._dbClient.query(
        `CREATE TABLE IF NOT EXISTS price_spot (
          ts BIGINT,
          token VARCHAR,
          value NUMERIC (15, 6),
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
}
