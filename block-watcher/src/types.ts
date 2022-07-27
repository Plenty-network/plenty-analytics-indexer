export interface Config {
  heartbeatURL: string;
  tezosRpcURL: string;
  broadcastAddress: string;
  ports: string;
}

export interface BlockData {
  level: number;
}
