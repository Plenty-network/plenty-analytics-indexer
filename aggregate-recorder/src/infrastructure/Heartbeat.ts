import axios from "axios";

import { Config } from "../types";

export default class HeartBeat {
  private _heartbeatURL: string;

  constructor({ heartbeatURL }: Config) {
    this._heartbeatURL = heartbeatURL;
  }

  start(): void {
    this._pump();
    setInterval(() => this._pump(), 60000);
  }

  private async _pump(): Promise<void> {
    try {
      await axios.get(this._heartbeatURL);
    } catch (_) {
      console.error("Unable to reach heartbeat service!");
    }
  }
}
