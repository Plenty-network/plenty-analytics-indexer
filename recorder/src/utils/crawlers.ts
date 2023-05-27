import BigNumber from "bignumber.js";
import { PoolV2, Token, TokenStandard, Transaction } from "../types";

export const getTokenAmountFromOperation = (token: Token, operation: Transaction[], index: number): BigNumber => {
  switch (token.standard) {
    case TokenStandard.TEZ: {
      // Keep looping until a transaction with non-zero tez amount is found.
      // This is valid only for tez pools
      while (true) {
        if (operation[index].amount !== 0) {
          return new BigNumber(operation[index].amount).dividedBy(10 ** token.decimals);
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
          return new BigNumber(operation[index].parameter.value[0].txs[0].amount).dividedBy(10 ** token.decimals);
        }
        index++;
      }
    }
    case TokenStandard.FA12: {
      // Keep looping until a txn involving the FA1.2 token transfer is found.
      while (true) {
        if (operation[index].target.address === token.address && operation[index].parameter.entrypoint === "transfer") {
          // Return the amount of FA1.2 token involved in the txn
          return new BigNumber(operation[index].parameter.value.value).dividedBy(10 ** token.decimals);
        }
        index++;
      }
    }
  }
};

export const getTokenReserveFromStorage = (txn: Transaction, pool: PoolV2): [BigNumber, BigNumber] => {
  // Get the token reserves from storage (volatile || stable || tez-ctez)
  const token1Pool = txn.storage.token1Pool || txn.storage.token1_pool || txn.storage.tezPool;
  const token2Pool = txn.storage.token2Pool || txn.storage.token2_pool || txn.storage.ctezPool;

  // Get the numeric scaled down values
  const token1PoolNumeric = new BigNumber(token1Pool).dividedBy(10 ** pool.token1.decimals);
  const token2PoolNumeric = new BigNumber(token2Pool).dividedBy(10 ** pool.token2.decimals);

  return [token1PoolNumeric, token2PoolNumeric];
};
