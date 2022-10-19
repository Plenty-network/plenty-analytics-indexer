import axios from "axios";
import Cache from "./infrastructure/Cache";
import { Data, Config, Dependencies } from "./types";
import DatabaseClient from "./infrastructure/DatabaseClient";

// Fetch AMM and token data from Plenty's system wide config and caches it
const getDataBuilder = (cache: Cache, config: Config, dbClient: DatabaseClient) => async (): Promise<Data> => {
  try {
    let data: Data | undefined = cache.get("data");
    if (!data) {
      const amm = (
        await axios.get(config.configURL + "/amm" + `?network=${config.network}`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
          },
        })
      ).data;
      const token = (
        await axios.get(config.configURL + "/token?type=standard" + `&network=${config.network}`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
          },
        })
      ).data;
      for (const ammAddress of Object.keys(amm)) {
        const _entry = await dbClient.get({
          table: "data",
          select: "*",
          where: `amm='${ammAddress}'`,
        });
        if (_entry.rowCount == 0) {
          dbClient.insert({
            table: "data",
            columns: "(amm, token_1, token_2)",
            values: `('${ammAddress}', '${amm[ammAddress].token1.symbol}', '${amm[ammAddress].token2.symbol}')`,
          });
        }
      }
      data = {
        amm: Object.keys(amm),
        token: Object.keys(token),
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
