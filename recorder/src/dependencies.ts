import Cache from "./infrastructure/Cache";
import { entriesToTokens } from "./utils/entryToToken";
import TzktProvider from "./infrastructure/TzktProvider";
import DatabaseClient from "./infrastructure/DatabaseClient";
import { Config, Dependecies, PoolType, Pools } from "./types";

// Fetch pools and tokens data from database
const getPools = (cache: Cache, config: Config, dbClient: DatabaseClient) => async (): Promise<Pools> => {
  try {
    let pools: Pools = cache.get("data") ?? {};
    if (Object.keys(pools).length === 0) {
      const poolsV2 = (
        await dbClient.getAll({
          table: "pool_v2",
          select: "*",
        })
      ).rows;
      const poolsV3 = (
        await dbClient.getAll({
          table: "pool_v3",
          select: "*",
        })
      ).rows;
      const tokens = entriesToTokens(
        await dbClient.getAll({
          table: "token",
          select: "*",
        }),
        "id"
      );

      for (const pool of poolsV2) {
        pools[pool.address] = {
          address: pool.address,
          token1: tokens[pool.token_1],
          token2: tokens[pool.token_2],
          fees: pool.fees,
          type: pool.type,
        };
      }

      for (const pool of poolsV3) {
        pools[pool.address] = {
          address: pool.address,
          token1: tokens[pool.token_x],
          token2: tokens[pool.token_y],
          fees: pool.fee_bps,
          type: PoolType.V3,
        };
      }

      cache.insert("data", pools, config.ttl.data);
    }
    return pools;
  } catch (err) {
    throw err;
  }
};

export const buildDependencies = async (config: Config): Promise<Dependecies> => {
  const cache = new Cache();
  const dbClient = new DatabaseClient(config);

  try {
    return {
      config,
      dbClient,
      tzktProvider: new TzktProvider(config),
      getPools: getPools(cache, config, dbClient),
    };
  } catch (err) {
    throw err;
  }
};
