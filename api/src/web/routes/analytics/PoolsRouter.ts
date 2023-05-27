import { Request, Response, Router } from "express";
import { convertToMap, percentageChange } from "../../../utils";
import { Dependencies, PoolResponse } from "../../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/:pool?", async (req: Request<{ pool: string | undefined }>, res: Response) => {
    try {
      // Fetch system wide pool and token data
      const data = await getData();

      // Check request params validity
      if (req.params.pool && !data.pools[req.params.pool]) {
        res.json({ error: "Pool does not exist." });
        return;
      }

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t48h = tch - 48 * 3600; // Current hourly - 48 hours
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days

      const t0 = Math.floor(tc / 86400) * 86400; // Current daily rounded timestamp
      const t365 = t0 - 365 * 86400; // Current daily - 1 year

      // Fetch aggregated pool records between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `pool_aggregate_hour`,
          select: `
            pool,
            SUM(volume_value) as volume,
            SUM(fees_value) as t2fees
          `,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY pool`,
        });
      }

      // Fetch pool locked value
      async function getLockedValueHour(ts: number) {
        return await dbClient.get({
          table: `pool_aggregate_hour`,
          select: `pool, token_1_locked as t1locked, token_2_locked t2locked, locked_value as locked`,
          where: `ts=(SELECT MAX(ts) FROM pool_aggregate_hour WHERE ts<=${ts})`,
        });
      }

      // Aggregated data in the form of { pool-address: { volume, fees } }
      const aggregate48H = convertToMap((await getAggregate(t48h, t24h)).rows, "pool");
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "pool");
      const aggregate7D = convertToMap((await getAggregate(t7d, tch)).rows, "pool");

      // Last last locked value across all pools
      const lastLockedValue24H = convertToMap((await getLockedValueHour(t24h)).rows, "pool");
      const lastLockedValueCH = convertToMap((await getLockedValueHour(tch)).rows, "pool");

      let aggregate1Y = [];
      if (req.params.pool) {
        // Fetch a year's worth of aggregated data if a specific pool is supplied in the params
        const _entry = await dbClient.get({
          table: `pool_aggregate_day`,
          select: `
            ts,
            volume_value volume,
            fees_value fees,
            locked_value locked
          `,
          where: `pool='${req.params.pool}' AND ts>=${t365} AND ts<=${t0} ORDER BY ts`,
        });
        aggregate1Y = _entry.rows;
      }

      const pools: PoolResponse[] = [];

      // Loop through every pool/pool in the system
      for (const pool of req.params.pool ? [req.params.pool] : Object.keys(data.pools)) {
        // Retrieve data fields from DB entry
        const lockedValueCH = parseFloat(lastLockedValueCH[pool]?.locked ?? 0);
        const lockedValue24H = parseFloat(lastLockedValue24H[pool]?.locked ?? 0);

        const vol7D = parseFloat(aggregate7D[pool]?.volume ?? 0);
        const fees7D = parseFloat(aggregate7D[pool]?.fees ?? 0);

        const vol24H = parseFloat(aggregate24H[pool]?.volume ?? 0);
        const fees24H = parseFloat(aggregate24H[pool]?.fees ?? 0);

        const vol48H = parseFloat(aggregate48H[pool]?.volume ?? 0);
        const fees48H = parseFloat(aggregate48H[pool]?.fees ?? 0);

        const volumeHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: item.volume,
          };
        });
        const feesHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: item.fees,
          };
        });
        const tvlHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: item.locked,
          };
        });

        pools.push({
          pool: data.pools[pool].address,
          symbol: `${data.pools[pool].token1.symbol}/${data.pools[pool].token2.symbol}`,
          type: data.pools[pool].type,
          volume: {
            value24H: vol24H.toFixed(6),
            // (aggregated volume 48 hrs -> 24 hrs ago, aggregated volume 24 hrs -> now)
            change24H: percentageChange(vol48H, vol24H),
            value7D: vol7D.toFixed(6),
            history: req.params.pool ? volumeHistory : undefined,
          },
          fees: {
            value24H: fees24H.toFixed(6),
            // (aggregated fees 48 hrs -> 24 hrs ago, aggregated fees 24 hrs -> now)
            change24H: percentageChange(fees48H, fees24H),
            value7D: fees7D.toFixed(6),
            history: req.params.pool ? feesHistory : undefined,
          },
          tvl: {
            token1Amount: parseFloat(lastLockedValueCH[pool]?.t1locked ?? 0).toFixed(6),
            token2Amount: parseFloat(lastLockedValueCH[pool]?.t2locked ?? 0).toFixed(6),
            value: lockedValueCH.toFixed(6),
            // (tvl record 24 hrs ago, last tvl record)
            change24H: percentageChange(lockedValue24H, lockedValueCH),
            history: req.params.pool ? tvlHistory : undefined,
          },
        });
      }

      res.json(pools).status(200);
    } catch (err) {
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
      console.error(err.message);
    }
  });

  return router;
}

export default build;
