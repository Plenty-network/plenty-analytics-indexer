import axios from "axios";

import Messenger from "./Messenger";
import { Config } from "../types";

export default class BlockMonitor {
  private _tzktURL: string;
  private _lastBlockHash: string;

  constructor({ tzktURL }: Config) {
    this._lastBlockHash = "";
    this._tzktURL = tzktURL;
  }

  monitor(messenger: Messenger): void {
    setInterval(() => this.getBlock(messenger), 1000);
  }

  private async getBlock(messenger: Messenger): Promise<void> {
    try {
      const block = (await axios.get(`${this._tzktURL}/head`)).data;
      if (block.hash === this._lastBlockHash) {
        return;
      } else {
        this._lastBlockHash = block.hash;
        console.log(`Found Block ${block.hash} at ${block.timestamp}`);
        messenger.broadcast({
          level: block.level,
        });
      }
    } catch (err) {
      console.error(err);
    }
  }
}
