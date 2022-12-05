import axios from "axios";

import { Data, Config, Dependecies } from "./types";

import Cache from "./infrastructure/Cache";
import TzktProvider from "./infrastructure/TzktProvider";
import DatabaseClient from "./infrastructure/DatabaseClient";

// Fetch pools and tokens data from Plenty's system wide config and caches it
const getDataBuilder = (cache: Cache, config: Config) => async (): Promise<Data> => {
  try {
    let data: Data | undefined = cache.get("data");
    if (!data) {
      const pools = (await axios.get(config.configURL + "/pools")).data;
      data = {
        pools,
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
      getData: getDataBuilder(cache, config),
    };
  } catch (err) {
    throw err;
  }
};
