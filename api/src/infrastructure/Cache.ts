import { CachedValue } from "../types";

export default class Cache {
  private _memory: { [key: string]: CachedValue };

  constructor() {
    this._memory = {};
  }

  insert(key: string, data: any, ttl?: number): void {
    this._memory[key] = {
      data,
      storedAt: ttl ? new Date() : undefined,
      ttl,
    };
  }

  get(key: string): any | undefined {
    if (!this._memory[key]) {
      return undefined;
    } else {
      if (!this._memory[key].ttl) {
        return this._memory[key].data;
      } else {
        if (new Date().getTime() - this._memory[key].storedAt.getTime() > this._memory[key].ttl) {
          return undefined;
        } else {
          return this._memory[key].data;
        }
      }
    }
  }
}
