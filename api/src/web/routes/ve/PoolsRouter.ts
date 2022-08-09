import { Request, Response, Router } from "express";
import { convertToMap } from "../../../utils";
import { Dependencies, VEPoolResponse } from "../../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/", async (_: Request, res: Response) => {
    try {
      // Fetch system wide amm and token data
      const data = await getData();

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const tEpoch = Math.floor(tc / (86400 * 7)) * (86400 * 7); // Current epoch rounded timestamp
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days

      // Fetch aggregated amm records between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `amm_aggregate_hour`,
          select: `
            amm,
            SUM(token_1_volume) as t1volume,
            SUM(token_1_volume_value) as t1volume_value,
            SUM(token_2_volume) as t2volume,
            SUM(token_2_volume_value) as t2volume_value,
            SUM(token_1_fees) as t1fees,
            SUM(token_1_fees_value) as t1fees_value,
            SUM(token_2_fees) as t2fees,
            SUM(token_2_fees_value) as t2fees_value
          `,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY amm`,
        });
      }

      // Fetch AMM locked value (<=) to supplied timestamp
      async function getLockedValueAll(ts: number) {
        return await dbClient.raw(`
          SELECT 
            t.amm, 
            t.token_1_locked l1, 
            t.token_1_locked_value l1v, 
            t.token_2_locked l2,
            t.token_2_locked_value l2v
          FROM (
            SELECT MAX(ts) mts, amm 
            FROM amm_aggregate_hour WHERE ts<=${ts} GROUP BY amm
          ) r
          JOIN amm_aggregate_hour t ON
            t.amm=r.amm AND t.ts=r.mts;
        `);
      }

      // Aggregated data in the form of { amm-address: { ...<db_fields> } }
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "amm");
      const aggregate7D = convertToMap((await getAggregate(t7d, tch)).rows, "amm");
      const aggregateEpoch = convertToMap((await getAggregate(tEpoch, tch)).rows, "amm");

      // Last last locked value across all AMMs
      const lastLockedValueCH = convertToMap((await getLockedValueAll(tch)).rows, "amm");

      const pools: VEPoolResponse[] = [];

      // Loop through every pool/amm in the system
      for (const amm of data.amm) {
        // Retrieve data fields from DB entry
        const lockedValueCH =
          parseFloat(lastLockedValueCH[amm]?.l1v ?? 0) + parseFloat(lastLockedValueCH[amm]?.l2v ?? 0);

        const vol7D =
          parseFloat(aggregate7D[amm]?.t1volume_value ?? 0) + parseFloat(aggregate7D[amm]?.t1volume_value ?? 0);
        const fees7D =
          parseFloat(aggregate7D[amm]?.t1fees_value ?? 0) + parseFloat(aggregate7D[amm]?.t2fees_value ?? 0);

        const feesEpoch =
          parseFloat(aggregateEpoch[amm]?.t1fees_value ?? 0) + parseFloat(aggregateEpoch[amm]?.t2fees_value ?? 0);

        const vol24H =
          parseFloat(aggregate24H[amm]?.t1volume_value ?? 0) + parseFloat(aggregate24H[amm]?.t2volume_value ?? 0);
        const fees24H =
          parseFloat(aggregate24H[amm]?.t1fees_value ?? 0) + parseFloat(aggregate24H[amm]?.t2fees_value ?? 0);

        pools.push({
          pool: amm,
          volume24H: {
            value: vol24H.toFixed(6),
            token1: parseFloat(aggregate24H[amm]?.t1volume ?? 0).toFixed(6),
            token2: parseFloat(aggregate24H[amm]?.t2volume ?? 0).toFixed(6),
          },
          volume7D: {
            value: vol7D.toFixed(6),
            token1: parseFloat(aggregate7D[amm]?.t1volume ?? 0).toFixed(6),
            token2: parseFloat(aggregate7D[amm]?.t2volume ?? 0).toFixed(6),
          },
          fees24H: {
            value: fees24H.toFixed(6),
            token1: parseFloat(aggregate24H[amm]?.t1fees ?? 0).toFixed(6),
            token2: parseFloat(aggregate24H[amm]?.t2fees ?? 0).toFixed(6),
          },
          fees7D: {
            value: fees7D.toFixed(6),
            token1: parseFloat(aggregate7D[amm]?.t1fees ?? 0).toFixed(6),
            token2: parseFloat(aggregate7D[amm]?.t2fees ?? 0).toFixed(6),
          },
          feesEpoch: {
            value: feesEpoch.toFixed(6),
            token1: parseFloat(aggregateEpoch[amm]?.t1fees ?? 0).toFixed(6),
            token2: parseFloat(aggregateEpoch[amm]?.t2fees ?? 0).toFixed(6),
          },
          tvl: {
            value: lockedValueCH.toFixed(6),
            token1: parseFloat(lastLockedValueCH[amm]?.l1 ?? 0).toFixed(6),
            token2: parseFloat(lastLockedValueCH[amm]?.l2 ?? 0).toFixed(6),
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
