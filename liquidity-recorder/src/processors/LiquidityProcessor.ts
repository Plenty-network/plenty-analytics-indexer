import BigNumber from "bignumber.js";
import DatabaseClient from "../infrastructure/DatabaseClient";
import TzktProvider from "../infrastructure/TzktProvider";
import { Config, Dependecies, Contracts, Transaction } from "../types";
import { CONSTANTS }  from "../constants";

export default class LiquidityProcessor {
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
        const operationHashes = await this._getLiquidityOperationHashes(amm);
        for (const hash of operationHashes) {
          const operation = await this._tkztProvider.getOperation(hash);
          this._processLiquidityOperation(operation);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  private async _processLiquidityOperation(operation: Transaction[]): Promise<void> {
    try {
      // Get all add & remove liquidity from the operation
      const liquidityIndices: number[] = [];
      for (const [index, txn] of operation.entries()) {
        if (txn.parameter && this._contracts.amm[txn.target?.address]) {
          if (CONSTANTS.LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
            liquidityIndices.push(index);
          }
        }
      }

      for (const liquidityIndex of liquidityIndices) {
        const txn = operation[liquidityIndex];

        const [tokenOne, tokenOneAmount, tokenTwo, tokenTwoAmount] = this._getTokens(operation, liquidityIndex);

        const token1 = this._contracts.amm[txn.target.address].token1 === tokenOne ? tokenOneAmount : tokenTwoAmount;
        const token2 = this._contracts.amm[txn.target.address].token2 === tokenOne ? tokenOneAmount : tokenTwoAmount;

        // TODO: Fetch real price from price servive
        const priceOne = 1.96;
        const priceTwo = 2.45;

        const valueOne = this._calculateValueUSD(tokenOne, tokenOneAmount, priceOne);
        const valueTwo = this._calculateValueUSD(tokenTwo, tokenTwoAmount, priceTwo);
        const value = valueOne + valueTwo;

        // Insert add or remove liquidity into postgres db
        this._dbClient.insert({
          table: txn.parameter?.entrypoint === "AddLiquidity" ? "add_liquidity" : "remove_liquidity",
          columns: "(id, op_hash, ts, account, amm, token_1, token_2, value)",
          values: `(${txn.id}, '${txn.hash}', ${Math.floor(new Date(txn.timestamp).getTime() / 1000)}, '${
            operation[liquidityIndex].initiator
              ? operation[liquidityIndex].initiator.address
              : operation[liquidityIndex].sender.address
          }', '${txn.target.address}', ${token1}, ${token2}, ${value})`,
        });

        // TODO: Remove testing code while pushing to master
        /* if (txn.parameter?.entrypoint === "AddLiquidity") {
          console.log(
            `Add(${txn.id}, '${txn.hash}', ${Math.floor(new Date(txn.timestamp).getTime() / 1000)}, '${
              operation[liquidityIndex].initiator
                ? operation[liquidityIndex].initiator.address
                : operation[liquidityIndex].sender.address
            }', '${txn.target.address}', ${token1}, ${token2}, ${value})`
          );
        } else if (txn.parameter?.entrypoint === "RemoveLiquidity") {
          console.log(
            `Remove(${txn.id}, '${txn.hash}', ${Math.floor(new Date(txn.timestamp).getTime() / 1000)}, '${
              operation[liquidityIndex].initiator
                ? operation[liquidityIndex].initiator.address
                : operation[liquidityIndex].sender.address
            }', '${txn.target.address}', ${token1}, ${token2}, ${value})`
          );
        } */
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * @description Get the tokens and the amount for the tokens used in both add and remove liquidity transactions.
   */
  private _getTokens(operation: Transaction[], liquidityIndex: number): [string, string, string, string] {
    const liquidityTxn = operation[liquidityIndex];
    const tokenOneTxn =
      liquidityTxn.parameter.entrypoint === "AddLiquidity"
        ? operation[liquidityIndex + 1]
        : operation[liquidityIndex + 2];
    const tokenTwoTxn =
      liquidityTxn.parameter.entrypoint === "AddLiquidity"
        ? operation[liquidityIndex + 2]
        : operation[liquidityIndex + 3];
    let tokenOne: string, tokenOneAmount: string, tokenTwo: string, tokenTwoAmoount: string;

    if (Array.isArray(tokenOneTxn.parameter.value)) {
      // FA2 token
      tokenOneAmount = tokenOneTxn.parameter.value[0].txs[0].amount;
      const tokenId = tokenOneTxn.parameter.value[0].txs[0].token_id;
      tokenOne = `${tokenOneTxn.target.address}_${tokenId}`;
    } else {
      // FA1.2 token
      tokenOneAmount = tokenOneTxn.parameter.value.value;
      tokenOne = `${tokenOneTxn.target.address}_0`;
    }

    if (Array.isArray(tokenTwoTxn.parameter.value)) {
      // FA2 token
      tokenTwoAmoount = tokenTwoTxn.parameter.value[0].txs[0].amount;
      const tokenId = tokenTwoTxn.parameter.value[0].txs[0].token_id;
      tokenTwo = `${tokenTwoTxn.target.address}_${tokenId}`;
    } else {
      // FA1.2 token
      tokenTwoAmoount = tokenTwoTxn.parameter.value.value;
      tokenTwo = `${tokenTwoTxn.target.address}_0`;
    }

    return [tokenOne, tokenOneAmount, tokenTwo, tokenTwoAmoount];
  }

  private async _getLiquidityOperationHashes(contract: string): Promise<string[]> {
    try {
      const [firstLevel, lastLevel] = await this._getIndexingLevels(contract);
      let offset = 0;
      let operationHashes: string[] = [];
      while (true) {
        const hashes = await this._tkztProvider.getTransactions<string[]>({
          contract,
          entrypoint: CONSTANTS.LIQUIDITY_ENTRYPOINTS,
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

  private _calculateValueUSD(token: string, amount: string, unitPrice: number): number {
    return new BigNumber(amount)
      .multipliedBy(unitPrice)
      .dividedBy(10 ** this._contracts.tokens[token].decimals)
      .toNumber();
  }
}
