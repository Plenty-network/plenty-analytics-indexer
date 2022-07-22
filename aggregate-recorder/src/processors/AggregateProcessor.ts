import BigNumber from "bignumber.js";
import DatabaseClient from "../infrastructure/DatabaseClient";
import TzktProvider from "../infrastructure/TzktProvider";
import {
  Data,
  Pair,
  Token,
  Config,
  AmmType,
  PricingType,
  Dependecies,
  Transaction,
  AmmContract,
  PlentyRecord,
  TokenVariant,
  AggregateType,
  TransactionType,
  TransactionRecord,
} from "../types";
import { constants } from "../constants";

export default class AggregateProcessor {
  private _config: Config;
  private _dbClient: DatabaseClient;
  private _tkztProvider: TzktProvider;
  private _data: Data;
  private _lastLevel: number;

  constructor({ config, dbClient, tzktProvider, data }: Dependecies) {
    this._config = config;
    this._dbClient = dbClient;
    this._tkztProvider = tzktProvider;
    this._data = data;
  }

  async process(lastLevel: number): Promise<void> {
    // Last level received by the block-watcher
    this._lastLevel = lastLevel;
    try {
      for (const ammAddress of Object.keys(this._data.amm)) {
        // Fetch hashes of all operations on the amm that involve a swap
        const operationHashes = await this._getOperationHashes(ammAddress);

        for (const hash of operationHashes) {
          // Fetch individual operations and process them
          const operation = await this._tkztProvider.getOperation(hash);
          await this._processOperation(operation, this._data.amm[ammAddress]);
          // Record the indexed level
          await this._recordLastIndexed(this._data.amm[ammAddress], operation[0].level);
        }
      }
    } catch (err) {
      throw err;
    }
  }

  //======================
  // Transaction handlers
  //======================

  /**
   * @description processes each transaction in an operation. A transaction can be
   * swap, add-liquidity or remove-liquidity transaction.
   */
  private async _processOperation(operation: Transaction[], amm: AmmContract): Promise<void> {
    try {
      for (const [index, txn] of operation.entries()) {
        if (txn.target?.address === amm.address) {
          if (constants.TXN_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
            // Pair token amount involved in the transaction
            const token1Amount = this._getTokenAmountFromOperation(amm.token1, operation, index);
            const token2Amount = this._getTokenAmountFromOperation(amm.token2, operation, index);

            // Pair token reserves during the transaction
            const [token1Pool, token2Pool] = this._getTokenPoolFromStorage(txn, amm);

            const pair: Pair = {
              token1: amm.token1,
              token1Pool,
              token1Amount,
              token2: amm.token2,
              token2Pool,
              token2Amount,
            };

            // Handle the transaction and pair based on the transaction type
            if (constants.ADD_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              await this._processLiquidityOperation(txn, pair, amm, TransactionType.ADD_LIQUIDITY);
            } else if (constants.SWAP_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              await this._processSwapOperation(txn, pair, amm);
            } else if (constants.REMOVE_LIQUIDITY_ENTRYPOINS.includes(txn.parameter?.entrypoint)) {
              await this._processLiquidityOperation(txn, pair, amm, TransactionType.REMOVE_LIQUIDITY);
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
  private async _processLiquidityOperation(
    txn: Transaction,
    pair: Pair,
    amm: AmmContract,
    type: TransactionType
  ): Promise<void> {
    try {
      // Bring transaction timestamp to a suitable form
      const ts = Math.floor(new Date(txn.timestamp).getTime() / 1000);

      let token1Price: number, token2Price: number;

      // If it's a volatile pair, calculate the token prices from the reserves
      if (amm.type === AmmType.VOLATILE) {
        [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.STORAGE);
      } else {
        // else for stable pairs, get the last record price of each token
        token1Price = await this._getPriceAt(ts, amm.token1.symbol);
        token2Price = await this._getPriceAt(ts, amm.token2.symbol);

        // If any one of the token does not have a recorded price,
        // assume that it's a fresh liquidity addition and try getting the price through reserves
        if (token1Price === 0 || token2Price === 0) {
          [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.STORAGE);
        }
      }

      // Record spot price of the tokens (USDC.e is not recorded since it is priced at $1 all times)
      if (amm.token1.symbol !== "USDC.e") await this._recordSpotPrice(ts, amm.token1, token1Price);
      if (amm.token2.symbol !== "USDC.e") await this._recordSpotPrice(ts, amm.token2, token2Price);

      // Record the liquidity transaction
      await this._dbClient.insert({
        table: `${type.toLowerCase()}`,
        columns: `(
          id,
          ts,
          hash,
          amm,
          account,
          token_1_amount,
          token_2_amount,
          value
        )`,
        values: `(
          ${txn.id},
          ${ts},
          '${txn.hash}',
          '${amm.address}',
          '${txn.initiator?.address ?? txn.sender?.address}',
          ${pair.token1Amount},
          ${pair.token2Amount},
          ${pair.token1Amount * token1Price + pair.token2Amount * token2Price}
        )`,
      });

      // Record hourly aggregate data for the tokens in the pair
      await this._recordTokenAggregate({
        ts,
        type,
        aggregateType: AggregateType.HOUR,
        amm: amm,
        token1: {
          pool: pair.token1Pool,
          amount: pair.token1Amount,
          price: token1Price,
        },
        token2: {
          pool: pair.token2Pool,
          amount: pair.token2Amount,
          price: token2Price,
        },
      });

      // Record daily aggregate data for the tokens in the pair
      await this._recordTokenAggregate({
        ts,
        type,
        aggregateType: AggregateType.DAY,
        amm: amm,
        token1: {
          pool: pair.token1Pool,
          amount: pair.token1Amount,
          price: token1Price,
        },
        token2: {
          pool: pair.token2Pool,
          amount: pair.token2Amount,
          price: token2Price,
        },
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description processes a swap transaction and records the aggregate data.
   */
  private async _processSwapOperation(txn: Transaction, pair: Pair, amm: AmmContract): Promise<void> {
    try {
      // Bring transaction timestamp to a suitable form
      const ts = Math.floor(new Date(txn.timestamp).getTime() / 1000);

      let token1Price: number, token2Price: number;

      let type: TransactionType;

      // Decide transaction type based on whether token 1 is swapped for token 2 or vice versa
      if (amm.address === constants.TEZ_CTEZ_AMM_ADDRESS) {
        if (txn.parameter.entrypoint === constants.TEZ_SWAP_ENTRYPOINT) {
          type = TransactionType.SWAP_TOKEN_1; // token 1 is swapped for token 2
        } else {
          type = TransactionType.SWAP_TOKEN_2; // token 2 is swapped for token 1
        }
      } else if (
        txn.parameter.value.requiredTokenAddress === amm.token2.address &&
        txn.parameter.value.requiredTokenId === (amm.token2.tokenId?.toString() ?? "0")
      ) {
        type = TransactionType.SWAP_TOKEN_1;
      } else {
        type = TransactionType.SWAP_TOKEN_2;
      }

      // For volatile pairs, use the token reserves (token-pool) to calculate price
      if (amm.type === AmmType.VOLATILE) {
        [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.STORAGE);
      } else {
        // For stable pairs, use the swap values (token-amount), since there is negligible slippage
        [token1Price, token2Price] = await this._calculatePrice(ts, pair, PricingType.SWAP);
      }

      // Record spot price of the tokens (USDC.e is not recorded since it is priced at $1 all times)
      if (amm.token1.symbol !== "USDC.e") await this._recordSpotPrice(ts, amm.token1, token1Price);
      if (amm.token2.symbol !== "USDC.e") await this._recordSpotPrice(ts, amm.token2, token2Price);

      // This is true if token 1 is swapped for token 2
      const isSwap1 = type === TransactionType.SWAP_TOKEN_1;

      // Record the swap
      await this._dbClient.insert({
        table: "swap",
        columns: `(
          id,
          ts,
          hash,
          amm,
          account,
          is_swap_1,
          token_1_amount,
          token_2_amount,
          value
        )`,
        values: `(
          ${txn.id},
          ${ts},
          '${txn.hash}',
          '${amm.address}',
          '${txn.initiator?.address ?? txn.sender?.address}',
          ${isSwap1},   
          ${pair.token1Amount},
          ${pair.token2Amount},
          ${isSwap1 ? pair.token1Amount * token1Price : pair.token2Amount * token2Price}
        )`,
      });

      // Record hourly aggregate data for the tokens in the pair
      await this._recordTokenAggregate({
        ts,
        type,
        aggregateType: AggregateType.HOUR,
        amm: amm,
        token1: {
          pool: pair.token1Pool,
          amount: pair.token1Amount,
          price: token1Price,
        },
        token2: {
          pool: pair.token2Pool,
          amount: pair.token2Amount,
          price: token2Price,
        },
      });

      // Record hourly aggregate data for the tokens in the pair
      await this._recordTokenAggregate({
        ts,
        type,
        aggregateType: AggregateType.DAY,
        amm: amm,
        token1: {
          pool: pair.token1Pool,
          amount: pair.token1Amount,
          price: token1Price,
        },
        token2: {
          pool: pair.token2Pool,
          amount: pair.token2Amount,
          price: token2Price,
        },
      });
    } catch (err) {
      throw err;
    }
  }

  //===================
  // Value calculators
  //===================

  /**
   * @description Calculate the spot price of a token pair at a given timestamp
   */
  private async _calculatePrice(ts: number, pair: Pair, type: PricingType): Promise<[number, number]> {
    try {
      let token1Price: number;
      let token2Price: number;

      // For storage-based pricing use the token reserves, and for swap-based use the transaction token-amount
      const token1Base = type === PricingType.STORAGE ? pair.token1Pool : pair.token1Amount;
      const token2Base = type === PricingType.STORAGE ? pair.token2Pool : pair.token2Amount;

      // If USDC is one of the tokens, then use it as the dollar base.
      if (pair.token1.symbol === "USDC.e") {
        token1Price = 1;
        token2Price = token1Base / token2Base;
      } else if (pair.token2.symbol === "USDC.e") {
        token2Price = 1;
        token1Price = token2Base / token1Base;
      } else {
        // else use any one of the tokens that has a non-zero value
        token2Price = await this._getPriceAt(ts, pair.token2.symbol);
        if (token2Price !== 0) {
          token1Price = (token2Base * token2Price) / token1Base;
        } else {
          token1Price = await this._getPriceAt(ts, pair.token1.symbol);
          token2Price = (token1Base * token1Price) / token2Base;
        }
      }

      return [token1Price, token2Price];
    } catch (err) {
      throw err;
    }
  }

  //=====================
  // Assisting recorders
  //=====================

  /**
   * @description Records token specific analytics data in token_aggregate_X tables and calls
   * _recordPlentyAggregate to record system wide analytics data, and _recordAMMAggregate to record
   * AMM specific analytics data.
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

        const price = txr[`token${N}`].price;
        const tokenAmount = txr[`token${N}`].amount;

        // The total dollar value of token involved in the txn
        const tokenValue = price * tokenAmount;

        // Fees calculated as 0.35% of stable trade value and 0.1% of volatile trade value
        const feesAmount = txr.amm.type === AmmType.VOLATILE ? tokenAmount / 1000 : tokenAmount / 290;
        const feesvalue = txr.amm.type === AmmType.VOLATILE ? tokenValue / 1000 : tokenValue / 290;

        const lockedAmount = txr[`token${N}`].pool;
        const lockedValue = lockedAmount * price;

        const _entry = await this._dbClient.get({
          table,
          select: "*",
          where: `ts=${ts} AND token='${txr.amm[`token${N}`].symbol}'`,
        });

        // If no existing entry present for the timestamp, then insert a fresh record
        if (_entry.rowCount === 0) {
          // Get last entry i.e the maximum timestamp registered till now
          const _entryMax = await this._dbClient.get({
            table,
            select: "MAX(ts)",
            where: `token='${txr.amm[`token${N}`].symbol}'`,
          });

          let lockedPrev = 0;

          // If there is a last entry then get its locked value
          if (_entryMax.rows[0].max) {
            const __entry = await this._dbClient.get({
              table,
              select: "*",
              where: `ts=${_entryMax.rows[0].max} AND token='${txr.amm[`token${N}`].symbol}'`,
            });
            lockedPrev = parseFloat(__entry.rows[0].locked_value);
          }

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
              fees_value, 
              locked, 
              locked_value
            )`,
            values: `(
            ${ts}, 
            '${txr.amm[`token${N}`].symbol}', 
            ${price}, 
            ${price}, 
            ${price}, 
            ${price}, 
            ${isSwapIn ? tokenAmount : 0},
            ${isSwapIn ? tokenValue : 0},
            ${isSwapIn ? feesAmount : 0},
            ${isSwapIn ? feesvalue : 0}, 
            ${lockedAmount}, 
            ${lockedValue}
          )`,
          });

          // Record system wide aggregate
          await this._recordPlentyAggregate({
            ts,
            aggregateType: txr.aggregateType,
            tradeValue: isSwapIn ? tokenValue : 0,
            feesValue: isSwapIn ? feesvalue : 0,
            lockedPrev,
            locked: lockedValue,
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
              fees_value=${isSwapIn ? _entryFeesValue + feesvalue : _entryFeesValue}, 
              locked=${lockedAmount}, 
              locked_value=${lockedValue}
          `,
            where: `ts=${ts} AND token='${txr.amm[`token${N}`].symbol}'`,
          });

          // Record system wide aggregate
          await this._recordPlentyAggregate({
            ts,
            aggregateType: txr.aggregateType,
            tradeValue: isSwapIn ? tokenValue : 0,
            feesValue: isSwapIn ? feesvalue : 0,
            lockedPrev: _entry.rows[0].locked_value,
            locked: lockedValue,
          });
        }
      }

      // Record AMM specific data
      await this._recordAMMAggregate(txr);
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Records system wide aggregate across all plenty AMMs
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
        // Retrieve the last record i.e the row with max ts
        const _entryMax = await this._dbClient.get({
          table,
          select: "MAX(ts)",
          where: `ts!=0`,
        });

        if (!_entryMax.rows[0].max) {
          // First entry in plenty_aggregate
          await this._dbClient.insert({
            table,
            columns: `(
              ts, 
              volume_value, 
              fees_value, 
              locked_value
            )`,
            values: `(
              ${plr.ts}, 
              ${plr.tradeValue}, 
              ${plr.feesValue}, 
              ${plr.locked}
            )`,
          });
        } else {
          // Get existing locked value
          const __entry = await this._dbClient.get({
            table,
            select: "locked_value",
            where: `ts=${_entryMax.rows[0].max}`,
          });

          const __entryLockedValue = parseFloat(__entry.rows[0].locked_value);

          // Previous locked value (received from token-aggregate table) is subtracted and
          // latest locked value is added to account for token price and amount difference across time
          await this._dbClient.insert({
            table,
            columns: `(
              ts, 
              volume_value, 
              fees_value, 
              locked_value
            )`,
            values: `(
              ${plr.ts}, 
              ${plr.tradeValue}, 
              ${plr.feesValue}, 
              ${__entryLockedValue - plr.lockedPrev + plr.locked}
            )`,
          });
        }
      } else {
        // Existing values for each field at a given timestamp
        const _entryVolumeValue = parseFloat(_entry.rows[0].volume_value);
        const _entryFeesValue = parseFloat(_entry.rows[0].fees_value);
        const _entryLockedValue = parseFloat(_entry.rows[0].locked_value);

        // Add volume and fees to existing values and
        // update the locked value as described above
        await this._dbClient.update({
          table,
          set: ` 
            volume_value=${_entryVolumeValue + plr.tradeValue}, 
            fees_value=${_entryFeesValue + plr.feesValue}, 
            locked_value=${_entryLockedValue - plr.lockedPrev + plr.locked}
          `,
          where: `ts=${plr.ts}`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  private async _recordAMMAggregate(txr: TransactionRecord): Promise<void> {
    try {
      const table = `amm_aggregate_${txr.aggregateType.toLowerCase()}`;

      // Get the start timestamp (UTC) of the hour/day in which txn timestamp is present
      const ts =
        txr.aggregateType === AggregateType.HOUR
          ? Math.floor(txr.ts / 3600) * 3600
          : Math.floor(txr.ts / 86400) * 86400;

      // Set to true if either token 1 or token 2 is swapped in
      const isToken1Swap = txr.type === TransactionType.SWAP_TOKEN_1;
      const isToken2Swap = txr.type === TransactionType.SWAP_TOKEN_2;

      // Possible volume and fees for token 1
      const token1Amount = txr.token1.amount;
      const token1Value = token1Amount * txr.token1.price;
      const token1FeesAmount = txr.amm.type === AmmType.VOLATILE ? token1Amount / 1000 : token1Amount / 290;
      const token1FeesValue = txr.amm.type === AmmType.VOLATILE ? token1Value / 1000 : token1Value / 290;

      // Possible volume and fees for token 2
      const token2Amount = txr.token2.amount;
      const token2Value = token2Amount * txr.token2.price;
      const token2FeesAmount = txr.amm.type === AmmType.VOLATILE ? token2Amount / 1000 : token2Amount / 290;
      const token2FeesValue = txr.amm.type === AmmType.VOLATILE ? token2Value / 1000 : token2Value / 290;

      const _entry = await this._dbClient.get({
        table,
        select: "*",
        where: `ts=${ts} AND amm='${txr.amm.address}'`,
      });

      // Set volume and fees based on it's a token 1 or token 2 swap in
      if (_entry.rowCount === 0) {
        await this._dbClient.insert({
          table,
          columns: `(
            ts,
            amm,
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
            '${txr.amm.address}',
            ${isToken1Swap ? token1Amount : 0},
            ${isToken1Swap ? token1Value : 0},
            ${isToken2Swap ? token2Amount : 0},
            ${isToken2Swap ? token2Value : 0},
            ${isToken1Swap ? token1FeesAmount : 0},
            ${isToken1Swap ? token1FeesValue : 0},
            ${isToken2Swap ? token2FeesAmount : 0},
            ${isToken2Swap ? token2FeesValue : 0},
            ${txr.token1.pool},
            ${txr.token1.pool * txr.token1.price},
            ${txr.token2.pool},
            ${txr.token2.pool * txr.token2.price}
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
            token_1_locked=${txr.token1.pool},
            token_1_locked_value=${txr.token1.pool * txr.token1.price},
            token_2_locked=${txr.token2.pool},
            token_2_locked_value=${txr.token2.pool * txr.token2.price}
          `,
          where: `ts=${ts} AND amm='${txr.amm.address}'`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Simply records the price of a token at a given timestamp in price_spot table.
   */
  private async _recordSpotPrice(ts: number, token: Token, price: number): Promise<void> {
    try {
      const _entry = await this._dbClient.get({
        table: "price_spot",
        select: "token",
        where: `ts=${ts} AND token='${token.symbol}'`,
      });

      if (_entry.rowCount !== 0) {
        await this._dbClient.update({
          table: "price_spot",
          set: `value=${price}`,
          where: `ts=${ts} AND token='${token.symbol}'`,
        });
      } else {
        await this._dbClient.insert({
          table: "price_spot",
          columns: "(ts, token, value)",
          values: `(${ts}, '${token.symbol}', ${price})`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description inserts the last processed level into the db
   */
  private async _recordLastIndexed(amm: AmmContract, level: number): Promise<void> {
    try {
      const _entry = await this._dbClient.get({
        select: "*",
        table: "last_indexed",
        where: `amm='${amm.address}'`,
      });

      if (_entry.rowCount !== 0) {
        await this._dbClient.update({
          table: "last_indexed",
          set: `level=${level}`,
          where: `amm='${amm.address}'`,
        });
      } else {
        await this._dbClient.insert({
          table: "last_indexed",
          columns: `(amm, level)`,
          values: `('${amm.address}', ${level})`,
        });
      }
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
    switch (token.variant) {
      case TokenVariant.TEZ: {
        // Keep looping until a transaction with non-zero tez amount is found.
        // This is valid only for tez-ctez amm
        while (true) {
          if (operation[index].amount !== 0) {
            return new BigNumber(operation[index].amount).dividedBy(10 ** token.decimals).toNumber();
          }
          index++;
        }
      }
      case TokenVariant.FA2: {
        // Keep looping until a txn involving the FA2 token transfer is found.
        while (true) {
          if (
            operation[index].target.address === token.address &&
            operation[index].parameter.entrypoint === "transfer" &&
            Array.isArray(operation[index].parameter.value)
          ) {
            // Return the amount of FA2 token involved in the txn
            return new BigNumber(operation[index].parameter.value[0].txs[0].amount)
              .dividedBy(10 ** token.decimals)
              .toNumber();
          }
          index++;
        }
      }
      case TokenVariant.FA12: {
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
  private _getTokenPoolFromStorage(txn: Transaction, amm: AmmContract): [number, number] {
    // Get the token reserves from storage (volatile || stable || tez-ctez)
    const token1Pool = txn.storage.token1Pool || txn.storage.token1_pool || txn.storage.tezPool;
    const token2Pool = txn.storage.token2Pool || txn.storage.token2_pool || txn.storage.ctezPool;

    // Get the numeric scaled down values
    const token1PoolNumeric = new BigNumber(token1Pool).dividedBy(10 ** amm.token1.decimals);
    const token2PoolNumeric = new BigNumber(token2Pool).dividedBy(10 ** amm.token2.decimals);

    return [token1PoolNumeric.toNumber(), token2PoolNumeric.toNumber()];
  }

  /**
   * @description fetches the hashes of swap and liquidity operations on the AMM
   */
  private async _getOperationHashes(ammAddress: string): Promise<string[]> {
    try {
      const [firstLevel, lastLevel] = await this._getIndexingLevels(ammAddress);
      let offset = 0;
      let operationHashes: string[] = [];
      while (true) {
        const hashes = await this._tkztProvider.getTransactions<string[]>({
          contract: ammAddress,
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
  private async _getPriceAt(ts: number, tokenSymbol: string): Promise<number> {
    if (tokenSymbol === "USDC.e") {
      return 1;
    } else {
      try {
        const _entry = await this._dbClient.get({
          table: "price_spot",
          select: "value",
          where: `ts<=${ts} AND token='${tokenSymbol}'`,
        });
        if (_entry.rowCount === 0) {
          return 0;
        } else {
          return parseFloat(_entry.rows[0].value);
        }
      } catch (err) {
        throw err;
      }
    }
  }

  /**
   * @description returns the level interval between which the amm swaps need to be indexed.
   * The first level is the level at which USDC.e-ctez pair had the first swap.
   */
  private async _getIndexingLevels(ammAddress: string): Promise<[number, number]> {
    try {
      const _entry = await this._dbClient.get({
        table: "last_indexed",
        select: "level",
        where: `amm='${ammAddress}'`,
      });
      if (_entry.rowCount === 0) {
        return [constants.INDEXING_START_LEVEL, this._lastLevel];
      } else {
        return [_entry.rows[0].level + 1, this._lastLevel];
      }
    } catch (err) {
      throw err;
    }
  }
}
