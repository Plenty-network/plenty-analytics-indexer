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
        CREATE TABLE IF NOT EXISTS data (
          amm VARCHAR PRIMARY KEY,
          token_1 VARCHAR NOT NULL,
          token_2 VARCHAR NOT NULL
        )
      `);
    } catch (err) {
      throw err;
    }
  }

  async get(params: DatabaseGetParams): Promise<QueryResult<any>> {
    try {
      const res = await this._dbClient.query(`SELECT ${params.select} FROM ${params.table} WHERE ${params.where};`);
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
