import { Request, Response, Router } from "express";
import { Dependecies, PriceOHLC, TokenResponse } from "../../types";
import { convertToMap, percentageChange } from "../../utils";

function build({ dbClient, data }: Dependecies): Router {
  const router = Router();

  router.get("/:token?", async (req: Request<{ token: string | undefined }>, res: Response) => {
    try {
      // Check request params validity
      if (req.params.token && !data.token.includes(req.params.token)) {
        res.json({ error: "Token does not exist." });
      }

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t48h = tch - 48 * 3600; // Current hourly - 48 hours
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days
      const t1Y = tch - 365 * 86400; // Current hourly - 1 year

      // Fetch aggregated token records between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `token_aggregate_hour`,
          select: `token, SUM(volume_value) as volume, SUM(fees_value) as fees`,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY token`,
        });
      }

      // Fetch aggregated token record closest (<=) to supplied timestamp
      async function getLastAggregate(ts: number) {
        return await dbClient.raw(`
          SELECT t.token, t.close_price, t.locked_value 
          FROM (
            SELECT MAX(ts) mts, token 
            FROM token_aggregate_hour WHERE ts<=${ts} GROUP BY token
          ) r
          JOIN token_aggregate_hour t on
            t.token=r.token AND t.ts=r.mts;
        `);
      }

      // Aggregated data in the form of { token-symbol: { volume, fees } }
      const aggregate48H = convertToMap((await getAggregate(t48h, t24h)).rows, "token");
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "token");
      const aggregate7D = convertToMap((await getAggregate(t7d, tch)).rows, "token");

      // Last aggregated data in the form of { token-symbol: { close-price, locked-value } }
      const lastAggregate24H = convertToMap((await getLastAggregate(t24h)).rows, "token");
      const lastAggregateCH = convertToMap((await getLastAggregate(tch)).rows, "token");

      // Fetch a year's worth of aggregated data if a specific token is supplied in the params
      let aggregate1Y = [];
      if (req.params.token) {
        const _entry = await dbClient.get({
          table: `token_aggregate_day`,
          select: `
            ts, 
            open_price o, 
            high_price h, 
            low_price l, 
            close_price c, 
            volume_value,
            fees_value,
            locked_value
          `,
          where: `token='${req.params.token}' AND ts>=${t1Y} AND ts<=${tch} ORDER BY ts`,
        });
        aggregate1Y = _entry.rows;
      }

      const tokens: TokenResponse[] = [];

      // Loop through every token in the system
      for (const token of req.params.token ? [req.params.token] : data.token) {
        // Retrieve data fields from DB entry
        const priceCH = parseFloat(lastAggregateCH[token]?.close_price ?? 0);
        const price24H = parseFloat(lastAggregate24H[token]?.close_price ?? 0);

        const lockedValueCH = parseFloat(lastAggregateCH[token]?.locked_value ?? 0);
        const lockedValue24H = parseFloat(lastAggregate24H[token]?.locked_value ?? 0);

        const vol7D = parseFloat(aggregate7D[token]?.volume ?? 0);
        const fees7D = parseFloat(aggregate7D[token]?.fees ?? 0);

        const vol48H = parseFloat(aggregate48H[token]?.volume ?? 0);
        const vol24H = parseFloat(aggregate24H[token]?.volume ?? 0);

        const fees48H = parseFloat(aggregate48H[token]?.fees ?? 0);
        const fees24H = parseFloat(aggregate24H[token]?.fees ?? 0);

        const priceHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: PriceOHLC }>{
            [item.ts]: {
              o: item.o,
              h: item.h,
              l: item.l,
              c: item.c,
            },
          };
        });
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
          price: {
            value: priceCH.toString(),
            change24H: percentageChange(price24H, priceCH), // (closing price 24 hrs ago, last closing price)
            history: req.params.token ? priceHistory : undefined,
          },
          volume: {
            value24H: vol24H.toString(),
            // (aggregated volume 48 hrs -> 24 hrs ago, aggregated volume 24 hrs -> now)
            change24H: percentageChange(vol48H, vol24H),
            value7D: vol7D.toString(),
            history: req.params.token ? volumeHistory : undefined,
          },
          fees: {
            value24H: fees24H.toString(),
            // (aggregated fees 48 hrs -> 24 hrs ago, aggregated fees 24 hrs -> now)
            change24H: percentageChange(fees48H, fees24H),
            value7D: fees7D.toString(),
            history: req.params.token ? feesHistory : undefined,
          },
          tvl: {
            value: lockedValueCH.toString(),
            // (tvl record 24 hrs ago, last tvl record)
            change24H: percentageChange(lockedValue24H, lockedValueCH),
            history: req.params.token ? tvlHistory : undefined,
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
