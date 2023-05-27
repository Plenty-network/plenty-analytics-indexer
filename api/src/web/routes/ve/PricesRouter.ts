import BigNumber from "bignumber.js";
import { convertToMap } from "../../../utils";
import { Request, Response, Router } from "express";
import { Dependencies, PriceResponse } from "../../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/:token?", async (req: Request<{ token: string | undefined }>, res: Response) => {
    try {
      // Fetch system wide pools and tokens data
      const data = await getData();

      // Check request params validity
      if (req.params.token && !data.tokens[req.params.token]) {
        res.json({ error: "Token does not exist." });
        return;
      }

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp

      // Fetch aggregated token record closest (<=) to supplied timestamp
      async function getClosePriceAggregate(ts: number) {
        if (!req.params.token) {
          return await dbClient.raw(`
          SELECT t.token, t.close_price
          FROM (
            SELECT MAX(ts) mts, token 
            FROM token_aggregate_hour WHERE ts<=${ts} GROUP BY token
          ) r
          JOIN token_aggregate_hour t ON
            t.token=r.token AND t.ts=r.mts;
        `);
        } else {
          return await dbClient.raw(`
          SELECT t.token, t.close_price
          FROM (
            SELECT MAX(ts) mts
            FROM token_aggregate_hour WHERE ts<=${ts} AND token='${req.params.token}'
          ) r
          JOIN token_aggregate_hour t ON
            t.ts=r.mts;
        `);
        }
      }

      // Last aggregated data in the form of { token-symbol: { close-price } }
      const lastAggregateCH = convertToMap((await getClosePriceAggregate(tch)).rows, "token");

      const tokens: PriceResponse[] = [];

      // Loop through every token in the system
      for (const token of req.params.token ? [req.params.token] : Object.keys(data.tokens)) {
        tokens.push({
          token,
          price: new BigNumber(lastAggregateCH[token]?.close_price ?? 0).toString(),
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
