import { config } from "./config";
import { buildDependencies } from "./dependencies";

import HeartBeat from "./infrastructure/Heartbeat";
import PriceProcessor from "./processors/PriceProcessor";

const dependencies = buildDependencies(config);

const heartbeat = new HeartBeat(config);
const priceProcessor = new PriceProcessor(dependencies);

(async () => {
  try {
    heartbeat.start();
    await dependencies.dbClient.init();
    priceProcessor.process();
  } catch (err) {
    console.error(err.message);
  }
})();
