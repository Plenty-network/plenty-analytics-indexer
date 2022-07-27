import { RpcClient } from "@taquito/rpc";

import Messenger from "./Messenger";
import { Config } from "../types";

export default class BlockMonitor {
  private _rpcClient: RpcClient;
  private _lastBlockHash: string;

  constructor({ tezosRpcURL }: Config) {
    this._lastBlockHash = "";
    this._rpcClient = new RpcClient(tezosRpcURL);
  }

  monitor(messenger: Messenger): void {
    setInterval(() => this.getBlock(messenger), 1000);
  }

  private async getBlock(messenger: Messenger): Promise<void> {
    try {
      const block = await this._rpcClient.getBlock();
      if (block.hash === this._lastBlockHash) {
        return;
      } else {
        this._lastBlockHash = block.hash;
        console.log(`Found Block ${block.hash} at ${block.header.timestamp.toLocaleString()}`);
        messenger.broadcast({
          level: block.header.level,
        });
      }
    } catch (err) {
      console.error(err);
    }
  }
}
