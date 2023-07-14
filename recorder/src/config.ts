import { Config } from "./types";

export const config: Config = {
  heartbeatURL: process.env.HEARTBEAT || "https://cronitor.link/p/f2b147ded5de476180d0eac01c1502f6/EADGAa",
  tzktURL: process.env.TZKT_URL || "https://api.tzkt.io/v1",
  blockPort: process.env.BLOCK_PORT || "6024",
  reorgLag: 2,
  tzktLimit: 1000,
  tzktOffset: 1000,
  ttl: {
    data: parseInt(process.env.DATA_TTL) || 60000,
  },
  postgres: {
    username: process.env.POSTGRES_USER || "master",
    database: process.env.POSTGRES_DB || "plenty",
    password: process.env.POSTGRES_PASSWORD || "123456",
    host: process.env.POSTGRES_HOST || "localhost",
  },
  tezCtezPool: process.env.TEZ_CTEZ_POOL || "KT1CAYNQGvYSF5UvHK21grMrKpe2563w9UcX",
  indexingStart: process.env.INDEXING_START || "2525525",
};
