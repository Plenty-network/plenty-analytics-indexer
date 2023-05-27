import { Response, Router } from "express";
import { convertToMap } from "../../../utils";
import { Dependencies, TickerResponseV2 } from "../../../types";

function build({ dbClient }: Dependencies): Router {
  const router = Router();

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
            SUM(token_1_amount) as t1volume
          `,
          where: `
            ts>=${ts1} AND ts<${ts2} 
              AND
            (type='SWAP_TOKEN_1' OR type='SWAP_TOKEN_2')
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
            (type='SWAP_TOKEN_1' OR type='SWAP_TOKEN_2')
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

      const tickers: TickerResponseV2[] = [];
      Object.keys(pairWiseCH).forEach((pool) => {
        tickers.push({
          market: `${pairWiseCH[pool].token_1}-${pairWiseCH[pool].token_2}`,
          base: pairWiseCH[pool].token_1,
          quote: pairWiseCH[pool].token_2,
          price_quote: (parseFloat(pairWiseCH[pool].t2amount) / parseFloat(pairWiseCH[pool].t1amount)).toFixed(12),
          volume_base: poolAggregate24H[pool]?.t1volume ?? "0",
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
