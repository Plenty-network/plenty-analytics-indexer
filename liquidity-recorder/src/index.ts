import { config } from "./config";
import { buildDependencies } from "./dependencies";

import HeartBeat from "./infrastructure/Heartbeat";
import LiquidityProcessor from "./processors/LiquidityProcessor";

const dependencies = buildDependencies(config);

const heartbeat = new HeartBeat(config);
const liquidityProcessor = new LiquidityProcessor(dependencies);

(async () => {
  try {
    heartbeat.start();
    await dependencies.dbClient.init();
    liquidityProcessor.process();
  } catch (err) {
    console.error(err.message);
  }
})();
