import { config } from "./config";
import { addRetryToAxios } from "./utils";
import { buildDependencies } from "./dependencies";

import { BlockData } from "./types";

import HeartBeat from "./infrastructure/Heartbeat";
import BlockListener from "./infrastructure/BlockListener";
import AggregateProcessor from "./processors/AggregateProcessor";

const heartbeat = new HeartBeat(config);

(async () => {
  try {
    addRetryToAxios();

    const blockListener = new BlockListener(config);
    const dependencies = await buildDependencies(config);
    const swapProcesser = new AggregateProcessor(dependencies);

    heartbeat.start(); // Start sending periodic requests to uptime checker
    await dependencies.dbClient.init(); // Initialise db with tables

    let processing = false;

    // Start listeining to blocks from block-watcher
    blockListener.listen();
    blockListener.blockEmitter.on("newBlock", async (b: BlockData) => {
      // Return if swap processor is already running
      if (processing) return;
      processing = true;
      console.log(`Processing upto block: ${b.level}`);
      await swapProcesser.process(b.level - config.reorgLag);
      processing = false;
    });
  } catch (err) {
    console.error(err);
    heartbeat.stop();
    process.exit();
  }
})();
