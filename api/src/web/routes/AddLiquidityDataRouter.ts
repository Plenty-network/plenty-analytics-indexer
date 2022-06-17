import BigNumber from "bignumber.js";
import { Request, Response, Router } from "express";
import { Dependecies, LiquidityResponse } from "../../types";

function build({ dbClient, contracts }: Dependecies): Router {
  const router = Router();

  function createResponseData(row: any): LiquidityResponse {
    const tokenOneAddress = contracts.amm[row.amm].token1;
    const tokenTwoAddress = contracts.amm[row.amm].token2;
    const tokenOneAmount = new BigNumber(row.token_1)
      .dividedBy(new BigNumber(10).pow(contracts.tokens[tokenOneAddress].decimals))
      .toString();
    const tokenTwoAmount = new BigNumber(row.token_2)
      .dividedBy(new BigNumber(10).pow(contracts.tokens[tokenTwoAddress].decimals))
      .toString();
    return {
      opHash: row.op_hash,
      totalValue: row.value,
      tokenOneAmount,
      tokenTwoAmount,
      userAccount: row.account,
      timeStamp: new Date(row.ts * 1000),
      tokenOneAddress,
      tokenTwoAddress,
    };
  }

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const addLiqData = await dbClient.get({
        select: "op_hash, value, token_1, token_2, account, ts, amm",
        table: "add_liquidity",
        where: "op_hash IS NOT NULL ORDER BY ts DESC",
      });
      
      if (addLiqData.rowCount > 0) {
        const responseData = addLiqData.rows.map(createResponseData);
        res.status(200).json({ data: responseData, message: "SUCCESS" });
      } else {
        res.status(200).json({ data: [], message: "SUCCESS" });
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });
  return router;
}

export default build;
