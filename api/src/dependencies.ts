import { Config, Dependecies } from "./types";
import DatabaseClient from "./infrastructure/DatabaseClient";
import DataBuilder from "./infrastructure/DataBuilder";

export const buildDependencies = async (config: Config): Promise<Dependecies> => {
  return {
    config,
    dbClient: new DatabaseClient(config),
    data: await new DataBuilder(config).buildData(),
  };
};
