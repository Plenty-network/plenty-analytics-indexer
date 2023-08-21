import {
  Pool,
  Token,
  Config,
  Period,
  PoolType,
  Dependecies,
  Transaction,
  TransactionType,
  PlentyTransaction,
} from "../types";
import {
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
  private _getPools: () => Promise<Pool[]>;

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
        // Process transactions
        for (const pool of pools) {
          currentPool = pool.address;
          const operationHashes = await this._getOperationHashes(pool.address, level);
          for (const hash of operationHashes) {
            const operation = await this._tkztProvider.getOperation(hash);
            currentOperation = hash;
            await this._processOperation(operation, pool);
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

  private async _processOperation(operation: Transaction[], pool: Pool): Promise<void> {
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
            let token1Reserve, token2Reserve;
            if (pool.type === PoolType.V3) {
              // fetch from pool balances
              [token1Reserve, token2Reserve] = [
                await this._tkztProvider.getTokenBalance(pool.token1, pool.address),
                await this._tkztProvider.getTokenBalance(pool.token2, pool.address),
              ];
            } else {
              // From storage
              [token1Reserve, token2Reserve] = getTokenReserveFromStorage(txn, pool);
            }

            function calculateFees(base: BigNumber) {
              return pool.type === PoolType.V3
                ? base.multipliedBy(pool.fees).dividedBy(10000)
                : base.dividedBy(pool.fees);
            }

            const plentyTxn: PlentyTransaction = {
              id: txn.id,
              hash: txn.hash,
              timestamp: Math.floor(new Date(txn.timestamp).getTime() / 1000),
              account: txn.initiator?.address ?? txn.sender.address,
              pool,
              reserves: { token1: token1Reserve, token2: token2Reserve },
              txnType: TransactionType.ADD_LIQUIDITY, // May potentially change below
              txnAmounts: { token1: token1Amount, token2: token2Amount },
              txnFees: {
                token1: calculateFees(token1Amount),
                token2: calculateFees(token2Amount),
              },
              txnPrices: { token1: constants.ZERO_VAL, token2: constants.ZERO_VAL },
              txnValue: { token1: constants.ZERO_VAL, token2: constants.ZERO_VAL },
              txnFeesValue: { token1: constants.ZERO_VAL, token2: constants.ZERO_VAL },
            };

            // Set txn type based on entrypoint called
            // V2 liquidity
            if (constants.V2_ADD_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              plentyTxn.txnType = TransactionType.ADD_LIQUIDITY;
            } else if (constants.V2_REMOVE_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              plentyTxn.txnType = TransactionType.REMOVE_LIQUIDITY;
            }
            // V2 swaps
            else if (constants.V2_SWAP_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              // Decide transaction type based on whether token 1 is swapped for token 2 or vice versa
              if (plentyTxn.pool.address === this._config.tezCtezPool) {
                if (txn.parameter.entrypoint === constants.TEZ_SWAP_ENTRYPOINT) {
                  plentyTxn.txnType = TransactionType.SWAP_TOKEN_1; // token 1 is swapped for token 2
                } else {
                  plentyTxn.txnType = TransactionType.SWAP_TOKEN_2; // token 2 is swapped for token 1
                }
              } else if (
                txn.parameter.value.requiredTokenAddress === plentyTxn.pool.token1.address &&
                txn.parameter.value.requiredTokenId === (plentyTxn.pool.token1.tokenId?.toString() ?? "0")
              ) {
                plentyTxn.txnType = TransactionType.SWAP_TOKEN_2;
              } else {
                plentyTxn.txnType = TransactionType.SWAP_TOKEN_1;
              }
            }
            // V3 liquidity
            else if (constants.V3_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              // Add liquidity
              if (
                (txn.parameter?.entrypoint === constants.V3_SET_POSITION &&
                  parseInt(txn.parameter?.value?.liquidity) !== 0) ||
                (txn.parameter?.entrypoint === constants.V3_UPDATE_POSITION &&
                  parseInt(txn.parameter?.value?.liquidity_delta) > 0)
              ) {
                plentyTxn.txnType = TransactionType.ADD_LIQUIDITY;
              } else if (parseInt(txn.parameter?.value?.liquidity_delta) < 0) {
                plentyTxn.txnType = TransactionType.REMOVE_LIQUIDITY;
              } else {
                // Fee collection may be skipped from being recorded
                continue;
              }
            }
            // V3 swaps
            else if (constants.V3_SWAP_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
              if (txn.parameter?.entrypoint === constants.V3_SWAP_X_TO_Y) {
                plentyTxn.txnType = TransactionType.SWAP_TOKEN_1;
              } else {
                plentyTxn.txnType = TransactionType.SWAP_TOKEN_2;
              }
            }

            // Token prices
            const [token1Price, token2Price] = await calculatePrice(this._dbClient, plentyTxn);

            // Record spot price of the tokens
            await this._recordSpotPrice(plentyTxn.timestamp, plentyTxn.pool.token1, token1Price);
            await this._recordSpotPrice(plentyTxn.timestamp, plentyTxn.pool.token2, token2Price);

            plentyTxn.txnPrices = { token1: token1Price, token2: token2Price };
            plentyTxn.txnValue = {
              token1: token1Amount.multipliedBy(token1Price),
              token2: token2Amount.multipliedBy(token2Price),
            };
            plentyTxn.txnFeesValue = {
              token1: calculateFees(plentyTxn.txnValue.token1),
              token2: calculateFees(plentyTxn.txnValue.token2),
            };

            await this._recordTransaction(plentyTxn);

            // Don't record aggregate values if any of the tokens is unpriced
            if (token1Price.isEqualTo(0) || token2Price.isEqualTo(0)) {
              continue;
            }

            const oldReserveToken1 =
              plentyTxn.txnType === TransactionType.SWAP_TOKEN_1 || plentyTxn.txnType === TransactionType.ADD_LIQUIDITY
                ? token1Reserve.minus(token1Amount)
                : token1Reserve.plus(token1Amount);

            const oldReserveToken2 =
              plentyTxn.txnType === TransactionType.SWAP_TOKEN_2 || plentyTxn.txnType === TransactionType.ADD_LIQUIDITY
                ? token2Reserve.minus(token2Amount)
                : token2Reserve.plus(token2Amount);

            await this._recordToken(plentyTxn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.HOUR);
            await this._recordToken(plentyTxn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.DAY);
            await this._recordPool(plentyTxn, Period.HOUR);
            await this._recordPool(plentyTxn, Period.DAY);
            await this._recordPlenty(plentyTxn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.HOUR);
            await this._recordPlenty(plentyTxn, { token1: oldReserveToken1, token2: oldReserveToken2 }, Period.DAY);
          }
        }
      }
    } catch (err) {
      throw err;
    }
  }

  private async _recordTransaction(txn: PlentyTransaction) {
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

  private async _recordPool(txn: PlentyTransaction, period: Period) {
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

  private async _recordToken(txn: PlentyTransaction, oldPoolReserve: any, period: Period): Promise<void> {
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
        const dbTokenId = txn.pool[`token${N}`].id;

        const _entry = await this._dbClient.get({
          table,
          select: "*",
          where: `ts=${ts} AND token=${dbTokenId}`,
        });

        // If no existing entry present for the timestamp
        if (_entry.rowCount === 0) {
          const _entryLast = await this._dbClient.get({
            table,
            select: "*",
            where: `
              token=${dbTokenId}
                AND 
              ts=(SELECT MAX(ts) FROM ${table} WHERE token=${dbTokenId} AND ts<${ts})`,
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
            ${dbTokenId}, 
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
            where: `ts=${ts} AND token=${dbTokenId}`,
          });
        }
      }
    } catch (err) {
      throw err;
    }
  }

  private async _recordPlenty(txn: PlentyTransaction, oldPoolReserve: any, period: Period): Promise<void> {
    try {
      const table = `plenty_aggregate_${period.toLowerCase()}`;

      // Get the start timestamp (UTC) of the hour/day in which txn timestamp is present
      const ts =
        period === Period.HOUR ? Math.floor(txn.timestamp / 3600) * 3600 : Math.floor(txn.timestamp / 86400) * 86400;

      const currentEntry = await this._dbClient.get({
        table,
        select: "*",
        where: `ts=${ts}`,
      });

      // If no existing entry is present for the timestamp
      if (currentEntry.rowCount === 0) {
        // Get the TVL (i.e value locked across tokens) for the last (or current) hour, grouped by tokens
        const tvl = (
          await this._dbClient.raw(`
          SELECT sum(locked_value) as tvl 
          FROM (
            SELECT token, MAX(ts) mts FROM
              token_aggregate_hour
            WHERE ts<=${ts} GROUP BY token
          ) r
          JOIN token_aggregate_hour t
            ON r.token=t.token AND r.mts=t.ts;
        `)
        ).rows[0].tvl;

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
              ${tvl.toString()}
            )`,
        });
      } else {
        // Get the TVL of the last hour
        let tvl = new BigNumber(0);
        const previousEntryHour = await this._dbClient.get({
          table: "plenty_aggregate_hour",
          select: "*",
          where: `ts=(SELECT MAX(ts) FROM ${table} WHERE ts<=${ts})`,
        });
        if (period === Period.DAY && previousEntryHour.rowCount !== 0) {
          tvl = new BigNumber(previousEntryHour.rows[0].tvl_value);
        } else {
          tvl = new BigNumber(currentEntry.rows[0].tvl_value);
        }

        // Existing values for each field at a given timestamp
        const _entryVolumeValue = new BigNumber(parseFloat(currentEntry.rows[0].volume_value));
        const _entryFeesValue = new BigNumber(parseFloat(currentEntry.rows[0].fees_value));

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
            tvl_value=${tvl.toString()}
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
  private async _recordSpotPrice(ts: number, token: Token, price: BigNumber): Promise<void> {
    try {
      // Do not record dollar stablecoins
      if (constants.PRICING_TREE[0].includes(token.symbol)) return;

      const _entry = await this._dbClient.get({
        table: "price_spot",
        select: "token",
        where: `ts=${ts} AND token=${token.id}`,
      });

      if (_entry.rowCount !== 0) {
        await this._dbClient.update({
          table: "price_spot",
          set: `value=${price.toString()}`,
          where: `ts=${ts} AND token=${token.id}`,
        });
      } else {
        await this._dbClient.insert({
          table: "price_spot",
          columns: "(ts, token, value)",
          values: `(${ts}, ${token.id}, ${price.toString()})`,
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
            ...constants.V2_SWAP_ENTRYPOINTS,
            ...constants.V2_ADD_LIQUIDITY_ENTRYPOINTS,
            ...constants.V2_REMOVE_LIQUIDITY_ENTRYPOINTS,
            ...constants.V3_SWAP_ENTRYPOINTS,
            ...constants.V3_LIQUIDITY_ENTRYPOINTS,
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
