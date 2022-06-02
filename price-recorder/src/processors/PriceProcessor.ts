import BigNumber from "bignumber.js";
import DatabaseClient from "../infrastructure/DatabaseClient";
import TzktProvider from "../infrastructure/TzktProvider";
import { Config, Dependecies, Contracts, AMMStorage } from "../types";

export default class PriceProcessor {
  private _config: Config;
  private _dbClient: DatabaseClient;
  private _tkztProvider: TzktProvider;
  private _contracts: Contracts;

  constructor({ config, dbClient, tzktProvider, contracts }: Dependecies) {
    this._config = config;
    this._dbClient = dbClient;
    this._tkztProvider = tzktProvider;
    this._contracts = contracts;
  }

  async process(): Promise<void> {
    try {
      for (const amm of Object.keys(this._contracts.amm)) {
        if (
          this._contracts.tokens[this._contracts.amm[amm].token1].priceDepth ===
          this._contracts.tokens[this._contracts.amm[amm].token2].priceDepth
        )
          continue;
        const swapLevels = await this._getSwapOperationLevels(amm);
        const indexedLevels: { [key: string]: boolean } = {};
        for (const { level, timestamp } of swapLevels) {
          if (indexedLevels[level]) continue;
          const storage = await this._tkztProvider.getStorage<AMMStorage>(amm, level);
          await this.processAMMStorage(storage, level, timestamp);
          indexedLevels[level] = true;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  private async processAMMStorage(storage: AMMStorage, level: number, timestamp: number): Promise<void> {
    try {
      let baseToken, baseTokenAmount, priceToken, priceTokenAmount, baseTokenValue;
      const token1 = `${storage.token1Address}_${storage.token1Id}`;
      const token2 = `${storage.token2Address}_${storage.token2Id}`;
      if (this._contracts.tokens[token1].priceDepth > this._contracts.tokens[token2].priceDepth) {
        baseToken = token2;
        priceToken = token1;
        baseTokenAmount = storage.token2_pool;
        priceTokenAmount = storage.token1_pool;
      } else {
        baseToken = token1;
        priceToken = token2;
        baseTokenAmount = storage.token1_pool;
        priceTokenAmount = storage.token2_pool;
      }

      // Set the value of base token at required level
      if (this._contracts.tokens[baseToken].priceDepth === 1) {
        baseTokenValue = 1; // Stablecoin
      } else {
        const res = await this._dbClient.get({
          table: "price",
          select: "value_usd",
          where: `level>=${level} AND token='${baseToken}'`,
        });
        if (res.rowCount === 0) throw new Error(`Price of base token ${baseToken} not in pg.`);
        baseTokenValue = res.rows[0].value_usd;
      }

      const priceTokenValue = this._calculateValueUSD(
        baseToken,
        baseTokenAmount,
        priceToken,
        priceTokenAmount,
        baseTokenValue
      );

      // Update level-wise price
      await this._dbClient.insert({
        table: "price",
        columns: "(level, token, value_usd)",
        values: `(${level}, '${priceToken}', ${priceTokenValue})`,
      });

      // TODO: switch to hourly
      const roundedTS = Math.floor(new Date(timestamp).getTime() / 86400000) * 86400;

      // Check for existing aggregate price
      const existingEntry = await this._dbClient.get({
        table: "price_aggregate",
        select: "*",
        where: `ts=${roundedTS} AND token='${priceToken}'`,
      });

      if (existingEntry.rowCount !== 0) {
        const low =
          parseFloat(priceTokenValue) < parseFloat(existingEntry.rows[0].low_usd)
            ? priceTokenValue
            : existingEntry.rows[0].low_usd;
        const high =
          parseFloat(priceTokenValue) > parseFloat(existingEntry.rows[0].high_usd)
            ? priceTokenValue
            : existingEntry.rows[0].high_usd;
        const open = existingEntry.rows[0].open_usd;
        await this._dbClient.update({
          table: "price_aggregate",
          set: `open_usd=${open}, high_usd=${high}, low_usd=${low}, close_usd=${priceTokenValue}`,
          where: `ts=${roundedTS} AND token='${priceToken}'`,
        });
      } else {
        this._dbClient.insert({
          table: "price_aggregate",
          columns: "(ts, token, open_usd, high_usd, low_usd, close_usd)",
          values: `(${roundedTS}, '${priceToken}', ${priceTokenValue}, ${priceTokenValue}, ${priceTokenValue}, ${priceTokenValue})`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  private async _getSwapOperationLevels(contract: string): Promise<{ level: number; timestamp: number }[]> {
    try {
      const [firstLevel, lastLevel] = await this._getIndexingLevels(contract);
      let offset = 0;
      let swapLevels: { level: number; timestamp: number }[] = [];
      while (true) {
        const levels = await this._tkztProvider.getTransactions<{ level: number; timestamp: number }[]>({
          contract,
          entrypoint: ["Swap"],
          firstLevel,
          lastLevel,
          limit: this._config.tzktLimit,
          offset,
          select: "level,timestamp",
        });
        if (levels.length === 0) {
          break;
        } else {
          swapLevels = swapLevels.concat(levels);
          offset += this._config.tzktOffset;
        }
      }
      return swapLevels;
    } catch (err) {
      throw err;
    }
  }

  // Todo: Fetch from a shared json
  private async _getIndexingLevels(contract: string): Promise<[number, number]> {
    return [2000000, 2397441]; // [last level from json, current level from json]
  }

  private _calculateValueUSD(
    baseToken: string,
    baseTokenAmount: string,
    priceToken: string,
    priceTokenAmount: string,
    baseTokenValue: string
  ): string {
    const numerator = new BigNumber(baseTokenAmount)
      .multipliedBy(baseTokenValue)
      .dividedBy(10 ** this._contracts.tokens[baseToken].decimals);
    const denominator = new BigNumber(priceTokenAmount).dividedBy(10 ** this._contracts.tokens[priceToken].decimals);

    return numerator.dividedBy(denominator).toString();
  }
}
