import { config } from "./config";
import { buildDependencies } from "./dependencies";

import HeartBeat from "./infrastructure/Heartbeat";
import LiquidityProcessor from "./processors/LiquidityProcessor";


(async () => {
  try {
    const dependencies = await buildDependencies(config);

    const heartbeat = new HeartBeat(config);
    const liquidityProcessor = new LiquidityProcessor(dependencies);

    heartbeat.start();
    await dependencies.dbClient.init();
    liquidityProcessor.process();
  } catch (err) {
    console.error(err.message);
  }
})();
