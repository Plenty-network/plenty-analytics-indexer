import BigNumber from "bignumber.js";
import { Request, Response, Router } from "express";
import { convertToMap, percentageChange } from "../../../utils";
import { Dependencies, PriceOHLC, TokenResponse } from "../../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  interface Query {
    historical?: string;
    priceHistory?: string;
  }

  router.get("/:token?", async (req: Request<{ token: string | undefined }, {}, {}, Query>, res: Response) => {
    try {
      // Default queries
      if (req.query.historical === undefined || req.query.historical !== "false") {
        req.query.historical = "true";
      }
      if (req.query.priceHistory === undefined || req.query.priceHistory !== "day") {
        req.query.priceHistory = "hour";
      }

      // Fetch system wide pool and token data
      const data = await getData();

      // Check request params validity
      if (req.params.token && !data.tokens[req.params.token]) {
        res.json({ error: "Token does not exist." });
        return;
      }

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t48h = tch - 48 * 3600; // Current hourly - 48 hours
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days
      const t30d = tch - 30 * 86400; // Current hourly - 30 days

      const t0 = Math.floor(tc / 86400) * 86400; // Current daily rounded timestamp
      const t365 = t0 - 365 * 86400; // Current daily - 1 year

      // Fetch aggregated token records between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `token_aggregate_hour`,
          select: `token, SUM(volume_value) as volume, SUM(fees_value) as fees`,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY token`,
        });
      }

      // Fetch aggregated token record closest (<=) to supplied timestamp
      async function getClosePriceAggregate(ts: number) {
        return await dbClient.raw(`
          SELECT t.token, t.close_price
          FROM (
            SELECT MAX(ts) mts, token 
            FROM token_aggregate_hour WHERE ts<=${ts} GROUP BY token
          ) r
          JOIN token_aggregate_hour t ON
            t.token=r.token AND t.ts=r.mts;
        `);
      }

      // Returns the locked value
      async function getLockedValueHour(ts: number) {
        return await dbClient.get({
          table: `token_aggregate_hour`,
          select: `token, locked_value as locked`,
          where: `ts=(SELECT MAX(ts) FROM token_aggregate_hour WHERE ts<=${ts})`,
        });
      }

      // Aggregated data in the form of { token-symbol: { volume, fees } }
      const aggregate48H = convertToMap((await getAggregate(t48h, t24h)).rows, "token");
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "token");
      const aggregate7D = convertToMap((await getAggregate(t7d, tch)).rows, "token");

      // Last aggregated data in the form of { token-symbol: { close-price } }
      const lastAggregate24H = convertToMap((await getClosePriceAggregate(t24h)).rows, "token");
      const lastAggregate7D = convertToMap((await getClosePriceAggregate(t7d)).rows, "token");
      const lastAggregate30D = convertToMap((await getClosePriceAggregate(t30d)).rows, "token");
      const lastAggregateCH = convertToMap((await getClosePriceAggregate(tch)).rows, "token");

      // Last locked values
      const lastLockedValue24H = convertToMap((await getLockedValueHour(t24h)).rows, "token");
      const lastLockedValueCH = convertToMap((await getLockedValueHour(tch)).rows, "token");

      let aggregate1Y = [];
      let historicalPrices = [];

      if (req.params.token && req.query.historical === "true") {
        // Fetch a year's worth of aggregated data if a specific token is supplied in the params
        const _entry = await dbClient.get({
          table: `token_aggregate_day`,
          select: `
            ts,
            volume_value,
            fees_value,
            locked_value
          `,
          where: `token='${req.params.token}' AND ts>=${t365} AND ts<=${t0} ORDER BY ts`,
        });
        aggregate1Y = _entry.rows;

        // Fetch historical price candles
        const __entry = await dbClient.get({
          table: `token_aggregate_${req.query.priceHistory}`,
          select: `
            ts,
            open_price o,
            high_price h,
            low_price l,
            close_price c
          `,
          where: `token='${req.params.token}' AND ts>=${req.query.priceHistory === "hour" ? t7d : t365} AND ts<=${
            req.query.priceHistory === "hour" ? tch : t0
          } ORDER BY ts`,
        });
        historicalPrices = __entry.rows;
      }

      const tokens: TokenResponse[] = [];

      // Loop through every token in the system
      for (const token of req.params.token ? [req.params.token] : Object.keys(data.tokens)) {
        // Retrieve data fields from DB entry
        const priceCH = parseFloat(lastAggregateCH[token]?.close_price ?? 0);
        const price24H = parseFloat(lastAggregate24H[token]?.close_price ?? 0);
        const price7D = parseFloat(lastAggregate7D[token]?.close_price ?? 0);
        const price30D = parseFloat(lastAggregate30D[token]?.close_price ?? 0);

        const lockedValueCH = parseFloat(lastLockedValueCH[token]?.locked ?? 0);
        const lockedValue24H = parseFloat(lastLockedValue24H[token]?.locked ?? 0);

        const vol7D = parseFloat(aggregate7D[token]?.volume ?? 0);
        const fees7D = parseFloat(aggregate7D[token]?.fees ?? 0);

        const vol48H = parseFloat(aggregate48H[token]?.volume ?? 0);
        const fees48H = parseFloat(aggregate48H[token]?.fees ?? 0);

        const vol24H = parseFloat(aggregate24H[token]?.volume ?? 0);
        const fees24H = parseFloat(aggregate24H[token]?.fees ?? 0);

        const priceHistory: { [key: string]: PriceOHLC }[] = [];
        for (
          let t = req.query.priceHistory === "hour" ? t7d : t365, i = 0;
          t <= (req.query.priceHistory === "hour" ? tch : t0), i < historicalPrices.length;
          t += req.query.priceHistory === "hour" ? 3600 : 86400
        ) {
          if (historicalPrices[i].ts == t) {
            priceHistory.push({
              [t]: {
                o: historicalPrices[i].o,
                h: historicalPrices[i].h,
                l: historicalPrices[i].l,
                c: historicalPrices[i].c,
              },
            });
            i++;
          } else if (i > 0) {
            priceHistory.push({
              [t]: {
                o: historicalPrices[i - 1].c,
                h: historicalPrices[i - 1].c,
                l: historicalPrices[i - 1].c,
                c: historicalPrices[i - 1].c,
              },
            });
          }
        }

        const volumeHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: item.volume_value,
          };
        });
        const feesHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: item.fees_value,
          };
        });
        const tvlHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: item.locked_value,
          };
        });

        tokens.push({
          token,
          name: data.tokens[token].name,
          contract: data.tokens[token].address,
          standard: data.tokens[token].standard,
          tokenId: data.tokens[token].tokenId,
          decimals: data.tokens[token].decimals,
          price: {
            value: new BigNumber(lastAggregateCH[token]?.close_price ?? 0).toString(),
            change24H: percentageChange(price24H, priceCH), // (closing price 24 hrs ago, last closing price)
            change7D: percentageChange(price7D, priceCH), // (closing price 7 days ago, last closing price)
            change30D: percentageChange(price30D, priceCH), // (closing price 30 days ago, last closing price)
            history: req.params.token && req.query.historical === "true" ? priceHistory : undefined,
          },
          volume: {
            value24H: vol24H.toString(),
            // (aggregated volume 48 hrs -> 24 hrs ago, aggregated volume 24 hrs -> now)
            change24H: percentageChange(vol48H, vol24H),
            value7D: vol7D.toString(),
            history: req.params.token && req.query.historical === "true" ? volumeHistory : undefined,
          },
          fees: {
            value24H: fees24H.toString(),
            // (aggregated fees 48 hrs -> 24 hrs ago, aggregated fees 24 hrs -> now)
            change24H: percentageChange(fees48H, fees24H),
            value7D: fees7D.toString(),
            history: req.params.token && req.query.historical === "true" ? feesHistory : undefined,
          },
          tvl: {
            value: lockedValueCH.toFixed(6),
            // (tvl record 24 hrs ago, last tvl record)
            change24H: percentageChange(lockedValue24H, lockedValueCH),
            history: req.params.token && req.query.historical === "true" ? tvlHistory : undefined,
          },
        });
      }

      res.json(tokens).status(200);
    } catch (err) {
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
      console.error(err.message);
    }
  });

  return router;
}

export default build;
