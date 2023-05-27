import dgram from "dgram";
import EventEmitter from "events";

import { Config } from "types";

class BlockEmitter extends EventEmitter {}

export default class BlockListener {
  blockEmitter: BlockEmitter;
  private _port: string;

  constructor(config: Config) {
    this._port = config.blockPort;
    this.blockEmitter = new BlockEmitter();
  }

  listen() {
    const server = dgram.createSocket("udp4");

    server.on("error", (err: any) => {
      console.log(`server error:\n${err.stack}`);
      server.close();
    });

    server.on("message", (msg: any) => {
      var decoded = msg;
      var message = JSON.parse(decoded);
      this.blockEmitter.emit("newBlock", message);
    });

    server.on("listening", () => {
      console.log(`Listening for blocks on port: ${this._port}`);
    });

    server.bind(parseInt(this._port));
  }
}
