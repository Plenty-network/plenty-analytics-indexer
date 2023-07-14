import { QueryResult } from "pg";

import { Token } from "../types";

export const entriesToTokens = (entries: QueryResult, indexBy: string) => {
  const tokens: { [key: string]: Token } = {};

  for (const entry of entries.rows) {
    tokens[entry[indexBy]] = {
      id: parseInt(entry.id),
      name: entry.name,
      symbol: entry.symbol,
      decimals: parseInt(entry.decimals),
      standard: entry.standard,
      address: entry.address,
      tokenId: entry.token_id ? parseInt(entry.token_id) : undefined,
      thumbnailUri: entry.thumbnail_uri,
      originChain: entry.origin_chain,
    };
  }

  return tokens;
};
