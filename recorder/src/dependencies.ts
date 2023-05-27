import axios from "axios";

import { Pools, Config, Dependecies } from "./types";

import Cache from "./infrastructure/Cache";
import TzktProvider from "./infrastructure/TzktProvider";
import DatabaseClient from "./infrastructure/DatabaseClient";

// Fetch pools and tokens data from Plenty's system wide config and caches it
const getPools = (cache: Cache, config: Config) => async (): Promise<Pools> => {
  try {
    let data: Pools | undefined = cache.get("data");
    if (!data) {
      const pools = (await axios.get(config.configURL + "/pools")).data;
      data = {
        v2: Object.values(pools),
        v3: [],
      };
      cache.insert("data", data, config.ttl.data);
    }
    return data;
  } catch (err) {
    throw err;
  }
};

export const buildDependencies = async (config: Config): Promise<Dependecies> => {
  const cache = new Cache();

  try {
    return {
      config,
      dbClient: new DatabaseClient(config),
      tzktProvider: new TzktProvider(config),
      getPools: getPools(cache, config),
    };
  } catch (err) {
    throw err;
  }
};
