import { Request, Response, Router } from "express";
import { convertToMap } from "../../../utils";
import { Dependencies, VEPoolResponse } from "../../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  interface Query {
    ts: number;
  }

  router.get("/", async (req: Request<{}, {}, {}, Query>, res: Response) => {
    try {
      // Fetch system wide pool and token data
      const data = await getData();

      const tc = req.query.ts || Math.floor(new Date().getTime() / 1000); // Timestamp provided or Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const tEpoch = Math.floor(tc / (86400 * 7)) * (86400 * 7); // Current epoch rounded timestamp
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days

      // Fetch aggregated pool records between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `pool_aggregate_hour`,
          select: `
            pool,
            SUM(token_1_volume) as t1volume,
            SUM(token_1_volume_value) as t1volume_value,
            SUM(token_2_volume) as t2volume,
            SUM(token_2_volume_value) as t2volume_value,
            SUM(token_1_fees) as t1fees,
            SUM(token_1_fees_value) as t1fees_value,
            SUM(token_2_fees) as t2fees,
            SUM(token_2_fees_value) as t2fees_value
          `,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY pool`,
        });
      }

      // Fetch pool locked value (<=) to supplied timestamp
      async function getLockedValueAll(ts: number) {
        return await dbClient.raw(`
          SELECT 
            t.pool, 
            t.token_1_locked l1, 
            t.token_1_locked_value l1v, 
            t.token_2_locked l2,
            t.token_2_locked_value l2v
          FROM (
            SELECT MAX(ts) mts, pool 
            FROM pool_aggregate_hour WHERE ts<=${ts} GROUP BY pool
          ) r
          JOIN pool_aggregate_hour t ON
            t.pool=r.pool AND t.ts=r.mts;
        `);
      }

      // Aggregated data in the form of { pool-address: { ...<db_fields> } }
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "pool");
      const aggregate7D = convertToMap((await getAggregate(t7d, tch)).rows, "pool");
      const aggregateEpoch = convertToMap((await getAggregate(tEpoch, tch)).rows, "pool");

      // Last last locked value across all pools
      const lastLockedValueCH = convertToMap((await getLockedValueAll(tch)).rows, "pool");

      const pools: VEPoolResponse[] = [];

      // Loop through every in the system
      for (const pool of data.pools) {
        // Retrieve data fields from DB entry
        const lockedValueCH =
          parseFloat(lastLockedValueCH[pool]?.l1v ?? 0) + parseFloat(lastLockedValueCH[pool]?.l2v ?? 0);

        const vol7D =
          parseFloat(aggregate7D[pool]?.t1volume_value ?? 0) + parseFloat(aggregate7D[pool]?.t1volume_value ?? 0);
        const fees7D =
          parseFloat(aggregate7D[pool]?.t1fees_value ?? 0) + parseFloat(aggregate7D[pool]?.t2fees_value ?? 0);

        const feesEpoch =
          parseFloat(aggregateEpoch[pool]?.t1fees_value ?? 0) + parseFloat(aggregateEpoch[pool]?.t2fees_value ?? 0);

        const vol24H =
          parseFloat(aggregate24H[pool]?.t1volume_value ?? 0) + parseFloat(aggregate24H[pool]?.t2volume_value ?? 0);
        const fees24H =
          parseFloat(aggregate24H[pool]?.t1fees_value ?? 0) + parseFloat(aggregate24H[pool]?.t2fees_value ?? 0);

        pools.push({
          pool: pool,
          volume24H: {
            value: vol24H.toFixed(6),
            token1: parseFloat(aggregate24H[pool]?.t1volume ?? 0).toFixed(6),
            token2: parseFloat(aggregate24H[pool]?.t2volume ?? 0).toFixed(6),
          },
          volume7D: {
            value: vol7D.toFixed(6),
            token1: parseFloat(aggregate7D[pool]?.t1volume ?? 0).toFixed(6),
            token2: parseFloat(aggregate7D[pool]?.t2volume ?? 0).toFixed(6),
          },
          fees24H: {
            value: fees24H.toFixed(6),
            token1: parseFloat(aggregate24H[pool]?.t1fees ?? 0).toFixed(6),
            token2: parseFloat(aggregate24H[pool]?.t2fees ?? 0).toFixed(6),
          },
          fees7D: {
            value: fees7D.toFixed(6),
            token1: parseFloat(aggregate7D[pool]?.t1fees ?? 0).toFixed(6),
            token2: parseFloat(aggregate7D[pool]?.t2fees ?? 0).toFixed(6),
          },
          feesEpoch: {
            value: feesEpoch.toFixed(6),
            token1: parseFloat(aggregateEpoch[pool]?.t1fees ?? 0).toFixed(6),
            token2: parseFloat(aggregateEpoch[pool]?.t2fees ?? 0).toFixed(6),
          },
          tvl: {
            value: lockedValueCH.toFixed(6),
            token1: parseFloat(lastLockedValueCH[pool]?.l1 ?? 0).toFixed(6),
            token2: parseFloat(lastLockedValueCH[pool]?.l2 ?? 0).toFixed(6),
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
