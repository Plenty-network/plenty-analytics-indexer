import { Request, Response, Router } from "express";
import { Dependencies, TransactionResponse } from "../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  interface Query {
    pool?: string;
    token?: string;
  }

  router.get("/", async (req: Request<{}, {}, {}, Query>, res: Response) => {
    try {
      // Get system wide amm and tokens data
      const data = await getData();

      let transactions: TransactionResponse[];

      if (req.query.pool) {
        if (!data.amm.includes(req.query.pool)) {
          res.json({ error: "Pool does not exist." });
          return;
        }
        // Select transactions where the given pool is involved
        const _entry = await dbClient.raw(`
          SELECT
            ts timestamp,
            hash opHash,
            amm pool,
            account,
            type,
            token_1_amount token1Amount,
            token_2_amount token2Amount,
            value
          FROM transaction
          WHERE amm='${req.query.pool}'
          ORDER BY ts
          LIMIT 100;
        `);
        transactions = _entry.rows;
      } else if (req.query.token) {
        if (!data.token.includes(req.query.token)) {
          res.json({ error: "Token does not exist." });
          return;
        }

        // Select transactions where the given token is involved
        const _entry = await dbClient.raw(`
          SELECT
            t.ts timestamp,
            t.hash opHash,
            t.amm pool,
            t.account,
            t.type,
            t.token_1_amount token1Amount,
            t.token_2_amount token2Amount,
            t.value
          FROM transaction t
          JOIN data d ON t.amm=d.amm
          WHERE d.token_1='${req.query.token}' OR d.token_2='${req.query.token}'
          ORDER BY ts
          LIMIT 100;
        `);

        transactions = _entry.rows;
      } else {
        // Select top transactions by ts
        const _entry = await dbClient.raw(`
          SELECT 
            ts timestamp,
            hash opHash,
            amm pool,
            account,
            type,
            token_1_amount token1Amount,
            token_2_amount token2Amount,
            value
          FROM transaction
          ORDER BY ts
          LIMIT 100;
        `);
        transactions = _entry.rows;
      }

      res.json(transactions).status(200);
    } catch (err) {
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
      console.error(err.message);
    }
  });

  return router;
}

export default build;
