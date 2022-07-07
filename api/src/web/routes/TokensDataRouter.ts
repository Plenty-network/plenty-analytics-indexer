import BigNumber from "bignumber.js";
import { Request, Response, Router } from "express";
import { Data, Dependecies, PoolsResponse, TransactionsResponse } from "../../types";

function getAmmContractsForToken(tokenSymbol: string, data: Data) : string {
  const ammAddressList = new Set<string>();
  for(const ammContract of Object.keys(data.amm)) {
    if(data.amm[ammContract].token1.symbol === tokenSymbol || data.amm[ammContract].token2.symbol === tokenSymbol) {
      ammAddressList.add(`'${ammContract}'`);
    }
  }
  // console.log(ammAddressList.size);
  return Array.from(ammAddressList).join();
}

function build({ dbClient, data }: Dependecies): Router {
  const router = Router();

  function createTransactionsData(row: any): TransactionsResponse {
    const tokenOneSymbol = data.amm[row.amm].token1.symbol;
    const tokenTwoSymbol = data.amm[row.amm].token2.symbol;
    const tokenOneAmount = new BigNumber(row.token_1)
      .dividedBy(new BigNumber(10).pow(data.tokens[tokenOneSymbol].decimals))
      .toString();
    const tokenTwoAmount = new BigNumber(row.token_2)
      .dividedBy(new BigNumber(10).pow(data.tokens[tokenTwoSymbol].decimals))
      .toString();
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

  function createPoolsData(row: any): PoolsResponse {
    const tokenOneSymbol = data.amm[row.amm].token1.symbol;
    const tokenTwoSymbol = data.amm[row.amm].token2.symbol;
    return {
      amm: row.amm,
      tvl: row.tvl,
      volume24Hours: row.volume_24h,
      volume7Days: row.volume_7d,
      tokenOneSymbol,
      tokenTwoSymbol,
    };
  }

  router.get("/add-liquidity-data", async (req: Request, res: Response) => {
    try {
      const tokenSymbol = req.query.token_symbol as string;
      if (!tokenSymbol || tokenSymbol === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const allAMMforToken = getAmmContractsForToken(tokenSymbol, data);
        const addLiqData = await dbClient.get({
          select: "op_hash, value, token_1, token_2, account, ts, amm",
          table: "add_liquidity",
          where: `amm in (${allAMMforToken}) AND op_hash IS NOT NULL ORDER BY ts DESC`,
        });
        
        if (addLiqData.rowCount > 0) {
          const responseData = addLiqData.rows.map(createTransactionsData);
          res.status(200).json({ data: responseData, message: "SUCCESS" });
        } else {
          res.status(200).json({ data: [], message: "SUCCESS" });
        }
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/remove-liquidity-data", async (req: Request, res: Response) => {
    try {
      const tokenSymbol = req.query.token_symbol as string;
      if (!tokenSymbol || tokenSymbol === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const allAMMforToken = getAmmContractsForToken(tokenSymbol, data);
        const removeLiqData = await dbClient.get({
          select: "op_hash, value, token_1, token_2, account, ts, amm",
          table: "remove_liquidity",
          where: `amm in (${allAMMforToken}) AND op_hash IS NOT NULL ORDER BY ts DESC`,
        });
        
        if (removeLiqData.rowCount > 0) {
          const responseData = removeLiqData.rows.map(createTransactionsData);
          res.status(200).json({ data: responseData, message: "SUCCESS" });
        } else {
          res.status(200).json({ data: [], message: "SUCCESS" });
        }
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/swaps-data", async (req: Request, res: Response) => {
    try {
      const tokenSymbol = req.query.token_symbol as string;
      if (!tokenSymbol || tokenSymbol === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const allAMMforToken = getAmmContractsForToken(tokenSymbol, data);
        const swapsData = await dbClient.get({
          select: "op_hash, value, token_1, token_2, account, ts, amm",
          table: "swap",
          where: `amm in (${allAMMforToken}) AND op_hash IS NOT NULL ORDER BY ts DESC`,
        });
        
        if (swapsData.rowCount > 0) {
          const responseData = swapsData.rows.map(createTransactionsData);
          res.status(200).json({ data: responseData, message: "SUCCESS" });
        } else {
          res.status(200).json({ data: [], message: "SUCCESS" });
        }
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/pools-data", async (req: Request, res: Response) => {
    try {
      const tokenSymbol = req.query.token_symbol as string;
      if (!tokenSymbol || tokenSymbol === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const currentTime = new Date().getTime();
        const twentyFourHoursAgo = new Date(currentTime - 24 * 60 * 60 * 1000).getTime();
        const allAMMforToken = getAmmContractsForToken(tokenSymbol, data);
        const poolsData = await dbClient.getFunction({
          select: "*",
          // function: `FetchAllPoolDataForAmm(${Math.floor(twentyFourHoursAgo / 1000)},${Math.floor(currentTime / 1000)},ARRAY[${allAMMforToken}])`,    //TODO: Uncomment
          function: `FetchAllPoolDataForAmm(1653015044,1653127514,ARRAY[${allAMMforToken}])`, //TODO: Remove this line
        });
        if (poolsData.rowCount > 0) {
          const responseData = poolsData.rows.map(createPoolsData);
          res.status(200).json({ data: responseData, message: "SUCCESS" });
        } else {
          res.status(200).json({ data: [], message: "SUCCESS" });
        }
      }
      
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  return router;
}

export default build;
