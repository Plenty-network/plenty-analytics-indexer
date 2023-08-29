import qs from "qs";
import axios from "axios";
import BigNumber from "bignumber.js";

import { Config, GetTransactionParameters, Token, Transaction } from "../types";

export default class TzktProvider {
  private _tzktURL: string;

  constructor({ tzktURL }: Config) {
    this._tzktURL = tzktURL;
  }

  async getTransactions<T>(params: GetTransactionParameters): Promise<T> {
    try {
      const res = await axios.get(`${this._tzktURL}/operations/transactions`, {
        params: {
          ["target.in"]: params.contract.join(),
          ["entrypoint.in"]: params.entrypoint.join(),
          level: params.level,
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

  async getTokenBalance(token: Token, account: string): Promise<BigNumber> {
    try {
      const res = await axios.get(`${this._tzktURL}/tokens/balances`, {
        params: {
          ["token.tokenId"]: token.tokenId ?? "0",
          ["token.contract"]: token.address,
          account,
        },
      });

      return new BigNumber(res.data[0].balance).dividedBy(10 ** token.decimals);
    } catch (err: any) {
      throw err;
    }
  }
}
