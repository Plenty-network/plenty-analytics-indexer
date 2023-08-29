import fs from "fs";
import { config } from "../config";

export const getLastLevel = (): number => {
  if (!fs.existsSync(`/data/level.json`)) {
    return parseInt(config.indexingStart) - config.reorgLag;
  }
  return JSON.parse(fs.readFileSync(`/data/level.json`).toString()).level;
};

export const recordLastLevel = (level: number) => {
  console.log(`Recorded level: ${level}`);
  if (!fs.existsSync(`/data`)) {
    fs.mkdirSync("/data");
  }
  fs.writeFileSync(`/data/level.json`, JSON.stringify({ level }));
};
