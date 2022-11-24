import { Request, Response, Router } from "express";
import { convertToMap } from "../../../utils";
import { Dependencies, PriceResponse } from "../../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/", async (_: Request, res: Response) => {
    try {
      // Fetch system wide pools and tokens data
      const data = await getData();

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp

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

      // Last aggregated data in the form of { token-symbol: { close-price } }
      const lastAggregateCH = convertToMap((await getClosePriceAggregate(tch)).rows, "token");

      const tokens: PriceResponse[] = [];

      // Loop through every token in the system
      for (const token of Object.keys(data.tokens)) {
        // Retrieve data fields from DB entry
        const priceCH = parseFloat(lastAggregateCH[token]?.close_price ?? 0);

        tokens.push({
          token,
          price: priceCH.toFixed(6),
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
