import { Response, Router } from "express";
import { convertToMap } from "../../../utils";
import { Dependencies, PairResponse, TickerResponseV1 } from "../../../types";

function build({ dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/pairs", async (_, res: Response) => {
    try {
      const allPairs = await dbClient.raw(`
        SELECT * FROM data;
      `);

      const pairs: PairResponse[] = [];
      allPairs.rows.forEach((pair) =>
        pairs.push({
          tickerId: `${pair.token_1}/${pair.token_2}`,
          base: pair.token_1,
          target: pair.token_2,
          poolId: pair.pool,
        })
      );

      res.json(pairs).status(200);
    } catch (err: any) {
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
      console.error(err.message);
    }
  });

  router.get("/tickers", async (_, res: Response) => {
    try {
      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours

      // Fetch aggregated pool records between two timestamps
      async function getPoolAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `transaction`,
          select: `
            pool, 
            SUM(token_1_amount) as t1volume,
            SUM(token_2_amount) as t2volume
          `,
          where: `
            ts>=${ts1} AND ts<${ts2} 
              AND
            (type='swap_token_1' OR type='swap_token_2')
            GROUP BY pool
            `,
        });
      }

      async function getPairWisePrice(ts: number) {
        return await dbClient.raw(`
          SELECT 
            t.pool, 
            d.token_1, 
            d.token_2, 
            t.token_1_amount t1amount, 
            t.token_2_amount t2amount
          FROM (
            SELECT MAX(ts) mts, pool
            FROM transaction WHERE ts<=${ts} 
              AND
            (type='swap_token_1' OR type='swap_token_2')
            GROUP BY pool
          ) r
          JOIN transaction t ON 
            r.pool=t.pool AND r.mts=t.ts
          JOIN data d ON
            d.pool=t.pool
        `);
      }

      const poolAggregate24H = convertToMap((await getPoolAggregate(t24h, tch)).rows, "pool");
      const pairWiseCH = convertToMap((await getPairWisePrice(tch)).rows, "pool");

      const tickers: TickerResponseV1[] = [];
      Object.keys(pairWiseCH).forEach((pool) => {
        tickers.push({
          tickerId: `${pairWiseCH[pool].token_1}/${pairWiseCH[pool].token_2}`,
          baseCurrency: pairWiseCH[pool].token_1,
          targetCurrency: pairWiseCH[pool].token_2,
          lastPrice: (parseFloat(pairWiseCH[pool].t2amount) / parseFloat(pairWiseCH[pool].t1amount)).toFixed(12),
          baseVolume: poolAggregate24H[pool]?.t1volume ?? "0",
          targetVolume: poolAggregate24H[pool]?.t2volume ?? "0",
          poolId: pool,
        });
      });

      res.json(tickers).status(200);
    } catch (err: any) {
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
      console.error(err.message);
    }
  });

  return router;
}

export default build;
