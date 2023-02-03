import axios from "axios";
import Cache from "./infrastructure/Cache";
import { Data, Config, Dependencies } from "./types";
import DatabaseClient from "./infrastructure/DatabaseClient";

// Fetch pools and tokens data from Plenty's system wide config and caches it
const getDataBuilder = (cache: Cache, config: Config, dbClient: DatabaseClient) => async (): Promise<Data> => {
  try {
    let data: Data | undefined = cache.get("data");
    if (!data) {
      const pools = (await axios.get(config.configURL + "/pools")).data;
      const tokens = (await axios.get(config.configURL + "/tokens")).data;
      for (const poolAddress of Object.keys(pools)) {
        const _entry = await dbClient.get({
          table: "data",
          select: "*",
          where: `pool='${poolAddress}'`,
        });
        if (_entry.rowCount == 0) {
          dbClient.insert({
            table: "data",
            columns: "(pool, token_1, token_2)",
            values: `('${poolAddress}', '${pools[poolAddress].token1.symbol}', '${pools[poolAddress].token2.symbol}')`,
          });
        }
      }
      data = {
        pools: pools,
        tokens: tokens,
      };
      cache.insert("data", data, config.ttl.data);
    }
    return data;
  } catch (err) {
    throw err;
  }
};

export const buildDependencies = async (config: Config): Promise<Dependencies> => {
  const cache = new Cache();
  const dbClient = new DatabaseClient(config);

  return {
    cache,
    config,
    dbClient,
    getData: getDataBuilder(cache, config, dbClient),
  };
};
