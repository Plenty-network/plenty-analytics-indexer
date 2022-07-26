import { Server } from "http";
import { config } from "./config";
import { httpServer } from "./web/Server";
import { buildDependencies } from "./dependencies";

import HeartBeat from "./infrastructure/Heartbeat";

const heartbeat = new HeartBeat(config);

let server: Server;

(async () => {
  try {
    heartbeat.start();

    const dependencies = await buildDependencies(config);
    await dependencies.dbClient.init();

    server = httpServer(dependencies).listen(config.expressPort, () => {
      console.log(`Express server started on port: ${config.expressPort}`);
    });

    process.on("SIGTERM", () => {
      console.log("Server stopping...");
      server.close(() => {
        process.exit(0);
      });
    });
  } catch (err) {
    console.error(err.message);
    server.close(() => {
      process.exit(0);
    });
  }
})();
