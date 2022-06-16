import { config } from "./config";
import { buildDependencies } from "./dependencies";
import { httpServer } from "./web/Server";
import HeartBeat from "./infrastructure/Heartbeat";

const dependencies = buildDependencies(config);
const heartbeat = new HeartBeat(config);

(async () => {
  try {
    heartbeat.start();
    await dependencies.dbClient.init();
    const server = httpServer(dependencies).listen(config.port, () => {
      console.log(`Express server started on port: ${config.port}`);
    });
    process.on("SIGTERM", () => {
      console.log("Server stopping...");
      server.close(() => {
        process.exit(0);
      });
    });
  } catch (err) {
    console.error(err.message);
  }
})();
