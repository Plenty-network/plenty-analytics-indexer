import BigNumber from "bignumber.js";

import * as constants from "../constants";
import { PlentyV2Transaction, PoolType, TransactionType } from "../types";
import DatabaseClient from "../infrastructure/DatabaseClient";

// Pulls the spot price for a token at a specific timestamp
export const getPriceAt = async (dbClient: DatabaseClient, ts: number, tokenSymbol: string): Promise<BigNumber> => {
  if (constants.PRICING_TREE[0].includes(tokenSymbol)) {
    return new BigNumber(1);
  } else {
    try {
      const _entry = await dbClient.get({
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
};

// Calculates the price of a token based on another token through the pricing tree
export const calculatePrice = async (
  dbClient: DatabaseClient,
  txn: PlentyV2Transaction
): Promise<[BigNumber, BigNumber]> => {
  try {
    let token1Price = await getPriceAt(dbClient, txn.timestamp, txn.pool.token1.symbol);
    let token2Price = await getPriceAt(dbClient, txn.timestamp, txn.pool.token2.symbol);

    // For stable pool liquidity addition only proceed if one of the tokens is unpriced
    if (
      txn.pool.type === PoolType.STABLE &&
      txn.txnType === TransactionType.ADD_LIQUIDITY &&
      !token1Price.isEqualTo(0) &&
      !token2Price.isEqualTo(0)
    ) {
      return [token1Price, token2Price];
    }

    // Use reserve for volatile and amount for stable
    const token1Base = txn.pool.type === PoolType.VOLATILE ? txn.reserves.token1 : txn.txnAmounts.token1;
    const token2Base = txn.pool.type === PoolType.VOLATILE ? txn.reserves.token2 : txn.txnAmounts.token2;

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
