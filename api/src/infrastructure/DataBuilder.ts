import axios from "axios";

import { Config, Data, Token } from "../types";
import { convertToMap } from "../utils";

export default class DataBuilder {
  private _configUrl: string;

  constructor({ configURL }: Config) {
    this._configUrl = configURL;
  }

  async buildData(): Promise<Data> {
    try {
      const pools = await this._getPools();
      const tokens = await this._getTokens();
      return {
        pools,
        tokens: convertToMap(tokens, "symbol"),
      };
    } catch (err) {
      throw err;
    }
  }

  private async _getPools(): Promise<string[]> {
    try {
      const res = await axios.get(this._configUrl + "/pools");
      return Object.keys(res.data);
    } catch (err) {
      throw err;
    }
  }

  private async _getTokens(): Promise<Token[]> {
    try {
      const res = await axios.get(this._configUrl + "/tokens");
      return res.data;
    } catch (err) {
      throw err;
    }
  }
}
