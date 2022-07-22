import axios from "axios";

import { AmmContracts, Config, Data } from "../types";

export default class DataBuilder {
  private _configUrl: string;

  constructor({ configURL }: Config) {
    this._configUrl = configURL;
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
      return (await axios.get(this._configUrl + "/amm")).data;
    } catch (err) {
      throw err;
    }
  }
}
