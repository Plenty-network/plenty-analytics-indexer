import Messenger from "./infrastructure/Messenger";
import Heartbeat from "./infrastructure/Heartbeat";
import BlockMonitor from "./infrastructure/BlockMonitor";

import { config } from "./config";

const messenger = new Messenger(config);
const heartBeat = new Heartbeat(config);
const blockMonitor = new BlockMonitor(config);

heartBeat.start();
blockMonitor.monitor(messenger);
