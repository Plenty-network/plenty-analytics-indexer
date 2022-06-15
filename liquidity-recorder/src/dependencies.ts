import { readFileSync } from "fs";

import { Config, Dependecies } from "./types";
import TzktProvider from "./infrastructure/TzktProvider";
import DatabaseClient from "./infrastructure/DatabaseClient";

export const buildDependencies = (config: Config): Dependecies => {
  return {
    config,
    dbClient: new DatabaseClient(config),
    tzktProvider: new TzktProvider(config),
    contracts: JSON.parse(readFileSync(`${config.sharedDirectory}/contracts.json`).toString()),
  };
};
