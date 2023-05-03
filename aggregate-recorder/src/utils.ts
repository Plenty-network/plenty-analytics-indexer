import fs from "fs";
import axios from "axios";
import { config } from "./config";

// Retries axios connection every 3 seconds
export const addRetryToAxios = () => {
  axios.interceptors.response.use(null, async (error) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(`
      Axios request error: ${error.message},\n
      URL: ${error.config.url}
    `);
    return axios.request(error.config);
  });
};

export const getLastLevel = (): number => {
  if (!fs.existsSync(`/data/level.json`)) {
    return parseInt(config.indexingStart);
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
