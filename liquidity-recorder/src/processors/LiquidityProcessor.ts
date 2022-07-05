import BigNumber from "bignumber.js";
import DatabaseClient from "../infrastructure/DatabaseClient";
import TzktProvider from "../infrastructure/TzktProvider";
import { Config, Dependecies, Transaction, Data } from "../types";
import { CONSTANTS }  from "../constants";

export default class LiquidityProcessor {
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
        if (txn.parameter && this._data.amm[txn.target?.address]) {
          if (CONSTANTS.LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
            liquidityIndices.push(index);
          }
        }
      }

      for (const liquidityIndex of liquidityIndices) {
        const txn = operation[liquidityIndex];
        let tokenOneAddr: string | undefined,
          tokenOneId: number | undefined,
          tokenOneAmount: string,
          tokenTwoAddr: string,
          tokenTwoId: number | undefined,
          tokenTwoAmount: string;

        if (txn.target.address === CONSTANTS.TEZ_CTEZ_AMM_ADDRESS) {
          [tokenOneAddr, tokenOneId, tokenOneAmount, tokenTwoAddr, tokenTwoId, tokenTwoAmount] = this._getTokensTezCtez(
            operation,
            liquidityIndex
          );
        } else {
          [tokenOneAddr, tokenOneId, tokenOneAmount, tokenTwoAddr, tokenTwoId, tokenTwoAmount] = this._getTokens(
            operation,
            liquidityIndex
          );
        }

        const token1 =
          this._data.amm[txn.target.address].token1 === this._makeKey(tokenOneAddr, tokenOneId)
            ? tokenOneAmount
            : tokenTwoAmount;
        const token2 =
          this._data.amm[txn.target.address].token2 === this._makeKey(tokenOneAddr, tokenOneId)
            ? tokenOneAmount
            : tokenTwoAmount;

        // TODO: Fetch real price from price servive
        const priceOne = 1.96;
        const priceTwo = 2.45;

        const valueOne = this._calculateValueUSD(tokenOneAddr, tokenOneId, tokenOneAmount, priceOne);
        const valueTwo = this._calculateValueUSD(tokenTwoAddr, tokenTwoId, tokenTwoAmount, priceTwo);
        const value = valueOne + valueTwo;

        // Insert add or remove liquidity into postgres db
        this._dbClient.insert({
          table: CONSTANTS.ADD_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)
            ? "add_liquidity"
            : "remove_liquidity",
          columns: "(id, op_hash, ts, account, amm, token_1, token_2, value)",
          values: `(${txn.id}, '${txn.hash}', ${Math.floor(new Date(txn.timestamp).getTime() / 1000)}, '${
            operation[liquidityIndex].initiator
              ? operation[liquidityIndex].initiator.address
              : operation[liquidityIndex].sender.address
          }', '${txn.target.address}', ${token1}, ${token2}, ${value})`,
        });

        // TODO: Remove testing code while pushing to master
        /* if (CONSTANTS.ADD_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
            console.log(
              `Add(${txn.id}, '${txn.hash}', ${Math.floor(new Date(txn.timestamp).getTime() / 1000)}, '${
                operation[liquidityIndex].initiator
                  ? operation[liquidityIndex].initiator.address
                  : operation[liquidityIndex].sender.address
              }', '${txn.target.address}', ${token1}, ${token2}, ${value})`
            );
          } else if (CONSTANTS.REMOVE_LIQUIDITY_ENTRYPOINTS.includes(txn.parameter?.entrypoint)) {
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
  private _getTokens(
    operation: Transaction[],
    liquidityIndex: number
  ): [string, number | undefined, string, string, number | undefined, string] {
    const liquidityTxn = operation[liquidityIndex];
    let tokenOneAddr: string,
      tokenOneId: number | undefined,
      tokenOneAmount: string,
      tokenTwoAddr: string,
      tokenTwoId: number | undefined,
      tokenTwoAmount: string;

    const tokenOneTxn = CONSTANTS.ADD_LIQUIDITY_ENTRYPOINTS.includes(liquidityTxn.parameter.entrypoint)
      ? operation[liquidityIndex + 1]
      : operation[liquidityIndex + 2];
    const tokenTwoTxn = CONSTANTS.ADD_LIQUIDITY_ENTRYPOINTS.includes(liquidityTxn.parameter.entrypoint)
      ? operation[liquidityIndex + 2]
      : operation[liquidityIndex + 3];

    if (Array.isArray(tokenOneTxn.parameter.value)) {
      // FA2 token
      tokenOneAmount = tokenOneTxn.parameter.value[0].txs[0].amount;
      tokenOneAddr = tokenOneTxn.target.address;
      tokenOneId = Number(tokenOneTxn.parameter.value[0].txs[0].token_id);
    } else {
      // FA1.2 token
      tokenOneAmount = tokenOneTxn.parameter.value.value;
      tokenOneAddr = tokenOneTxn.target.address;
      tokenOneId = undefined;
    }

    if (Array.isArray(tokenTwoTxn.parameter.value)) {
      // FA2 token
      tokenTwoAmount = tokenTwoTxn.parameter.value[0].txs[0].amount;
      tokenTwoAddr = tokenTwoTxn.target.address;
      tokenTwoId = Number(tokenTwoTxn.parameter.value[0].txs[0].token_id);
    } else {
      // FA1.2 token
      tokenTwoAmount = tokenTwoTxn.parameter.value.value;
      tokenTwoAddr = tokenTwoTxn.target.address;
      tokenTwoId = undefined;
    }
    return [tokenOneAddr, tokenOneId, tokenOneAmount, tokenTwoAddr, tokenTwoId, tokenTwoAmount];
  }

  /**
   * @description Get the tokens and the amount for the tokens used in both add and remove liquidity transactions for tez-ctez pair.
   */
  private _getTokensTezCtez(
    operation: Transaction[],
    liquidityIndex: number
  ): [string | undefined, number | undefined, string, string, number | undefined, string] {
    const liquidityTxn = operation[liquidityIndex];
    let tokenOneAddr: string | undefined,
      tokenOneId: number | undefined,
      tokenOneAmount: string,
      tokenTwoAddr: string,
      tokenTwoId: number | undefined,
      tokenTwoAmount: string;

    // Get tez amount and token data
    if (CONSTANTS.ADD_LIQUIDITY_ENTRYPOINTS.includes(liquidityTxn.parameter.entrypoint)) {
      tokenOneAmount = new BigNumber(liquidityTxn.amount).toString();
      tokenOneAddr = undefined;
      tokenOneId = undefined;
    } else {
      const tezTokenTxn = operation[liquidityIndex + 3];
      tokenOneAmount = new BigNumber(tezTokenTxn.amount).toString();
      tokenOneAddr = undefined;
      tokenOneId = undefined;
    }

    // Get ctez amount and token data
    const ctezTokenTxn = CONSTANTS.ADD_LIQUIDITY_ENTRYPOINTS.includes(liquidityTxn.parameter.entrypoint)
      ? operation[liquidityIndex + 1]
      : operation[liquidityIndex + 2];

    tokenTwoAmount = ctezTokenTxn.parameter.value.value;
    tokenTwoAddr = ctezTokenTxn.target.address;
    tokenTwoId = undefined;

    return [tokenOneAddr, tokenOneId, tokenOneAmount, tokenTwoAddr, tokenTwoId, tokenTwoAmount];
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

  private _makeKey(address: string | undefined, tokenId: number | undefined): string {
    return JSON.stringify({ address, tokenId });
  }
}
