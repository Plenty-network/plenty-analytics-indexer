import axios from "axios";

import { AmmContracts, Config, Data, Tokens, TokenType } from "../types";

export default class DataBuilder {
  private _configUrl: string;

  constructor({ configURL }: Config) {
    this._configUrl = configURL;
  }

  async buildData(): Promise<Data> {
    try {
      const tokens = await this._getTokensData();
      const amm = await this._getAmmContracts();
      // console.log(tokens);
      return {
        tokens,
        amm,
      };
    } catch (err) {
      throw err;
    }
  }

  private async _getTokensData(): Promise<Tokens> {
    try {
      /* const tokensResult = (await axios.get(this._configUrl + "/token")).data;
      const tokens: Tokens = {};
      for (const token of Object.keys(tokensResult)) {
        tokens[this._makeKey(tokensResult[token].address, tokensResult[token].tokenId)] = {
          ...tokensResult[token],
        };
      }
      return tokens; */
      return (await axios.get(this._configUrl + "/token")).data;
    } catch (err) {
      throw err;
    }
  }

  private async _getAmmContracts(): Promise<AmmContracts> {
    try {
      /* const ammResult = (await axios.get(this._configUrl + "/amm")).data;
      const amm: AmmContracts = {};
      for (const ammContract of Object.keys(ammResult)) {
        amm[ammContract] = {
          address: ammResult[ammContract].address,
          token1:
            ammResult[ammContract].token1.type === TokenType.FA12
              ? this._makeKey(ammResult[ammContract].token1.address, undefined)
              : this._makeKey(ammResult[ammContract].token1.address, ammResult[ammContract].token1.tokenId),
          token2:
            ammResult[ammContract].token2.type === TokenType.FA12
              ? this._makeKey(ammResult[ammContract].token2.address, undefined)
              : this._makeKey(ammResult[ammContract].token2.address, ammResult[ammContract].token2.tokenId),
          type: ammResult[ammContract].type,
          gaugeAddress: ammResult[ammContract].gaugeAddress,
          bribeAddress: ammResult[ammContract].bribeAddress,
          token1Precision: ammResult[ammContract].token1Precision,
          token2Precision: ammResult[ammContract].token2Precision,
          lpToken: this._makeKey(ammResult[ammContract].lpToken.address, undefined),
        };
      }
      return amm; */
      return (await axios.get(this._configUrl + "/amm")).data;
    } catch (err) {
      throw err;
    }
  }

  private _makeKey(address: string | undefined, tokenId: number | undefined): string {
    return JSON.stringify({ address, tokenId });
  }
}
