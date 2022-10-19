import axios from "axios";

import { Config } from "../types";

export default class DataBuilder {
  private _configUrl: string;
  private _network: string;

  constructor({ configURL, network }: Config) {
    this._configUrl = configURL;
    this._network = network;
  }

  async buildData(): Promise<{ amm: string[]; token: string[] }> {
    try {
      const ammList = await this._getAmmContracts();
      const tokenList = await this._getTokens();
      return {
        amm: ammList,
        token: tokenList,
      };
    } catch (err) {
      throw err;
    }
  }

  private async _getAmmContracts(): Promise<string[]> {
    try {
      const res = await axios.get(this._configUrl + "/amm" + `?network=${this._network}`);
      return Object.keys(res.data);
    } catch (err) {
      throw err;
    }
  }

  private async _getTokens(): Promise<string[]> {
    try {
      const res = await axios.get(this._configUrl + "/token?type=standard" + `&network=${this._network}`);
      return Object.keys(res.data);
    } catch (err) {
      throw err;
    }
  }
}
