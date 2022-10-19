import axios from "axios";

import { AmmContracts, Config, Data } from "../types";

export default class DataBuilder {
  private _configUrl: string;
  private _network: string;

  constructor({ configURL, network }: Config) {
    this._configUrl = configURL;
    this._network = network;
  }

  async buildData(): Promise<Data> {
    try {
      const amm = await this._getAmmContracts();
      return {
        amm,
      };
    } catch (err) {
      throw err;
    }
  }

  private async _getAmmContracts(): Promise<AmmContracts> {
    try {
      return (
        await axios.get(this._configUrl + "/amm" + `?network=${this._network}`, {
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
