import { Request, Response, Router } from "express";
import { Dependencies, TransactionResponse } from "../../../types";

function build({ getData, dbClient }: Dependencies): Router {
  const router = Router();

  interface Query {
    pool?: string;
    token?: string;
    account?: string;
    type?: "swap" | "add_liquidity" | "remove_liquidity";
  }

  router.get("/", async (req: Request<{}, {}, {}, Query>, res: Response) => {
    try {
      // Get system wide pools and tokens data
      const data = await getData();

      let transactions: TransactionResponse[];

      // Query validations
      if (req.query.pool) {
        if (req.query.token) {
          res.json({ error: "Token query not allowed along with pool." });
          return;
        } else if (!data.pools.includes(req.query.pool)) {
          res.json({ error: "Pool does not exist." });
          return;
        }
      }

      if (req.query.token) {
        if (req.query.pool) {
          res.json({ error: "Pool query not allowed along with token." });
          return;
        } else if (!data.tokens[req.query.token]) {
          res.json({ error: "Token does not exist." });
          return;
        }
      }

      if (req.query.type && !["swap", "add_liquidity", "remove_liquidity"].includes(req.query.type)) {
        res.json({
          error: "Invalid type query. Choose from 'swap', 'add_liquidity' and 'remove_liquidity'",
        });
        return;
      }

      function getTypeSelector(type: string) {
        if (type === "swap") {
          return `(t.type='swap_token_1' OR t.type='swap_token_2')`;
        } else {
          return `t.type='${type}'`;
        }
      }

      if (req.query.pool) {
        if (!data.pools.includes(req.query.pool)) {
          res.json({ error: "Pool does not exist." });
          return;
        }
        // Select transactions where the given pool is involved
        const _entry = await dbClient.raw(`
          SELECT
            id,
            ts timestamp,
            hash opHash,
            pool,
            account,
            type,
            token_1_amount token1Amount,
            token_2_amount token2Amount,
            value
          FROM transaction t
          WHERE 
            t.pool='${req.query.pool}'
            ${req.query.type ? `AND ${getTypeSelector(req.query.type)}` : ""}
            ${req.query.account ? `AND account='${req.query.account}'` : ""}
          ORDER BY t.ts DESC
          LIMIT 100;
        `);
        transactions = _entry.rows;
      } else if (req.query.token) {
        // Select transactions where the given token is involved
        const _entry = await dbClient.raw(`
          SELECT
            t.id,
            t.ts timestamp,
            t.hash opHash,
            t.pool,
            t.account,
            t.type,
            t.token_1_amount token1Amount,
            t.token_2_amount token2Amount,
            t.value
          FROM transaction t
          JOIN data d ON t.pool=d.pool
          WHERE (d.token_1='${req.query.token}' OR d.token_2='${req.query.token}')
          ${req.query.type ? `AND ${getTypeSelector(req.query.type)}` : ""}
          ${req.query.account ? `AND account='${req.query.account}'` : ""}
          ORDER BY t.ts DESC
          LIMIT 100;
        `);

        transactions = _entry.rows;
      } else {
        // Select top transactions by ts
        const _entry = await dbClient.raw(`
          SELECT 
            id,
            ts timestamp,
            hash opHash,
            pool,
            account,
            type,
            token_1_amount token1Amount,
            token_2_amount token2Amount,
            value
          FROM transaction t
          ${req.query.type ? `WHERE ${getTypeSelector(req.query.type)}` : ""}
          ${req.query.account ? `${req.query.type ? "AND" : "WHERE"} account='${req.query.account}'` : ""}
          ORDER BY t.ts DESC
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
