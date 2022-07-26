import { Request, Response, Router } from "express";
import { convertToMap, percentageChange } from "../../utils";
import { Dependencies, PriceOHLC, TokenResponse } from "../../types";

function build({ cache, config, getData, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/:token?", async (req: Request<{ token: string | undefined }>, res: Response) => {
    try {
      // Fetch system wide amm and token data
      const data = await getData();

      // Check request params validity
      if (req.params.token && !data.token.includes(req.params.token)) {
        res.json({ error: "Token does not exist." });
      }

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t48h = tch - 48 * 3600; // Current hourly - 48 hours
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days
      const t1y = tch - 365 * 86400; // Current hourly - 1 year

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

      // Returns the locked value across individual tokens of all AMMs.
      async function getLockedValueAll(ts: number, num: number) {
        return await dbClient.raw(`
          SELECT d.token_${num}, SUM(t.token_${num}_locked_value)
          FROM (
            SELECT MAX(ts) mts, amm 
            FROM amm_aggregate_hour WHERE ts<=${ts} GROUP BY amm
          ) r
          JOIN data d ON
            r.amm=d.amm
          JOIN amm_aggregate_hour t ON
            r.mts=t.ts AND r.amm=t.amm
          GROUP BY d.token_${num}
        `);
      }

      // Returns the locked value for a specific token across AMMs
      // taking one token at a time from the pair
      async function getLockedValue(ts: number, num: number) {
        return await dbClient.raw(`
          SELECT SUM(t.token_${num}_locked_value)
          FROM (
            SELECT MAX(ts) mts, amm 
            FROM amm_aggregate_hour WHERE ts<=${ts} GROUP BY amm
          ) r
          JOIN data d ON
            r.amm=d.amm
          JOIN amm_aggregate_hour t ON
            r.mts=t.ts AND r.amm=t.amm
          WHERE d.token_${num}='${req.params.token}'
        `);
      }

      // Aggregated data in the form of { token-symbol: { volume, fees } }
      const aggregate48H = convertToMap((await getAggregate(t48h, t24h)).rows, "token");
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "token");
      const aggregate7D = convertToMap((await getAggregate(t7d, tch)).rows, "token");

      // Last aggregated data in the form of { token-symbol: { close-price } }
      const lastAggregate24H = convertToMap((await getClosePriceAggregate(t24h)).rows, "token");
      const lastAggregateCH = convertToMap((await getClosePriceAggregate(tch)).rows, "token");

      // Last locked values across token 1 of all AMMs in the form { token-symbol: { sum } }
      const t1LockedValue24H = convertToMap((await getLockedValueAll(t24h, 1)).rows, "token_1");
      const t1LockedValueCH = convertToMap((await getLockedValueAll(tch, 1)).rows, "token_1");

      // Last locked values across token 2 of all AMMs in the form { token-symbol: { sum } }
      const t2LockedValue24H = convertToMap((await getLockedValueAll(t24h, 2)).rows, "token_2");
      const t2LockedValueCH = convertToMap((await getLockedValueAll(tch, 2)).rows, "token_2");

      let aggregate1Y = [];
      const tvlHistory = [];

      if (req.params.token) {
        // Fetch a year's worth of aggregated data if a specific token is supplied in the params
        const _entry = await dbClient.get({
          table: `token_aggregate_day`,
          select: `
            ts, 
            open_price o, 
            high_price h, 
            low_price l, 
            close_price c, 
            volume_value,
            fees_value
          `,
          where: `token='${req.params.token}' AND ts>=${t1y} AND ts<=${tch} ORDER BY ts`,
        });
        aggregate1Y = _entry.rows;

        const t0 = Math.floor(tc / 86400) * 86400; // Current daily rounded timestamp
        const t365 = t0 - 365 * 86400; // Current daily - 1 year

        // Fetch a year's worth of daily TVL of a specific token
        for (let ts = t365; ts <= t0; ts += 86400) {
          const cached = cache.get(JSON.stringify({ ts, token: req.params.token }));
          let lockedValueTS;
          if (!cached) {
            const t1LockedValueTS = (await getLockedValue(ts, 1)).rows[0];
            const t2LockedValueTS = (await getLockedValue(ts, 2)).rows[0];
            lockedValueTS = parseFloat(t1LockedValueTS.sum ?? 0) + parseFloat(t2LockedValueTS.sum ?? 0);
          } else {
            lockedValueTS = cached;
            cache.insert(JSON.stringify({ ts, token: req.params.token }), lockedValueTS, config.ttl.history);
          }
          if (lockedValueTS > 0) {
            tvlHistory.push({ [ts]: lockedValueTS.toFixed(6) });
          }
        }
      }

      const tokens: TokenResponse[] = [];

      // Loop through every token in the system
      for (const token of req.params.token ? [req.params.token] : data.token) {
        // Retrieve data fields from DB entry
        const priceCH = parseFloat(lastAggregateCH[token]?.close_price ?? 0);
        const price24H = parseFloat(lastAggregate24H[token]?.close_price ?? 0);

        const lockedValueCH =
          parseFloat(t1LockedValueCH[token]?.sum ?? 0) + parseFloat(t2LockedValueCH[token]?.sum ?? 0);
        const lockedValue24H =
          parseFloat(t1LockedValue24H[token]?.sum ?? 0) + parseFloat(t2LockedValue24H[token]?.sum ?? 0);

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
            value: lockedValueCH.toFixed(6),
            // (tvl record 24 hrs ago, last tvl record)
            change24H: percentageChange(lockedValue24H, lockedValueCH),
            history: tvlHistory,
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
