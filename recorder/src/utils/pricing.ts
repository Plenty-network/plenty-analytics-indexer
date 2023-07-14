import BigNumber from "bignumber.js";

import * as constants from "../constants";
import DatabaseClient from "../infrastructure/DatabaseClient";
import { PlentyTransaction, PoolType, TransactionType } from "../types";

// Pulls the spot price for a token at a specific timestamp
export const getPriceAt = async (
  dbClient: DatabaseClient,
  ts: number,
  dbTokenId: number,
  tokenSymbol: string
): Promise<BigNumber> => {
  if (constants.PRICING_TREE[0].includes(tokenSymbol)) {
    return new BigNumber(1);
  } else {
    try {
      const _entry = await dbClient.get({
        table: "price_spot",
        select: "value",
        where: `
          token=${dbTokenId}
           AND
          ts=(SELECT MAX(ts) FROM price_spot WHERE token=${dbTokenId} AND ts<=${ts})  
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
};

// Calculates the price of a token based on another token through the pricing tree
export const calculatePrice = async (
  dbClient: DatabaseClient,
  txn: PlentyTransaction
): Promise<[BigNumber, BigNumber]> => {
  try {
    let token1Price = await getPriceAt(dbClient, txn.timestamp, txn.pool.token1.id, txn.pool.token1.symbol);
    let token2Price = await getPriceAt(dbClient, txn.timestamp, txn.pool.token2.id, txn.pool.token2.symbol);

    // For stable pool liquidity addition only proceed if one of the tokens is unpriced
    if (
      txn.pool.type === PoolType.V2_STABLE &&
      txn.txnType === TransactionType.ADD_LIQUIDITY &&
      !token1Price.isEqualTo(0) &&
      !token2Price.isEqualTo(0)
    ) {
      return [token1Price, token2Price];
    }

    // For v3 pool only process if it's a swap
    if (
      txn.pool.type === PoolType.V3 &&
      txn.txnType !== TransactionType.SWAP_TOKEN_1 &&
      txn.txnType !== TransactionType.SWAP_TOKEN_2
    ) {
      return [token1Price, token2Price];
    }

    // Use swap amounts for stable and v3 pools, reserve for the rest
    const token1Base =
      txn.pool.type === PoolType.V2_STABLE || txn.pool.type === PoolType.V3
        ? txn.txnAmounts.token1
        : txn.reserves.token1;
    const token2Base =
      txn.pool.type === PoolType.V2_STABLE || txn.pool.type === PoolType.V3
        ? txn.txnAmounts.token2
        : txn.reserves.token2;

    // Priority wise pricing:
    // USDt, USCD.e -> $1
    // CTez -> $-
    // kUSD, uUSD -> $-
    // YOU -> $-

    // Price in order of priority in the tree
    for (let i = 0; i < constants.PRICING_TREE.length; i++) {
      if (constants.PRICING_TREE[i].includes(txn.pool.token1.symbol)) {
        token2Price = new BigNumber(token1Base).multipliedBy(token1Price).dividedBy(token2Base);
        break;
      } else if (constants.PRICING_TREE[i].includes(txn.pool.token2.symbol)) {
        token1Price = new BigNumber(token2Base).multipliedBy(token2Price).dividedBy(token1Base);
        break;
      }
    }

    return [token1Price, token2Price];
  } catch (err) {
    throw err;
  }
};
