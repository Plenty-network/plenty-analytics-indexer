import { config } from "./config";
import { buildDependencies } from "./dependencies";

import HeartBeat from "./infrastructure/Heartbeat";
import AggregateProcessor from "./processors/AggregateProcessor";

(async () => {
  try {
    const dependencies = await buildDependencies(config);

    const heartbeat = new HeartBeat(config);
    const swapProcesser = new AggregateProcessor(dependencies);

    heartbeat.start();
    await dependencies.dbClient.init();
    await swapProcesser.process(2555892);
  } catch (err) {
    console.error(err);
    process.exit();
  }
})();
