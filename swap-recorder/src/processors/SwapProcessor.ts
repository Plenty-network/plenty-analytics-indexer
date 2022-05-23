import DatabaseClient from "../infrastructure/DatabaseClient";
import TzktProvider from "../infrastructure/TzktProvider";
import { Config, Dependecies, Contracts, Transaction } from "../types";

export default class SwapProcessor {
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
      const opHash = operation[0].hash;
      const existingEntry = await this._dbClient.get({
        table: "swap",
        select: "op_hash",
        where: `op_hash='${opHash}'`,
      });

      if (existingEntry.rowCount !== 0) return;

      // Get all swaps from the operation
      const swapIndices: number[] = [];
      for (const [index, txn] of operation.entries()) {
        if (txn.parameter && this._contracts.amm[txn.target?.address]) {
          if (["Swap", "ctez_to_tez", "tez_to_ctez"].includes(txn.parameter?.entrypoint)) {
            swapIndices.push(index);
          }
        }
      }

      for (const swapIndex of swapIndices) {
        const txn = operation[swapIndex];

        // Get input token
        const [inputToken, inputAmount] = this._getInput(operation, swapIndex);

        // Get output token (second transfer after last swap)
        const [_, outputAmount] = this._getOutput(operation, swapIndex);

        const token1 = this._contracts.amm[txn.target.address].token1 === inputToken ? -inputAmount : outputAmount;
        const token2 = this._contracts.amm[txn.target.address].token2 === inputToken ? -inputAmount : outputAmount;

        // Insert swap into postgres db
        this._dbClient.insert({
          table: "swap",
          columns: "(id, op_hash, ts, account, amm, token_1, token_2)",
          values: `(${txn.id}, '${txn.hash}', ${new Date().getTime()}, '${
            operation[swapIndex].initiator
              ? operation[swapIndex].initiator.address
              : operation[swapIndex].sender.address
          }', '${txn.target.address}', ${token1}, ${token2})`,
        });
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Works based on the fact that the first token during a non tez swap is
   * the input token. Whereas, for tez input, the amount is transferred directly to the entrypoint.
   */
  private _getInput(operation: Transaction[], swapIndex: number): [string, string] {
    const swapTxn = operation[swapIndex];
    if (swapTxn.parameter.entrypoint === "Swap") {
      const tokenTxn = operation[swapIndex + 1];
      if (Array.isArray(tokenTxn.parameter.value)) {
        // FA2 token
        const amount = tokenTxn.parameter.value[0].txs[0].amount;
        const tokenId = tokenTxn.parameter.value[0].txs[0].token_id;
        return [this._contracts.tokens[`${tokenTxn.target.address}_${tokenId}`], amount];
      } else {
        // FA1.2 token
        const amount = tokenTxn.parameter.value.value;
        return [this._contracts.tokens[`${tokenTxn.target.address}_0`], amount];
      }
    } else if (swapTxn.parameter.entrypoint === "ctez_to_tez") {
      // ctez input
      const tokenTxn = operation[swapIndex + 3];
      const amount = tokenTxn.parameter.value.value;
      return ["ctez", amount];
    } else {
      // tez input
      const amount = swapTxn.amount.toString();
      return ["tez", amount];
    }
  }

  /**
   * @description Works on similar grounds as _getInput
   */
  private _getOutput(operation: Transaction[], swapIndex: number): [string, string] {
    const swapTxn = operation[swapIndex];
    if (swapTxn.parameter.entrypoint === "Swap") {
      const tokenTxn = operation[swapIndex + 2];
      if (Array.isArray(tokenTxn.parameter.value)) {
        // FA2 token
        const amount = tokenTxn.parameter.value[0].txs[0].amount;
        const tokenId = tokenTxn.parameter.value[0].txs[0].token_id;
        return [this._contracts.tokens[`${tokenTxn.target.address}_${tokenId}`], amount];
      } else {
        // FA1.2 token
        const amount = tokenTxn.parameter.value.value;
        return [this._contracts.tokens[`${tokenTxn.target.address}_0`], amount];
      }
    } else if (swapTxn.parameter.entrypoint === "tez_to_ctez") {
      // ctez output
      const tokenTxn = operation[swapIndex + 3];
      const amount = tokenTxn.parameter.value.value;
      return ["ctez", amount];
    } else {
      // tez output
      const tokenTxn = operation[swapIndex + 3];
      const amount = tokenTxn.amount.toString();
      return ["tez", amount];
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
          entrypoint: contract === "KT1CAYNQGvYSF5UvHK21grMrKpe2563w9UcX" ? ["tez_to_ctez", "ctez_to_tez"] : ["Swap"],
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
}
