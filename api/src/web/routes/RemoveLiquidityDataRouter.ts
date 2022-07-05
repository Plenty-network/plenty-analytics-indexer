import BigNumber from "bignumber.js";
import { Request, Response, Router } from "express";
import { Dependecies, TransactionsResponse } from "../../types";

function build({ dbClient, data }: Dependecies): Router {
  const router = Router();

  function createResponseData(row: any): TransactionsResponse {
    const tokenOneAddress = data.amm[row.amm].token1;
    const tokenTwoAddress = data.amm[row.amm].token2;
    const tokenOneAmount = new BigNumber(row.token_1)
      .dividedBy(new BigNumber(10).pow(data.tokens[tokenOneAddress].decimals))
      .toString();
    const tokenTwoAmount = new BigNumber(row.token_2)
      .dividedBy(new BigNumber(10).pow(data.tokens[tokenTwoAddress].decimals))
      .toString();
    const tokenOneSymbol = data.tokens[tokenOneAddress].symbol;
    const tokenTwoSymbol = data.tokens[tokenTwoAddress].symbol;
    return {
      opHash: row.op_hash,
      totalValue: row.value,
      tokenOneAmount,
      tokenTwoAmount,
      userAccount: row.account,
      timeStamp: new Date(row.ts * 1000),
      ammAddress: row.amm,
      tokenOneSymbol,
      tokenTwoSymbol,
    };
  }

  router.get("/:amm_address?", async (req: Request, res: Response) => {
    try {
      const removeLiqData = await dbClient.get({
        select: "op_hash, value, token_1, token_2, account, ts, amm",
        table: "remove_liquidity",
        where: `op_hash IS NOT NULL${req.params.amm_address ? ' AND amm = \'' + req.params.amm_address + '\'' : ''} ORDER BY ts DESC`,
      });
      
      if (removeLiqData.rowCount > 0) {
        const responseData = removeLiqData.rows.map(createResponseData);
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
