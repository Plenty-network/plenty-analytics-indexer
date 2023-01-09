import { Config } from "./types";

export const config: Config = {
  heartbeatURL: process.env.HEARTBEAT || "https://cronitor.link/p/f2b147ded5de476180d0eac01c1502f6/EADGAa",
  configURL: process.env.CONFIG_URL || "https://config.plenty.network/v1/config",
  expressPort: process.env.EXPRESS_PORT || "3000",
  ttl: {
    data: parseInt(process.env.DATA_TTL) || 60000,
    history: parseInt(process.env.HISTORY_TTL) || 0,
  },
  postgres: {
    username: process.env.POSTGRES_USER || "master",
    database: process.env.POSTGRES_DB || "plenty",
    password: process.env.POSTGRES_PASSWORD || "123456",
    host: process.env.POSTGRES_HOST || "localhost",
  },
};
