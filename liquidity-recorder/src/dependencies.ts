import { Config, Dependecies } from "./types";
import TzktProvider from "./infrastructure/TzktProvider";
import DatabaseClient from "./infrastructure/DatabaseClient";
import DataBuilder from "./infrastructure/DataBuilder";

export const buildDependencies = async (config: Config): Promise<Dependecies> => {
  return {
    config,
    dbClient: new DatabaseClient(config),
    tzktProvider: new TzktProvider(config),
    data: await new DataBuilder(config).buildData(),
  };
};
