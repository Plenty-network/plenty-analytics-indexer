import qs from "qs";
import axios from "axios";

import { Config, GetTransactionParameters, Transaction } from "../types";

export default class TzktProvider {
  private _tzktURL: string;

  constructor({ tzktURL }: Config) {
    this._tzktURL = tzktURL;
  }

  async getTransactions<T>(params: GetTransactionParameters): Promise<T> {
    try {
      const res = await axios.get(`${this._tzktURL}/operations/transactions`, {
        params: {
          target: params.contract,
          entrypoint: params.entrypoint,
          ["level.ge"]: params.firstLevel,
          ["level.le"]: params.lastLevel,
          select: params.select,
          limit: params.limit,
          offset: params.offset,
          status: "applied",
        },
        paramsSerializer: (params) => {
          return qs.stringify(params, { arrayFormat: "repeat" });
        },
      });
      return res.data;
    } catch (err) {
      throw err;
    }
  }

  async getOperation(hash: string): Promise<Transaction[]> {
    try {
      const res = await axios.get(`${this._tzktURL}/operations/${hash}`);
      return res.data;
    } catch (err) {
      throw err;
    }
  }
}
