import BigNumber from "bignumber.js";
import DatabaseClient from "../infrastructure/DatabaseClient";
import TzktProvider from "../infrastructure/TzktProvider";
import { Config, Dependecies, Transaction, Data, AmmType } from "../types";
import { CONSTANTS } from "../constants";

export default class SwapProcessor {
  private _config: Config;
  private _dbClient: DatabaseClient;
  private _tkztProvider: TzktProvider;
  private _data: Data;

  constructor({ config, dbClient, tzktProvider, data }: Dependecies) {
    this._config = config;
    this._dbClient = dbClient;
    this._tkztProvider = tzktProvider;
    this._data = data;
  }

  async process(): Promise<void> {
    try {
      for (const amm of Object.keys(this._data.amm)) {
        const operationHashes = await this._getSwapOperationHashes(amm);
        for (const hash of operationHashes) {
          const operation = await this._tkztProvider.getOperation(hash);
          this._processSwapOperation(operation);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  private async _processSwapOperation(operation: Transaction[]): Promise<void> {
    try {
      // Get all swaps from the operation
      const swapIndices: number[] = [];
      for (const [index, txn] of operation.entries()) {
        if (txn.parameter && this._data.amm[txn.target?.address]) {
          if (CONSTANTS.ALL_SWAP_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
            swapIndices.push(index);
          }
        }
      }

      const id = operation[swapIndices[0]].id;
      const opHash = operation[0].hash;
      const existingEntry = await this._dbClient.get({
        table: "swap",
        select: "op_hash",
        where: `op_hash='${opHash}' AND id=${id}`,
      });

      // Return if already indexed
      if (existingEntry.rowCount !== 0) return;

      for (const swapIndex of swapIndices) {
        const txn = operation[swapIndex];

        // Get input token
        const [inputTokenAddr, inputTokenId, inputAmount] = this._getInput(operation, swapIndex);

        // Get output token (second transfer after last swap)
        const [_, __, outputAmount] = this._getOutput(operation, swapIndex);

        // -ve sign for an amount indicates the input token.
        const token1 = this._data.amm[txn.target.address].token1 === this._makeKey(inputTokenAddr, inputTokenId) ? -inputAmount : outputAmount;
        const token2 = this._data.amm[txn.target.address].token2 === this._makeKey(inputTokenAddr, inputTokenId) ? -inputAmount : outputAmount;

        // TODO: Fetch real price from price servive
        const price = 1.96;

        let volume = this._calculateValueUSD(inputTokenAddr, inputTokenId, inputAmount, price);
        let fee = this._calculateFeeUSD(inputTokenAddr, inputTokenId, inputAmount, price, this._data.amm[txn.target.address].type);
        // Get actual tvl
        let tvl = 0;

        // Insert swap into postgres db
        this._dbClient.insert({
          table: "swap",
          columns: "(id, op_hash, ts, account, amm, token_1, token_2, value, fee)",
          values: `(${txn.id}, '${txn.hash}', ${Math.floor(new Date(txn.timestamp).getTime() / 1000)}, '${
            operation[swapIndex].initiator
              ? operation[swapIndex].initiator.address
              : operation[swapIndex].sender.address
          }', '${txn.target.address}', ${token1}, ${token2}, ${volume}, ${fee})`,
        });

        // Timestamp at start of day (UTC)
        const roundedTS = Math.floor(new Date(txn.timestamp).getTime() / 86400000) * 86400;

        const existingEntry = await this._dbClient.get({
          select: "*",
          table: "amm_aggregate",
          where: `ts=${roundedTS} AND amm='${txn.target.address}'`,
        });

        if (existingEntry.rowCount === 0) {
          this._dbClient.insert({
            table: "amm_aggregate",
            columns: `(ts, amm, volume_usd, fee_usd, tvl_usd)`,
            values: `(${roundedTS}, '${txn.target.address}', ${volume}, ${fee}, ${tvl})`, // TODO: calculate tvl
          });
        } else {
          volume += parseFloat(existingEntry.rows[0].volume_usd);
          fee += parseFloat(existingEntry.rows[0].fee_usd);

          this._dbClient.update({
            table: "amm_aggregate",
            set: `volume_usd=${volume}, fee_usd=${fee}, tvl_usd=${tvl}`,
            where: `ts=${roundedTS} AND amm='${txn.target.address}'`,
          });
        }
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Works based on the fact that the first token transferred during a non tez swap is
   * the input token. Whereas, for tez input, the amount is transferred directly to the entrypoint.
   */
  private _getInput(operation: Transaction[], swapIndex: number): [string | undefined, number | undefined, string] {
    const swapTxn = operation[swapIndex];
    if (swapTxn.parameter.entrypoint === CONSTANTS.NORMAL_SWAP_ENTRYPOINT) {
      const tokenTxn = operation[swapIndex + 1];
      if (Array.isArray(tokenTxn.parameter.value)) {
        // FA2 token
        const amount = tokenTxn.parameter.value[0].txs[0].amount;
        const tokenId = tokenTxn.parameter.value[0].txs[0].token_id;
        return [tokenTxn.target.address, Number(tokenId), amount];
      } else {
        // FA1.2 token
        const amount = tokenTxn.parameter.value.value;
        return [tokenTxn.target.address, undefined, amount];
      }
    } else if (swapTxn.parameter.entrypoint === CONSTANTS.CTEZ_SWAP_ENTRYPOINT) {
      // ctez input
      const tokenTxn = operation[swapIndex + 3];
      const amount = tokenTxn.parameter.value.value;
      return [tokenTxn.target.address, undefined, amount];
    } else {
      // tez input
      const amount = swapTxn.amount.toString();
      return [undefined, undefined, amount];
    }
  }

  /**
   * @description Works on similar grounds as _getInput
   */
  private _getOutput(operation: Transaction[], swapIndex: number): [string | undefined, number | undefined, string] {
    const swapTxn = operation[swapIndex];
    if (swapTxn.parameter.entrypoint === CONSTANTS.NORMAL_SWAP_ENTRYPOINT) {
      const tokenTxn = operation[swapIndex + 2];
      if (Array.isArray(tokenTxn.parameter.value)) {
        // FA2 token
        const amount = tokenTxn.parameter.value[0].txs[0].amount;
        const tokenId = tokenTxn.parameter.value[0].txs[0].token_id;
        return [tokenTxn.target.address, Number(tokenId), amount];
      } else {
        // FA1.2 token
        const amount = tokenTxn.parameter.value.value;
        return [tokenTxn.target.address, undefined, amount];
      }
    } else if (swapTxn.parameter.entrypoint === CONSTANTS.TEZ_SWAP_ENTRYPOINT) {
      // ctez output
      const tokenTxn = operation[swapIndex + 3];
      const amount = tokenTxn.parameter.value.value;
      return [tokenTxn.target.address, undefined, amount];
    } else {
      // tez output
      const tokenTxn = operation[swapIndex + 4];
      const amount = tokenTxn.amount.toString();
      return [undefined, undefined, amount];
    }
  }

  private async _getSwapOperationHashes(contract: string): Promise<string[]> {
    try {
      const [firstLevel, lastLevel] = await this._getIndexingLevels(contract);
      let offset = 0;
      let operationHashes: string[] = [];
      while (true) {
        const hashes = await this._tkztProvider.getTransactions<string[]>({
          contract,
          entrypoint: contract === CONSTANTS.TEZ_CTEZ_AMM_ADDRESS ? CONSTANTS.TEZ_CTEZ_SWAP_ENTRYPOINTS : [`${CONSTANTS.NORMAL_SWAP_ENTRYPOINT}`],
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

  // Todo: Fetch from a shared json
  private async _getIndexingLevels(contract: string): Promise<[number, number]> {
    return [2361000, 2384000]; // [last level from json, current level from json]
  }

  private _calculateValueUSD(
    tokenAddr: string,
    tokenId: number | undefined,
    amount: string,
    unitPrice: number
  ): number {
    return new BigNumber(amount)
      .multipliedBy(unitPrice)
      .dividedBy(10 ** this._data.tokens[this._makeKey(tokenAddr, tokenId)].decimals)
      .toNumber();
  }

  private _calculateFeeUSD(tokenAddr: string, tokenId: number | undefined, amount: string, unitPrice: number, ammType: string): number {
    if (ammType === AmmType.FLAT) {
      return new BigNumber(this._calculateValueUSD(tokenAddr, tokenId, amount, unitPrice)).multipliedBy(0.001).toNumber();
    } else {
      return new BigNumber(this._calculateValueUSD(tokenAddr, tokenId, amount, unitPrice)).multipliedBy(0.0035).toNumber();
    }
  }

  private _makeKey(address: string | undefined, tokenId: number | undefined): string {
    return JSON.stringify({ address, tokenId });
  }
}
