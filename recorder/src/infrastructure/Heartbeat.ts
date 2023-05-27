import axios from "axios";

import { Config } from "../types";

export default class HeartBeat {
  private _heartbeatURL: string;
  private _interval: any;

  constructor({ heartbeatURL }: Config) {
    this._heartbeatURL = heartbeatURL;
  }

  start(): void {
    this._pump();
    this._interval = setInterval(() => this._pump(), 60000);
  }

  stop(): void {
    clearInterval(this._interval);
  }

  private async _pump(): Promise<void> {
    try {
      await axios.get(this._heartbeatURL);
    } catch (_) {
      console.error("Unable to reach heartbeat service!");
    }
  }
}
