import { Config } from "./types";

export const config: Config = {
  heartbeatURL: process.env.HEARTBEAT || "https://cronitor.link/p/f2b147ded5de476180d0eac01c1502f6/EADGAa",
  tzktURL: process.env.TZKT_URL || "https://api.tzkt.io/v1",
  port: process.env.PORTS || "6024",
  tzktLimit: 1000,
  tzktOffset: 1000,
  sharedDirectory: process.env.SHARED_DIRECTORY || "/app/data",
  postgres: {
    username: process.env.POSTGRES_USER || "master",
    database: process.env.POSTGRES_DB || "plenty",
    password: process.env.POSTGRES_PASSWORD || "123456",
    host: process.env.POSTGRES_HOST || "db",
  },
};
