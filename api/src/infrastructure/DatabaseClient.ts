import { Client, QueryResult } from "pg";

import { Config, DatabaseGetParams, DatabaseInsertParams, DatabaseUpdateParams, DatabaseGetFunctionParams } from "../types";

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
      this._dbClient.connect();
      await this._dbClient.query(
        `CREATE OR REPLACE FUNCTION FetchAllPoolData (StartTimeStamp bigint DEFAULT 0, EndTimeStamp bigint DEFAULT 0)
          RETURNS TABLE (
            amm varchar(50),
            tvl numeric,
            volume_24H numeric,
            volume_7D numeric)
          LANGUAGE plpgsql
          AS $$
        BEGIN
          RETURN query
          SELECT
            q1.amm,
            q2.tvl,
            q3.volume_24H,
            q1.volume AS volume_7D
          FROM (
            SELECT
              SUM(t.volume_usd) AS volume,
              t.amm
            FROM (
              SELECT
                AG1.*,
                row_number() OVER (PARTITION BY AG1.amm ORDER BY AG1.ts DESC) AS seqnum
              FROM
                public.amm_aggregate AS AG1) t
            WHERE
              seqnum <= 7
            GROUP BY
              t.amm) q1
          JOIN (
            SELECT
              u.tvl_usd AS tvl,
              u.amm
            FROM (
              SELECT
                AG2.*,
                row_number() OVER (PARTITION BY AG2.amm ORDER BY AG2.ts DESC) AS seqnum
              FROM
                public.amm_aggregate AS AG2) u
            WHERE
              seqnum <= 1) q2 ON q1.amm = q2.amm
          JOIN (
            SELECT
              sum(
                CASE WHEN s.ts >= StartTimeStamp
                  AND s.ts <= EndTimeStamp THEN
                  s.value
                ELSE
                  0
                END) AS volume_24H,
              s.amm
            FROM
              public.swap AS s
          GROUP BY
            s.amm) q3 ON q2.amm = q3.amm;
        END;
        $$;`
      );
      await this._dbClient.query(
        `CREATE OR REPLACE FUNCTION FetchTvl24hDataChange (amm_address varchar(50))
          RETURNS TABLE (
            amm varchar(50),
            tvl numeric,
            ts bigint)
          LANGUAGE plpgsql
          AS $$
        BEGIN
          RETURN query
          SELECT
            t.amm,
            t.tvl_usd AS tvl,
            t.ts
          FROM (
            SELECT
              AG2.*,
              row_number() OVER (PARTITION BY AG2.amm ORDER BY AG2.ts DESC) AS seqnum
            FROM
              public.amm_aggregate AS AG2
            WHERE
              AG2.amm = amm_address) t
        WHERE
          t.seqnum <= 2
        ORDER BY
          t.ts DESC;
        END;
        $$;`
      );
    } catch (err) {
      throw err;
    }
  }

  async get(params: DatabaseGetParams): Promise<QueryResult<any>> {
    try {
      console.log(`SELECT ${params.select} FROM ${params.table} WHERE ${params.where};`);
      const res = await this._dbClient.query(
        `SELECT ${params.select} FROM ${params.table} WHERE ${params.where};`
      );
      return res;
    } catch (err) {
      throw err;
    }
  }

  async getFunction(params: DatabaseGetFunctionParams): Promise<QueryResult<any>> {
    try {
      console.log(`SELECT ${params.select} FROM ${params.function};`);
      const res = await this._dbClient.query(
        `SELECT ${params.select} FROM ${params.function};`
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
