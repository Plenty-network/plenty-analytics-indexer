import { config } from "./config";
import { addRetryToAxios } from "./utils";
import { buildDependencies } from "./dependencies";

import { BlockData } from "./types";

import Processor from "./processor";
import HeartBeat from "./infrastructure/Heartbeat";
import BlockListener from "./infrastructure/BlockListener";

const heartbeat = new HeartBeat(config);

(async () => {
  try {
    addRetryToAxios();

    const blockListener = new BlockListener(config);
    const dependencies = await buildDependencies(config);
    const processor = new Processor(dependencies);

    heartbeat.start(); // Start sending periodic requests to uptime checker
    await dependencies.dbClient.init(); // Initialise db with tables

    let processing = false;

    // Start listeining to blocks from block-watcher
    blockListener.listen();
    blockListener.blockEmitter.on("newBlock", async (b: BlockData) => {
      try {
        // Return if processor is already running
        if (processing) return;
        processing = true;
        console.log(`Processing upto block: ${b.level}`);
        await processor.process(b.level - config.reorgLag);
        processing = false;
      } catch (err: any) {
        processing = false;
        console.log(err.message);
      }
    });
  } catch (err) {
    console.error(err);
    heartbeat.stop();
    process.exit();
  }
})();
