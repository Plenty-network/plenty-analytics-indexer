import { Request, Response, Router } from "express";
import { convertToMap, percentageChange } from "../../utils";
import { Dependencies, PoolResponse } from "../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/:pool?", async (req: Request<{ pool: string | undefined }>, res: Response) => {
    try {
      // Fetch system wide amm and token data
      const data = await getData();

      // Check request params validity
      if (req.params.pool && !data.amm.includes(req.params.pool)) {
        res.json({ error: "Pool does not exist." });
        return;
      }

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t48h = tch - 48 * 3600; // Current hourly - 48 hours
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days
      const t1y = tch - 365 * 86400; // Current hourly - 1 year

      // Fetch aggregated amm records between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `amm_aggregate_hour`,
          select: `
            amm, 
            SUM(token_1_volume_value) as t1volume,
            SUM(token_2_volume_value) as t2volume,
            SUM(token_1_fees_value) as t1fees,
            SUM(token_2_fees_value) as t2fees
          `,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY amm`,
        });
      }

      // Fetch AMM locked value (<=) to supplied timestamp
      async function getLockedValueAll(ts: number) {
        return await dbClient.raw(`
          SELECT t.amm, t.token_1_locked_value l1, t.token_2_locked_value l2
          FROM (
            SELECT MAX(ts) mts, amm 
            FROM amm_aggregate_hour WHERE ts<=${ts} GROUP BY amm
          ) r
          JOIN amm_aggregate_hour t ON
            t.amm=r.amm AND t.ts=r.mts;
        `);
      }

      // Aggregated data in the form of { amm-address: { t1volume, t2volume, t1fees, t2fees } }
      const aggregate48H = convertToMap((await getAggregate(t48h, t24h)).rows, "amm");
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "amm");
      const aggregate7D = convertToMap((await getAggregate(t7d, tch)).rows, "amm");

      // Last last locked value across all AMMs
      const lastLockedValue24H = convertToMap((await getLockedValueAll(t24h)).rows, "amm");
      const lastLockedValueCH = convertToMap((await getLockedValueAll(tch)).rows, "amm");

      let aggregate1Y = [];
      if (req.params.pool) {
        // Fetch a year's worth of aggregated data if a specific pool is supplied in the params
        const _entry = await dbClient.get({
          table: `amm_aggregate_day`,
          select: `
            ts,
            token_1_volume_value t1volume,
            token_2_volume_value t2volume,
            token_1_fees_value t1fees,
            token_2_fees_value t2fees,
            token_1_locked_value t1locked,
            token_2_locked_value t2locked
          `,
          where: `amm='${req.params.pool}' AND ts>=${t1y} AND ts<=${tch} ORDER BY ts`,
        });
        aggregate1Y = _entry.rows;
      }

      const pools: PoolResponse[] = [];

      // Loop through every pool/amm in the system
      for (const amm of req.params.pool ? [req.params.pool] : data.amm) {
        // Retrieve data fields from DB entry
        const lockedValueCH = parseFloat(lastLockedValueCH[amm]?.l1 ?? 0) + parseFloat(lastLockedValueCH[amm]?.l2 ?? 0);
        const lockedValue24H =
          parseFloat(lastLockedValue24H[amm]?.l1 ?? 0) + parseFloat(lastLockedValue24H[amm]?.l2 ?? 0);

        const vol7D = parseFloat(aggregate7D[amm]?.t1volume ?? 0) + parseFloat(aggregate7D[amm]?.t2volume ?? 0);
        const fees7D = parseFloat(aggregate7D[amm]?.t1fees ?? 0) + parseFloat(aggregate7D[amm]?.t2fees ?? 0);

        const vol48H = parseFloat(aggregate48H[amm]?.t1volume ?? 0) + parseFloat(aggregate48H[amm]?.t2volume ?? 0);
        const vol24H = parseFloat(aggregate24H[amm]?.t1volume ?? 0) + parseFloat(aggregate24H[amm]?.t2volume ?? 0);

        const fees48H = parseFloat(aggregate48H[amm]?.t1fees ?? 0) + parseFloat(aggregate48H[amm]?.t2fees ?? 0);
        const fees24H = parseFloat(aggregate24H[amm]?.t1fees ?? 0) + parseFloat(aggregate24H[amm]?.t2fees ?? 0);

        const volumeHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: (parseFloat(item.t1volume) + parseFloat(item.t2volume)).toFixed(6),
          };
        });
        const feesHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: (parseFloat(item.t1fees) + parseFloat(item.t2fees)).toFixed(6),
          };
        });
        const tvlHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: string }>{
            [item.ts]: (parseFloat(item.t1locked) + parseFloat(item.t2locked)).toFixed(6),
          };
        });

        pools.push({
          pool: amm,
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
