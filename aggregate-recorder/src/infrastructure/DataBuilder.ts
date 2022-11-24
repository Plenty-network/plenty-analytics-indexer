import axios from "axios";

import { Config, Data, Pools } from "../types";

export default class DataBuilder {
  private _configUrl: string;

  constructor({ configURL }: Config) {
    this._configUrl = configURL;
  }

  async buildData(): Promise<Data> {
    try {
      const pools = await this._getPools();
      return {
        pools,
      };
    } catch (err) {
      throw err;
    }
  }

  private async _getPools(): Promise<Pools> {
    try {
      return (
        await axios.get(this._configUrl + "/pools", {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
          },
        })
      ).data;
    } catch (err) {
      throw err;
    }
  }
}
