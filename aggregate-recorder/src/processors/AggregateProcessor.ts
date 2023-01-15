import BigNumber from "bignumber.js";
import DatabaseClient from "../infrastructure/DatabaseClient";
import TzktProvider from "../infrastructure/TzktProvider";
import {
  Data,
  Pair,
  Pool,
  Token,
  Config,
  PoolType,
  PricingType,
  Dependecies,
  Transaction,
  PlentyRecord,
  TokenStandard,
  AggregateType,
  TransactionType,
  TransactionRecord,
} from "../types";
import { constants } from "../constants";

BigNumber.set({ EXPONENTIAL_AT: 36 });
BigNumber.set({ DECIMAL_PLACES: 12 });

export default class AggregateProcessor {
  private _config: Config;
  private _dbClient: DatabaseClient;
  private _tkztProvider: TzktProvider;
  private _getData: () => Promise<Data>;
  private _lastLevel: number;

  constructor({ config, dbClient, tzktProvider, getData }: Dependecies) {
    this._config = config;
    this._getData = getData;
    this._dbClient = dbClient;
    this._tkztProvider = tzktProvider;
  }

  async process(lastLevel: number): Promise<void> {
    // Last level received by the block-watcher
    this._lastLevel = lastLevel;

    const data = await this._getData();

    let currentPool = "";
    let currentLevel = 0;
    let currentOperation = "";

    try {
      for (const pool of Object.keys(data.pools)) {
        // Fetch hashes of all operations on the pool that involve a swap
        const operationHashes = await this._getOperationHashes(pool);

        // Locally record current pool being processed for error logging
        currentPool = pool;

        for (const hash of operationHashes) {
          // Fetch individual operations and process them
          const operation = await this._tkztProvider.getOperation(hash);

          // Locally record current level being process for error logging
          currentLevel = operation[0].level;
          currentOperation = hash;

          // Record the indexed level
          await this._recordLastIndexed(data.pools[pool], operation[0].level);
          // Handle the relevant transactions in the operation object
          await this._processOperation(operation, data.pools[pool]);
        }
      }
    } catch (err) {
      throw new Error(`
        Error: ${err.message},\n
        Last Pool: ${currentPool},\n
        Last Level: ${currentLevel}\n
        Last opHash: ${currentOperation}\n
      `);
    }
  }

  //======================
  // Transaction handlers
  //======================

  /**
   * @description processes each transaction in an operation. A transaction can be
   * swap, add-liquidity or remove-liquidity transaction.
   */
  private async _processOperation(operation: Transaction[], pool: Pool): Promise<void> {
    try {
      for (const [index, txn] of operation.entries()) {
        if (txn.target?.address === pool.address) {
          if (constants.TXN_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
            // Pair token amount involved in the transaction
            const token1Amount = this._getTokenAmountFromOperation(pool.token1, operation, index);
            const token2Amount = this._getTokenAmountFromOperation(pool.token2, operation, index);

            // Pair token reserves during the transaction
            const [token1Pool, token2Pool] = this._getTokenPoolFromStorage(txn, pool);

            // Details of the involved in the txn
            const pair: Pair = {
              address: pool.address,
              type: pool.type,
              token1: {
                data: pool.token1,
                pool: token1Pool,
                amount: token1Amount,
                price: 0,
              },
              token2: {
                data: pool.token2,
                pool: token2Pool,
                amount: token2Amount,
                price: 0,
              },
            };

            // Check if the txn is already processed in the past
            // (can happen if pool is called multiple times in a batch)
            const _entry = await this._dbClient.get({
              table: "transaction",
              select: "id",
              where: `id=${txn.id}`,
            });
            if (_entry.rowCount !== 0) return;

            // Handle the transaction and pair based on the transaction type
            if (constants.ADD_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              pair.transactionType = TransactionType.ADD_LIQUIDITY;
              await this._processLiquidityOperation(txn, pair, TransactionType.ADD_LIQUIDITY);
            } else if (constants.SWAP_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              await this._processSwapOperation(txn, pair);
            } else if (constants.REMOVE_LIQUIDITY_ENTRYPOINS.includes(txn.parameter?.entrypoint)) {
              pair.transactionType = TransactionType.REMOVE_LIQUIDITY;
              await this._processLiquidityOperation(txn, pair, TransactionType.REMOVE_LIQUIDITY);
            }
          }
        }
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Handles add-liquidity and remove-liquidity transactions
   */
  private async _processLiquidityOperation(txn: Transaction, pair: Pair, type: TransactionType): Promise<void> {
    try {
      // Bring transaction timestamp to a suitable form
      const ts = Math.floor(new Date(txn.timestamp).getTime() / 1000);

      let token1Price: BigNumber, token2Price: BigNumber;

      // If it's a volatile pair, calculate the token prices from the reserves
      if (pair.type === PoolType.VOLATILE) {
        [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.STORAGE);
      } else {
        // else for stable pairs, get the last record price of each token
        token1Price = await this._getPriceAt(ts, pair.token1.data.symbol);
        token2Price = await this._getPriceAt(ts, pair.token2.data.symbol);

        // If any one of the token does not have a recorded price,
        // assume that it's a fresh liquidity addition and try getting the price through reserves
        if (token1Price.isEqualTo(0) || token2Price.isEqualTo(0)) {
          [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.STORAGE);
        }
      }

      // Set the prices in the pair object
      pair.token1.price = token1Price.toNumber();
      pair.token2.price = token2Price.toNumber();

      // Record spot price of the tokens
      await this._recordSpotPrice(ts, pair.token1.data, token1Price);
      await this._recordSpotPrice(ts, pair.token2.data, token2Price);

      // Record the liquidity transaction
      await this._dbClient.insert({
        table: `transaction`,
        columns: `(
          id,
          ts,
          hash,
          pool,
          account,
          type,
          token_1_amount,
          token_2_amount,
          value
        )`,
        values: `(
          ${txn.id},
          ${ts},
          '${txn.hash}',
          '${pair.address}',
          '${txn.initiator?.address ?? txn.sender?.address}',
          '${type.toLowerCase()}',
          ${pair.token1.amount},
          ${pair.token2.amount},
          ${token1Price.multipliedBy(pair.token1.amount).plus(token2Price.multipliedBy(pair.token2.amount)).toString()}
        )`,
      });

      // Record hourly aggregate data for the pool
      await this._recordPoolAggregate({
        ts,
        type,
        aggregateType: AggregateType.HOUR,
        pair,
      });

      // Record daily aggregate data for the pool
      await this._recordPoolAggregate({
        ts,
        type,
        aggregateType: AggregateType.DAY,
        pair,
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description processes a swap transaction and records the aggregate data.
   */
  private async _processSwapOperation(txn: Transaction, pair: Pair): Promise<void> {
    try {
      // Bring transaction timestamp to a suitable form
      const ts = Math.floor(new Date(txn.timestamp).getTime() / 1000);

      let token1Price: BigNumber, token2Price: BigNumber;

      let type: TransactionType;

      // Decide transaction type based on whether token 1 is swapped for token 2 or vice versa
      if (pair.address === this._config.tezCtezPool) {
        if (txn.parameter.entrypoint === constants.TEZ_SWAP_ENTRYPOINT) {
          type = TransactionType.SWAP_TOKEN_1; // token 1 is swapped for token 2
        } else {
          type = TransactionType.SWAP_TOKEN_2; // token 2 is swapped for token 1
        }
      } else if (
        txn.parameter.value.requiredTokenAddress === pair.token2.data.address &&
        txn.parameter.value.requiredTokenId === (pair.token2.data.tokenId?.toString() ?? "0")
      ) {
        type = TransactionType.SWAP_TOKEN_1;
      } else {
        type = TransactionType.SWAP_TOKEN_2;
      }

      pair.transactionType = type;

      // For volatile pairs, use the token reserves (token-pool) to calculate price
      if (pair.type === PoolType.VOLATILE) {
        [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.STORAGE);
      } else {
        // For stable pairs, use the swap values (token-amount), since there is negligible slippage
        [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.SWAP);
      }

      // Set the prices in the pair object
      pair.token1.price = token1Price.toNumber();
      pair.token2.price = token2Price.toNumber();

      // Record spot price of the tokens
      await this._recordSpotPrice(ts, pair.token1.data, token1Price);
      await this._recordSpotPrice(ts, pair.token2.data, token2Price);

      // This is true if token 1 is swapped for token 2
      const isSwap1 = type === TransactionType.SWAP_TOKEN_1;

      // Record the swap
      await this._dbClient.insert({
        table: `transaction`,
        columns: `(
          id,
          ts,
          hash,
          pool,
          account,
          type,
          token_1_amount,
          token_2_amount,
          value
        )`,
        values: `(
          ${txn.id},
          ${ts},
          '${txn.hash}',
          '${pair.address}',
          '${txn.initiator?.address ?? txn.sender?.address}',
          '${type.toLowerCase()}',   
          ${pair.token1.amount},
          ${pair.token2.amount},
          ${
            isSwap1
              ? token1Price.multipliedBy(pair.token1.amount).toString()
              : token2Price.multipliedBy(pair.token2.amount).toString()
          }
        )`,
      });

      // Record hourly aggregate data for the pool
      await this._recordPoolAggregate({
        ts,
        type,
        aggregateType: AggregateType.HOUR,
        pair,
      });

      // Record hourly aggregate data for the pool
      await this._recordPoolAggregate({
        ts,
        type,
        aggregateType: AggregateType.DAY,
        pair,
      });
    } catch (err) {
      throw err;
    }
  }

  //=====================
  // Assisting recorders
  //=====================

  private async _recordPoolAggregate(txr: TransactionRecord): Promise<void> {
    try {
      const table = `pool_aggregate_${txr.aggregateType.toLowerCase()}`;

      // Get the start timestamp (UTC) of the hour/day in which txn timestamp is present
      const ts =
        txr.aggregateType === AggregateType.HOUR
          ? Math.floor(txr.ts / 3600) * 3600
          : Math.floor(txr.ts / 86400) * 86400;

      // Set to true if either token 1 or token 2 is swapped in
      const isToken1Swap = txr.type === TransactionType.SWAP_TOKEN_1;
      const isToken2Swap = txr.type === TransactionType.SWAP_TOKEN_2;

      // Possible volume and fees for token 1
      const token1Amount = txr.pair.token1.amount;
      const token1Value = token1Amount * txr.pair.token1.price;
      const token1FeesAmount =
        txr.pair.address === this._config.tezCtezPool ? token1Amount / 1000 : token1Amount / 2000;
      const token1FeesValue = txr.pair.address === this._config.tezCtezPool ? token1Value / 1000 : token1Value / 2000;

      // Possible volume and fees for token 2
      const token2Amount = txr.pair.token2.amount;
      const token2Value = token2Amount * txr.pair.token2.price;
      const token2FeesAmount =
        txr.pair.address === this._config.tezCtezPool ? token2Amount / 1000 : token2Amount / 2000;
      const token2FeesValue = txr.pair.address === this._config.tezCtezPool ? token2Value / 1000 : token2Value / 2000;

      const _entry = await this._dbClient.get({
        table,
        select: "*",
        where: `ts=${ts} AND pool='${txr.pair.address}'`,
      });

      // Set volume and fees based on it's a token 1 or token 2 swap in
      if (_entry.rowCount === 0) {
        await this._dbClient.insert({
          table,
          columns: `(
            ts,
            pool,
            token_1_volume,
            token_1_volume_value,
            token_2_volume,
            token_2_volume_value,
            token_1_fees,
            token_1_fees_value,
            token_2_fees,
            token_2_fees_value,
            token_1_locked,
            token_1_locked_value,
            token_2_locked,
            token_2_locked_value
          )`,
          values: `(
            ${ts},
            '${txr.pair.address}',
            ${isToken1Swap ? token1Amount : 0},
            ${isToken1Swap ? token1Value : 0},
            ${isToken2Swap ? token2Amount : 0},
            ${isToken2Swap ? token2Value : 0},
            ${isToken1Swap ? token1FeesAmount : 0},
            ${isToken1Swap ? token1FeesValue : 0},
            ${isToken2Swap ? token2FeesAmount : 0},
            ${isToken2Swap ? token2FeesValue : 0},
            ${txr.pair.token1.pool},
            ${txr.pair.token1.pool * txr.pair.token1.price},
            ${txr.pair.token2.pool},
            ${txr.pair.token2.pool * txr.pair.token2.price}
          )`,
        });
      } else {
        // Existing values of the fields
        const _entryToken1Volume = parseFloat(_entry.rows[0].token_1_volume);
        const _entryToken1VolumeValue = parseFloat(_entry.rows[0].token_1_volume_value);
        const _entryToken1Fees = parseFloat(_entry.rows[0].token_1_fees);
        const _entryToken1FeesValue = parseFloat(_entry.rows[0].token_1_fees_value);
        const _entryToken2Volume = parseFloat(_entry.rows[0].token_2_volume);
        const _entryToken2VolumeValue = parseFloat(_entry.rows[0].token_2_volume_value);
        const _entryToken2Fees = parseFloat(_entry.rows[0].token_2_fees);
        const _entryToken2FeesValue = parseFloat(_entry.rows[0].token_2_fees_value);

        await this._dbClient.update({
          table,
          set: `
            token_1_volume=${isToken1Swap ? _entryToken1Volume + token1Amount : _entryToken1Volume},
            token_1_volume_value=${isToken1Swap ? _entryToken1VolumeValue + token1Value : _entryToken1VolumeValue},
            token_2_volume=${isToken2Swap ? _entryToken2Volume + token2Amount : _entryToken2Volume},
            token_2_volume_value=${isToken2Swap ? _entryToken2VolumeValue + token2Value : _entryToken2VolumeValue},
            token_1_fees=${isToken1Swap ? _entryToken1Fees + token1FeesAmount : _entryToken1Fees},
            token_1_fees_value=${isToken1Swap ? _entryToken1FeesValue + token1FeesValue : _entryToken1FeesValue},
            token_2_fees=${isToken2Swap ? _entryToken2Fees + token2FeesAmount : _entryToken2Fees},
            token_2_fees_value=${isToken2Swap ? _entryToken2FeesValue + token2FeesValue : _entryToken2FeesValue},
            token_1_locked=${txr.pair.token1.pool},
            token_1_locked_value=${txr.pair.token1.pool * txr.pair.token1.price},
            token_2_locked=${txr.pair.token2.pool},
            token_2_locked_value=${txr.pair.token2.pool * txr.pair.token2.price}
          `,
          where: `ts=${ts} AND pool='${txr.pair.address}'`,
        });
      }

      // Record token wise aggregate data
      await this._recordTokenAggregate(txr);

      // Record system wide aggregate if it's a swap
      if (isToken1Swap) {
        await this._recordPlentyAggregate({
          ts,
          aggregateType: txr.aggregateType,
          tradeValue: token1Value,
          feesValue: token1FeesValue,
        });
      } else if (isToken2Swap) {
        await this._recordPlentyAggregate({
          ts,
          aggregateType: txr.aggregateType,
          tradeValue: token2Value,
          feesValue: token2FeesValue,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Records token specific analytics data in token_aggregate_X tables
   */
  private async _recordTokenAggregate(txr: TransactionRecord): Promise<void> {
    try {
      const table = `token_aggregate_${txr.aggregateType.toLowerCase()}`;

      // Get the start timestamp (UTC) of the hour/day in which txn timestamp is present
      const ts =
        txr.aggregateType === AggregateType.HOUR
          ? Math.floor(txr.ts / 3600) * 3600
          : Math.floor(txr.ts / 86400) * 86400;

      // Represents token1 and token2
      const arr: [1, 2] = [1, 2];

      // Iterate through both tokens
      for (const N of arr) {
        // isSwapIn is true is the current token is a being swapped
        const isSwapIn = txr.type === TransactionType[`SWAP_TOKEN_${N}`];

        // Store field values in variables for ease-of-use
        const price = txr.pair[`token${N}`].price;
        const tokenAmount = txr.pair[`token${N}`].amount;
        const tokenSymbol = txr.pair[`token${N}`].data.symbol;

        // The total dollar value of token involved in the txn
        const tokenValue = price * tokenAmount;

        // Fees calculated as 0.1% of stable trade value and 0.35% of volatile trade value
        const feesAmount = txr.pair.type === PoolType.STABLE ? tokenAmount / 1000 : tokenAmount / 290;
        const feesvalue = txr.pair.type === PoolType.STABLE ? tokenValue / 1000 : tokenValue / 290;

        const _entry = await this._dbClient.get({
          table,
          select: "*",
          where: `ts=${ts} AND token='${tokenSymbol}'`,
        });

        // If no existing entry present for the timestamp, then insert a fresh record
        if (_entry.rowCount === 0) {
          // Set OHLC price as the current price and carry over the locked value from previous entry.
          // Volume and fees is set to > 0 only when the token is being swapped in
          await this._dbClient.insert({
            table,
            columns: `(
              ts, 
              token, 
              open_price,
              high_price,
              low_price,
              close_price,
              volume,
              volume_value, 
              fees,
              fees_value
            )`,
            values: `(
            ${ts}, 
            '${tokenSymbol}', 
            ${price}, 
            ${price}, 
            ${price}, 
            ${price}, 
            ${isSwapIn ? tokenAmount : 0},
            ${isSwapIn ? tokenValue : 0},
            ${isSwapIn ? feesAmount : 0},
            ${isSwapIn ? feesvalue : 0}
          )`,
          });
        } else {
          // Existing volume and fees
          const _entryVolume = parseFloat(_entry.rows[0].volume);
          const _entryVolumeValue = parseFloat(_entry.rows[0].volume_value);
          const _entryFees = parseFloat(_entry.rows[0].fees);
          const _entryFeesValue = parseFloat(_entry.rows[0].fees_value);

          // Update existing record by conditionally updating the HLC price,
          // and adding onto previous volume and fees if it's a swap in.
          await this._dbClient.update({
            table,
            set: `
              high_price=${Math.max(price, parseFloat(_entry.rows[0].high_price))}, 
              low_price=${Math.min(price, parseFloat(_entry.rows[0].low_price))},
              close_price=${price},
              volume=${isSwapIn ? _entryVolume + tokenAmount : _entryVolume},
              volume_value=${isSwapIn ? _entryVolumeValue + tokenValue : _entryVolumeValue}, 
              fees=${isSwapIn ? _entryFees + feesAmount : _entryFees}, 
              fees_value=${isSwapIn ? _entryFeesValue + feesvalue : _entryFeesValue}
          `,
            where: `ts=${ts} AND token='${tokenSymbol}'`,
          });
        }
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Records system wide aggregate across all plenty pools
   */
  private async _recordPlentyAggregate(plr: PlentyRecord): Promise<void> {
    try {
      const table = `plenty_aggregate_${plr.aggregateType.toLowerCase()}`;

      const _entry = await this._dbClient.get({
        table,
        select: "*",
        where: `ts=${plr.ts}`,
      });

      if (_entry.rowCount === 0) {
        await this._dbClient.insert({
          table,
          columns: `(
              ts, 
              volume_value, 
              fees_value
            )`,
          values: `(
              ${plr.ts}, 
              ${plr.tradeValue}, 
              ${plr.feesValue}
            )`,
        });
      } else {
        // Existing values for each field at a given timestamp
        const _entryVolumeValue = parseFloat(_entry.rows[0].volume_value);
        const _entryFeesValue = parseFloat(_entry.rows[0].fees_value);

        // Add volume and fees to existing values
        await this._dbClient.update({
          table,
          set: ` 
            volume_value=${_entryVolumeValue + plr.tradeValue}, 
            fees_value=${_entryFeesValue + plr.feesValue}
          `,
          where: `ts=${plr.ts}`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Simply records the price of a token at a given timestamp in price_spot table.
   */
  private async _recordSpotPrice(ts: number, token: Token, price: BigNumber): Promise<void> {
    try {
      // Do not record dollar stablecoins
      if (constants.DOLLAR_STABLECOINS.includes(token.symbol)) return;

      const _entry = await this._dbClient.get({
        table: "price_spot",
        select: "token",
        where: `ts=${ts} AND token='${token.symbol}'`,
      });

      if (_entry.rowCount !== 0) {
        await this._dbClient.update({
          table: "price_spot",
          set: `value=${price.toString()}`,
          where: `ts=${ts} AND token='${token.symbol}'`,
        });
      } else {
        await this._dbClient.insert({
          table: "price_spot",
          columns: "(ts, token, value)",
          values: `(${ts}, '${token.symbol}', ${price.toString()})`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description inserts the last processed level into the db
   */
  private async _recordLastIndexed(pool: Pool, level: number): Promise<void> {
    try {
      const _entry = await this._dbClient.get({
        select: "*",
        table: "last_indexed",
        where: `pool='${pool.address}'`,
      });

      if (_entry.rowCount !== 0) {
        await this._dbClient.update({
          table: "last_indexed",
          set: `level=${level}`,
          where: `pool='${pool.address}'`,
        });
      } else {
        await this._dbClient.insert({
          table: "last_indexed",
          columns: `(pool, level)`,
          values: `('${pool.address}', ${level})`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  //===================
  // Value calculators
  //===================

  /**
   * @description Calculate the spot price of a token pair at a given timestamp
   * @description Does not price tokens not paired with dollar stables or CTez
   */
  private async _calculatePrice(ts: number, pair: Pair, type: PricingType): Promise<[BigNumber, BigNumber]> {
    try {
      let token1Price = await this._getPriceAt(ts, pair.token1.data.symbol);
      let token2Price = await this._getPriceAt(ts, pair.token2.data.symbol);

      // For storage-based pricing use the token reserves, and for swap-based use the transaction token-amount
      const token1Base = type === PricingType.STORAGE ? pair.token1.pool : pair.token1.amount;
      const token2Base = type === PricingType.STORAGE ? pair.token2.pool : pair.token2.amount;

      // If one of the tokens is a stablecoin, then use it as the dollar base.
      if (constants.DOLLAR_STABLECOINS.includes(pair.token1.data.symbol)) {
        token1Price = new BigNumber(1);
        token2Price = new BigNumber(token1Base).dividedBy(token2Base);
      } else if (constants.DOLLAR_STABLECOINS.includes(pair.token2.data.symbol)) {
        token2Price = new BigNumber(1);
        token1Price = new BigNumber(token2Base).dividedBy(token1Base);
      } // Price in terms of CTez
      else if (pair.token1.data.symbol === "CTez") {
        token1Price = await this._getPriceAt(ts, pair.token1.data.symbol);
        token2Price = new BigNumber(token1Base).multipliedBy(token1Price).dividedBy(token2Base);
      } else if (pair.token2.data.symbol === "CTez") {
        token2Price = await this._getPriceAt(ts, pair.token2.data.symbol);
        token1Price = new BigNumber(token2Base).multipliedBy(token2Price).dividedBy(token1Base);
      }

      return [token1Price, token2Price];
    } catch (err) {
      throw err;
    }
  }

  //===========
  // Utilities
  //===========

  /**
   * @description Finds the token amount involved in an operation
   */
  private _getTokenAmountFromOperation(token: Token, operation: Transaction[], index: number): number {
    switch (token.standard) {
      case TokenStandard.TEZ: {
        // Keep looping until a transaction with non-zero tez amount is found.
        // This is valid only for tez-ctez pool
        while (true) {
          if (operation[index].amount !== 0) {
            return new BigNumber(operation[index].amount).dividedBy(10 ** token.decimals).toNumber();
          }
          index++;
        }
      }
      case TokenStandard.FA2: {
        // Keep looping until a txn involving the FA2 token transfer is found.
        while (true) {
          if (
            operation[index].target.address === token.address &&
            operation[index].parameter.entrypoint === "transfer" &&
            Array.isArray(operation[index].parameter.value) &&
            operation[index].parameter.value[0].txs[0].token_id === token.tokenId.toString()
          ) {
            // Return the amount of FA2 token involved in the txn
            return new BigNumber(operation[index].parameter.value[0].txs[0].amount)
              .dividedBy(10 ** token.decimals)
              .toNumber();
          }
          index++;
        }
      }
      case TokenStandard.FA12: {
        // Keep looping until a txn involving the FA1.2 token transfer is found.
        while (true) {
          if (
            operation[index].target.address === token.address &&
            operation[index].parameter.entrypoint === "transfer"
          ) {
            // Return the amount of FA1.2 token involved in the txn
            return new BigNumber(operation[index].parameter.value.value).dividedBy(10 ** token.decimals).toNumber();
          }
          index++;
        }
      }
    }
  }

  /**
   * @description Calculate the token pair reserves
   */
  private _getTokenPoolFromStorage(txn: Transaction, pool: Pool): [number, number] {
    // Get the token reserves from storage (volatile || stable || tez-ctez)
    const token1Pool = txn.storage.token1Pool || txn.storage.token1_pool || txn.storage.tezPool;
    const token2Pool = txn.storage.token2Pool || txn.storage.token2_pool || txn.storage.ctezPool;

    // Get the numeric scaled down values
    const token1PoolNumeric = new BigNumber(token1Pool).dividedBy(10 ** pool.token1.decimals);
    const token2PoolNumeric = new BigNumber(token2Pool).dividedBy(10 ** pool.token2.decimals);

    return [token1PoolNumeric.toNumber(), token2PoolNumeric.toNumber()];
  }

  /**
   * @description fetches the hashes of swap and liquidity operations on the pool
   */
  private async _getOperationHashes(poolAddress: string): Promise<string[]> {
    try {
      const [firstLevel, lastLevel] = await this._getIndexingLevels(poolAddress);
      let offset = 0;
      let operationHashes: string[] = [];
      while (true) {
        const hashes = await this._tkztProvider.getTransactions<string[]>({
          contract: poolAddress,
          entrypoint: [
            ...constants.SWAP_ENTRYPOINTS,
            ...constants.ADD_LIQUIDITY_ENTRYPOINTS,
            ...constants.REMOVE_LIQUIDITY_ENTRYPOINS,
          ],
          firstLevel,
          lastLevel,
          limit: this._config.tzktLimit,
          offset,
          select: "hash",
        });
        if (hashes.length === 0) {
          break;
        } else {
          operationHashes = operationHashes.concat(hashes);
          offset += this._config.tzktOffset;
        }
      }
      return operationHashes;
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description fetches the spot price of a token at a specific timestamp
   */
  private async _getPriceAt(ts: number, tokenSymbol: string): Promise<BigNumber> {
    if (constants.DOLLAR_STABLECOINS.includes(tokenSymbol)) {
      return new BigNumber(1);
    } else {
      try {
        const _entry = await this._dbClient.get({
          table: "price_spot",
          select: "value",
          where: `
            token='${tokenSymbol}'
             AND
            ts=(SELECT MAX(ts) FROM price_spot WHERE token='${tokenSymbol}' AND ts<=${ts})  
          `,
        });
        if (_entry.rowCount === 0) {
          return new BigNumber(0);
        } else {
          return new BigNumber(_entry.rows[0].value);
        }
      } catch (err) {
        throw err;
      }
    }
  }

  /**
   * @description returns the level interval between which the pool swaps need to be indexed.
   * The first level is the level at which USDC.e-ctez pair had the first swap.
   */
  private async _getIndexingLevels(poolAddress: string): Promise<[number, number]> {
    try {
      const _entry = await this._dbClient.get({
        table: "last_indexed",
        select: "level",
        where: `pool='${poolAddress}'`,
      });
      if (_entry.rowCount === 0) {
        return [parseInt(this._config.indexingStart), this._lastLevel];
      } else {
        return [parseInt(_entry.rows[0].level) + 1, this._lastLevel];
      }
    } catch (err) {
      throw err;
    }
  }
}
