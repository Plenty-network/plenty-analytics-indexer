import {
  Pools,
  Config,
  PoolV2,
  Period,
  Dependecies,
  Transaction,
  TransactionType,
  PlentyV2Transaction,
} from "../types";
import {
  getPriceAt,
  getLastLevel,
  calculatePrice,
  recordLastLevel,
  getTokenReserveFromStorage,
  getTokenAmountFromOperation,
} from "../utils";
import BigNumber from "bignumber.js";
import * as constants from "../constants";
import TzktProvider from "../infrastructure/TzktProvider";
import DatabaseClient from "../infrastructure/DatabaseClient";

BigNumber.set({ EXPONENTIAL_AT: 36 });
BigNumber.set({ DECIMAL_PLACES: 12 });

export default class AggregateProcessor {
  private _config: Config;
  private _dbClient: DatabaseClient;
  private _tkztProvider: TzktProvider;
  private _getPools: () => Promise<Pools>;

  constructor({ config, dbClient, tzktProvider, getPools }: Dependecies) {
    this._config = config;
    this._getPools = getPools;
    this._dbClient = dbClient;
    this._tkztProvider = tzktProvider;
  }

  async process(lastLevel: number): Promise<void> {
    const pools = await this._getPools();

    let level;
    let currentPool;
    let currentOperation;

    try {
      for (level = getLastLevel() + 1; level <= lastLevel; level++) {
        // Process v2 pool transactions
        for (const pool of pools.v2) {
          currentPool = pool.address;
          const operationHashes = await this._getOperationHashes(pool.address, level);
          for (const hash of operationHashes) {
            const operation = await this._tkztProvider.getOperation(hash);
            currentOperation = hash;
            await this._processOperationV2(operation, pool);
          }
        }
        recordLastLevel(level);
      }
    } catch (err) {
      throw new Error(`
        Error: ${err.message},\n
        Last Pool: ${currentPool},\n
        Last Level: ${level}\n
        Last opHash: ${currentOperation}\n
      `);
    }
  }

  private async _processOperationV2(operation: Transaction[], pool: PoolV2): Promise<void> {
    try {
      for (const [index, txn] of operation.entries()) {
        if (txn.target?.address === pool.address) {
          if (constants.TXN_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
            // Check if the txn is already processed in the past
            // (can happen if pool is called multiple times in a batch)
            const _entry = await this._dbClient.get({
              table: "transaction",
              select: "id",
              where: `id=${txn.id}`,
            });
            if (_entry.rowCount !== 0) return;

            // Individual token amounts involved in the operation
            const token1Amount = getTokenAmountFromOperation(pool.token1, operation, index);
            const token2Amount = getTokenAmountFromOperation(pool.token2, operation, index);

            // Pair token reserves during the transaction
            const [token1Reserve, token2Reserve] = getTokenReserveFromStorage(txn, pool);

            const plentyV2Txn: PlentyV2Transaction = {
              id: txn.id,
              hash: txn.hash,
              timestamp: Math.floor(new Date(txn.timestamp).getTime() / 1000),
              account: txn.initiator?.address ?? txn.sender.address,
              pool,
              reserves: { token1: token1Reserve, token2: token2Reserve },
              txnType: TransactionType.ADD_LIQUIDITY, // May potentially change below
              txnAmounts: { token1: token1Amount, token2: token2Amount },
              txnFees: { token1: token1Amount.dividedBy(pool.fees), token2: token2Amount.dividedBy(pool.fees) },
              txnPrices: { token1: constants.ZERO_VAL, token2: constants.ZERO_VAL },
              txnValue: { token1: constants.ZERO_VAL, token2: constants.ZERO_VAL },
              txnFeesValue: { token1: constants.ZERO_VAL, token2: constants.ZERO_VAL },
            };

            // Token prices
            const [token1Price, token2Price] = await calculatePrice(this._dbClient, plentyV2Txn);

            // Record spot price of the tokens
            await this._recordSpotPrice(plentyV2Txn.timestamp, plentyV2Txn.pool.token1.symbol, token1Price);
            await this._recordSpotPrice(plentyV2Txn.timestamp, plentyV2Txn.pool.token2.symbol, token2Price);

            plentyV2Txn.txnPrices = { token1: token1Price, token2: token2Price };
            plentyV2Txn.txnValue = {
              token1: token1Amount.multipliedBy(token1Price),
              token2: token2Amount.multipliedBy(token2Price),
            };
            plentyV2Txn.txnFeesValue = {
              token1: plentyV2Txn.txnValue.token1.dividedBy(pool.fees),
              token2: plentyV2Txn.txnValue.token2.dividedBy(pool.fees),
            };

            // Set txn type based on entrypoint called
            if (constants.ADD_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              plentyV2Txn.txnType = TransactionType.ADD_LIQUIDITY;
            }
            // Swaps
            else if (constants.SWAP_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              // Decide transaction type based on whether token 1 is swapped for token 2 or vice versa
              if (plentyV2Txn.pool.address === this._config.tezCtezPool) {
                if (txn.parameter.entrypoint === constants.TEZ_SWAP_ENTRYPOINT) {
                  plentyV2Txn.txnType = TransactionType.SWAP_TOKEN_1; // token 1 is swapped for token 2
                } else {
                  plentyV2Txn.txnType = TransactionType.SWAP_TOKEN_2; // token 2 is swapped for token 1
                }
              } else if (
                txn.parameter.value.requiredTokenAddress === plentyV2Txn.pool.token1.address &&
                txn.parameter.value.requiredTokenId === (plentyV2Txn.pool.token1.tokenId?.toString() ?? "0")
              ) {
                plentyV2Txn.txnType = TransactionType.SWAP_TOKEN_2;
              } else {
                plentyV2Txn.txnType = TransactionType.SWAP_TOKEN_1;
              }
            } else if (constants.REMOVE_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              plentyV2Txn.txnType = TransactionType.REMOVE_LIQUIDITY;
            }

            await this._recordTransaction(plentyV2Txn);

            // Don't record aggregate values if any of the tokens is unpriced
            if (token1Price.isEqualTo(0) || token2Price.isEqualTo(0)) {
              continue;
            }

            const oldReserveToken1 =
              plentyV2Txn.txnType === TransactionType.SWAP_TOKEN_1 ||
              plentyV2Txn.txnType === TransactionType.ADD_LIQUIDITY
                ? token1Reserve.minus(token1Amount)
                : token1Reserve.plus(token1Amount);

            const oldReserveToken2 =
              plentyV2Txn.txnType === TransactionType.SWAP_TOKEN_2 ||
              plentyV2Txn.txnType === TransactionType.ADD_LIQUIDITY
                ? token2Reserve.minus(token2Amount)
                : token2Reserve.plus(token2Amount);

            await this._recordToken(plentyV2Txn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.HOUR);
            await this._recordToken(plentyV2Txn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.DAY);
            await this._recordPlenty(plentyV2Txn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.HOUR);
            await this._recordPlenty(plentyV2Txn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.DAY);
            await this._recordPool(plentyV2Txn, Period.HOUR);
            await this._recordPool(plentyV2Txn, Period.DAY);
          }
        }
      }
    } catch (err) {
      throw err;
    }
  }

  private async _recordTransaction(txn: PlentyV2Transaction) {
    try {
      const value =
        txn.txnType === TransactionType.ADD_LIQUIDITY || txn.txnType === TransactionType.REMOVE_LIQUIDITY
          ? txn.txnValue.token1.plus(txn.txnValue.token2)
          : txn.txnType === TransactionType.SWAP_TOKEN_1
          ? txn.txnValue.token1
          : txn.txnValue.token2;

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
          ${txn.timestamp},
          '${txn.hash}',
          '${txn.pool.address}',
          '${txn.account}',
          '${txn.txnType}',
          ${txn.txnAmounts.token1},
          ${txn.txnAmounts.token2},
          ${value.toString()}
        )`,
      });
    } catch (err: any) {
      throw err;
    }
  }

  private async _recordPool(txn: PlentyV2Transaction, period: Period) {
    try {
      const table = `pool_aggregate_${period.toLowerCase()}`;

      // Get the start timestamp (UTC) of the hour/day in which txn timestamp is present
      const ts =
        period === Period.HOUR ? Math.floor(txn.timestamp / 3600) * 3600 : Math.floor(txn.timestamp / 86400) * 86400;

      // Set to true if either token 1 or token 2 is swapped in
      const isToken1Swap = txn.txnType === TransactionType.SWAP_TOKEN_1;
      const isToken2Swap = txn.txnType === TransactionType.SWAP_TOKEN_2;

      const _entry = await this._dbClient.get({
        table,
        select: "*",
        where: `ts=${ts} AND pool='${txn.pool.address}'`,
      });

      // Set volume and fees based on it's a token 1 or token 2 swap in
      if (_entry.rowCount === 0) {
        await this._dbClient.insert({
          table,
          columns: `(
            ts,
            pool,
            token_1_volume,
            token_2_volume,
            volume_value,
            token_1_fees,
            token_2_fees,
            fees_value,
            token_1_locked,
            token_2_locked,
            locked_value
          )`,
          values: `(
            ${ts},
            '${txn.pool.address}',
            ${isToken1Swap ? txn.txnAmounts.token1.toString() : 0},
            ${isToken2Swap ? txn.txnAmounts.token2.toString() : 0},
            ${isToken1Swap ? txn.txnValue.token1.toString() : isToken2Swap ? txn.txnValue.token2.toString() : 0},
            ${isToken1Swap ? txn.txnFees.token1.toString() : 0},
            ${isToken2Swap ? txn.txnFees.token2.toString() : 0},
            ${
              isToken1Swap ? txn.txnFeesValue.token1.toString() : isToken2Swap ? txn.txnFeesValue.token2.toString() : 0
            },
            ${txn.reserves.token1},
            ${txn.reserves.token2},
            ${txn.reserves.token1
              .multipliedBy(txn.txnPrices.token1)
              .plus(txn.reserves.token2.multipliedBy(txn.txnPrices.token2))
              .toString()}
          )`,
        });
      } else {
        // Existing values of the fields
        const _entryToken1Volume = new BigNumber(parseFloat(_entry.rows[0].token_1_volume));
        const _entryToken2Volume = new BigNumber(parseFloat(_entry.rows[0].token_2_volume));
        const _entryVolumeValue = new BigNumber(parseFloat(_entry.rows[0].volume_value));
        const _entryToken1Fees = new BigNumber(parseFloat(_entry.rows[0].token_1_fees));
        const _entryToken2Fees = new BigNumber(parseFloat(_entry.rows[0].token_2_fees));
        const _entryFeesValue = new BigNumber(parseFloat(_entry.rows[0].fees_value));

        await this._dbClient.update({
          table,
          set: `
            token_1_volume=${
              isToken1Swap ? _entryToken1Volume.plus(txn.txnAmounts.token1).toString() : _entryToken1Volume.toString()
            },
            token_2_volume=${
              isToken2Swap ? _entryToken2Volume.plus(txn.txnAmounts.token2).toString() : _entryToken2Volume.toString()
            },
            volume_value=${
              isToken1Swap
                ? _entryVolumeValue.plus(txn.txnValue.token1).toString()
                : isToken2Swap
                ? _entryVolumeValue.plus(txn.txnValue.token2).toString()
                : _entryVolumeValue.toString()
            },
            token_1_fees=${isToken1Swap ? _entryToken1Fees.plus(txn.txnFees.token1) : _entryToken1Fees.toString()},
            token_2_fees=${isToken2Swap ? _entryToken2Fees.plus(txn.txnFees.token2) : _entryToken2Fees.toString()},
            fees_value=${
              isToken1Swap
                ? _entryFeesValue.plus(txn.txnFeesValue.token1).toString()
                : isToken2Swap
                ? _entryFeesValue.plus(txn.txnFeesValue.token2).toString()
                : _entryFeesValue.toString()
            },
            token_1_locked=${txn.reserves.token1.toString()},
            token_2_locked=${txn.reserves.token2.toString()},
            locked_value=${txn.reserves.token1
              .multipliedBy(txn.txnPrices.token1)
              .plus(txn.reserves.token2.multipliedBy(txn.txnPrices.token2))
              .toString()}
          `,
          where: `ts=${ts} AND pool='${txn.pool.address}'`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  private async _recordToken(txn: PlentyV2Transaction, oldPoolReserve: any, period: Period): Promise<void> {
    try {
      const table = `token_aggregate_${period.toLowerCase()}`;

      // Get the start timestamp (UTC) of the hour/day in which txn timestamp is present
      const ts =
        period === Period.HOUR ? Math.floor(txn.timestamp / 3600) * 3600 : Math.floor(txn.timestamp / 86400) * 86400;

      // Represents token1 and token2
      const arr: [1, 2] = [1, 2];

      // Is the first reserve count added to the aggregate tvl
      const isFirstReserveLoaded =
        (
          await this._dbClient.get({
            table: "pool_aggregate_day",
            select: "*",
            where: `pool='${txn.pool.address}'`,
          })
        ).rowCount !== 0;

      // Iterate through both tokens
      for (const N of arr) {
        // isSwapIn is true is the current token is a being swapped
        const isSwapIn = txn.txnType === TransactionType[`SWAP_TOKEN_${N}`];

        // Store field values in variables for ease-of-use
        const price = txn.txnPrices[`token${N}`];
        const tokenSymbol = txn.pool[`token${N}`].symbol;

        const _entry = await this._dbClient.get({
          table,
          select: "*",
          where: `ts=${ts} AND token='${tokenSymbol}'`,
        });

        // If no existing entry present for the timestamp
        if (_entry.rowCount === 0) {
          const _entryLast = await this._dbClient.get({
            table,
            select: "*",
            where: `
              token='${tokenSymbol}' 
                AND 
              ts=(SELECT MAX(ts) FROM ${table} WHERE token='${tokenSymbol}' AND ts<${ts})`,
          });

          let currentReserve = new BigNumber(0);
          if (_entryLast.rowCount !== 0) {
            currentReserve = new BigNumber(_entryLast.rows[0].locked);
          }

          const finalReserve = isFirstReserveLoaded
            ? currentReserve.minus(oldPoolReserve[`token${N}`]).plus(txn.reserves[`token${N}`])
            : currentReserve.plus(txn.reserves[`token${N}`]);

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
            '${tokenSymbol}', 
            ${price.toString()}, 
            ${price.toString()}, 
            ${price.toString()}, 
            ${price.toString()},
            ${isSwapIn ? txn.txnAmounts[`token${N}`].toString() : 0},
            ${isSwapIn ? txn.txnValue[`token${N}`].toString() : 0},
            ${isSwapIn ? txn.txnFees[`token${N}`].toString() : 0},
            ${isSwapIn ? txn.txnFeesValue[`token${N}`].toString() : 0},
            ${finalReserve.toString()},
            ${finalReserve.multipliedBy(price).toString()}
          )`,
          });
        } else {
          // Existing volume and fees
          const _entryVolume = new BigNumber(parseFloat(_entry.rows[0].volume));
          const _entryVolumeValue = new BigNumber(parseFloat(_entry.rows[0].volume_value));
          const _entryFees = new BigNumber(parseFloat(_entry.rows[0].fees));
          const _entryFeesValue = new BigNumber(parseFloat(_entry.rows[0].fees_value));
          const _entryLocked = new BigNumber(parseFloat(_entry.rows[0].locked));

          const finalReserve = isFirstReserveLoaded
            ? _entryLocked.minus(oldPoolReserve[`token${N}`]).plus(txn.reserves[`token${N}`])
            : _entryLocked.plus(txn.reserves[`token${N}`]);

          // Update existing record by conditionally updating the HLC price,
          // and adding onto previous volume and fees if it's a swap in.
          await this._dbClient.update({
            table,
            set: `
              high_price=${Math.max(price.toNumber(), parseFloat(_entry.rows[0].high_price))}, 
              low_price=${Math.min(price.toNumber(), parseFloat(_entry.rows[0].low_price))},
              close_price=${price.toString()},
              volume=${isSwapIn ? _entryVolume.plus(txn.txnAmounts[`token${N}`]).toString() : _entryVolume.toString()},
              volume_value=${
                isSwapIn ? _entryVolumeValue.plus(txn.txnValue[`token${N}`]).toString() : _entryVolumeValue.toString()
              }, 
              fees=${isSwapIn ? _entryFees.plus(txn.txnFees[`token${N}`]) : _entryFees.toString()}, 
              fees_value=${isSwapIn ? _entryFeesValue.plus(txn.txnFeesValue[`token${N}`]) : _entryFeesValue.toString()},
              locked=${finalReserve.toString()},
              locked_value=${finalReserve.multipliedBy(price).toString()}
          `,
            where: `ts=${ts} AND token='${tokenSymbol}'`,
          });
        }
      }
    } catch (err) {
      throw err;
    }
  }

  private async _recordPlenty(txn: PlentyV2Transaction, oldPoolReserve: any, period: Period): Promise<void> {
    try {
      const table = `plenty_aggregate_${period.toLowerCase()}`;

      // Get the start timestamp (UTC) of the hour/day in which txn timestamp is present
      const ts =
        period === Period.HOUR ? Math.floor(txn.timestamp / 3600) * 3600 : Math.floor(txn.timestamp / 86400) * 86400;

      const _entry = await this._dbClient.get({
        table,
        select: "*",
        where: `ts=${ts}`,
      });

      // Is the first reserve count added to the aggregate tvl
      const isFirstReserveLoaded =
        (
          await this._dbClient.get({
            table: "pool_aggregate_day",
            select: "*",
            where: `pool='${txn.pool.address}'`,
          })
        ).rowCount !== 0;

      let oldReserveValue = new BigNumber(0);

      // If it is not the first record, get the last ts and find value of the pool reserves
      // taking prices at that ts
      if (isFirstReserveLoaded) {
        const lastTs = (
          await this._dbClient.get({
            table: "transaction",
            select: "ts",
            where: `ts=(SELECT MAX(ts) FROM transaction WHERE pool='${txn.pool.address}')`,
          })
        ).rows[0].ts;

        const oldToken1Price = await getPriceAt(this._dbClient, parseInt(lastTs), txn.pool.token1.symbol);
        const oldToken2Price = await getPriceAt(this._dbClient, parseInt(lastTs), txn.pool.token2.symbol);

        oldReserveValue = oldPoolReserve.token1
          .multipliedBy(oldToken1Price)
          .plus(oldPoolReserve.token2.multipliedBy(oldToken2Price));
      }

      if (_entry.rowCount === 0) {
        const _entryLast = await this._dbClient.get({
          table,
          select: "*",
          where: `ts=(SELECT MAX(ts) FROM ${table} WHERE ts<${ts})`,
        });

        let tvlCurrent = new BigNumber(0);
        if (_entryLast.rowCount !== 0) {
          tvlCurrent = new BigNumber(_entryLast.rows[0].tvl_value);
        }

        const tvlFinal = tvlCurrent
          .minus(oldReserveValue)
          .plus(
            txn.reserves.token1
              .multipliedBy(txn.txnPrices.token1)
              .plus(txn.reserves.token2.multipliedBy(txn.txnPrices.token2))
          );

        await this._dbClient.insert({
          table,
          columns: `(
              ts, 
              volume_value, 
              fees_value,
              tvl_value
            )`,
          values: `(
              ${ts}, 
              ${
                txn.txnType === TransactionType.SWAP_TOKEN_1
                  ? txn.txnValue.token1.toString()
                  : txn.txnType === TransactionType.SWAP_TOKEN_2
                  ? txn.txnValue.token2
                  : 0
              }, 
              ${
                txn.txnType === TransactionType.SWAP_TOKEN_1
                  ? txn.txnFeesValue.token1.toString()
                  : txn.txnType === TransactionType.SWAP_TOKEN_2
                  ? txn.txnFeesValue.token2
                  : 0
              },
              ${tvlFinal.toString()}
            )`,
        });
      } else {
        // Existing values for each field at a given timestamp
        const _entryVolumeValue = new BigNumber(parseFloat(_entry.rows[0].volume_value));
        const _entryFeesValue = new BigNumber(parseFloat(_entry.rows[0].fees_value));
        const _entryTvlValue = new BigNumber(parseFloat(_entry.rows[0].tvl_value));

        const tvlFinal = _entryTvlValue
          .minus(oldReserveValue)
          .plus(
            txn.reserves.token1
              .multipliedBy(txn.txnPrices.token1)
              .plus(txn.reserves.token2.multipliedBy(txn.txnPrices.token2))
          );

        // Add volume and fees to existing values
        await this._dbClient.update({
          table,
          set: ` 
            volume_value=${
              txn.txnType === TransactionType.SWAP_TOKEN_1
                ? _entryVolumeValue.plus(txn.txnValue.token1).toString()
                : txn.txnType === TransactionType.SWAP_TOKEN_2
                ? _entryVolumeValue.plus(txn.txnValue.token2).toString()
                : _entryVolumeValue.toString()
            }, 
            fees_value=${
              txn.txnType === TransactionType.SWAP_TOKEN_1
                ? _entryFeesValue.plus(txn.txnFeesValue.token1).toString()
                : txn.txnType === TransactionType.SWAP_TOKEN_2
                ? _entryFeesValue.plus(txn.txnFeesValue.token2).toString()
                : _entryFeesValue.toString()
            },
            tvl_value=${tvlFinal.toString()}
          `,
          where: `ts=${ts}`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Simply records the price of a token at a given timestamp in price_spot table.
   */
  private async _recordSpotPrice(ts: number, tokenSymbol: string, price: BigNumber): Promise<void> {
    try {
      // Do not record dollar stablecoins
      if (constants.PRICING_TREE[0].includes(tokenSymbol)) return;

      const _entry = await this._dbClient.get({
        table: "price_spot",
        select: "token",
        where: `ts=${ts} AND token='${tokenSymbol}'`,
      });

      if (_entry.rowCount !== 0) {
        await this._dbClient.update({
          table: "price_spot",
          set: `value=${price.toString()}`,
          where: `ts=${ts} AND token='${tokenSymbol}'`,
        });
      } else {
        await this._dbClient.insert({
          table: "price_spot",
          columns: "(ts, token, value)",
          values: `(${ts}, '${tokenSymbol}', ${price.toString()})`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description fetches the hashes of swap and liquidity operations on the pool
   */
  private async _getOperationHashes(poolAddress: string, level: number): Promise<string[]> {
    try {
      let offset = 0;
      let operationHashes: string[] = [];
      while (true) {
        const hashes = await this._tkztProvider.getTransactions<string[]>({
          contract: poolAddress,
          entrypoint: [
            ...constants.SWAP_ENTRYPOINTS,
            ...constants.ADD_LIQUIDITY_ENTRYPOINTS,
            ...constants.REMOVE_LIQUIDITY_ENTRYPOINTS,
          ],
          level,
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
}
