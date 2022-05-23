import { config } from "./config";
import { buildDependencies } from "./dependencies";

import HeartBeat from "./infrastructure/Heartbeat";
import SwapProcessor from "./processors/SwapProcessor";

const dependencies = buildDependencies(config);

const heartbeat = new HeartBeat(config);
const swapProcesser = new SwapProcessor(dependencies);

(async () => {
  try {
    heartbeat.start();
    await dependencies.dbClient.init();
    swapProcesser.process();
  } catch (err) {
    console.error(err.message);
  }
})();
