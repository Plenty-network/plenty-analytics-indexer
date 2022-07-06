import { Request, Response, Router } from "express";
import { Dependecies, PoolsResponse } from "../../types";
import { percentageChange } from "../../helpers";
import BigNumber from "bignumber.js";

function build({ dbClient, data }: Dependecies): Router {
  const router = Router();

  function createResponseData(row: any): PoolsResponse {
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

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const currentTime = new Date().getTime();
      const twentyFourHoursAgo = new Date(currentTime - (24 * 60 * 60 * 1000)).getTime();
      const poolsData = await dbClient.getFunction({
        select: "*",
        // function: `FetchAllPoolData(${Math.floor(twentyFourHoursAgo / 1000)},${Math.floor(currentTime / 1000)})`,    //TODO: Uncomment
        function: "FetchAllPoolData(1653015044,1653127514)",   //TODO: Remove this line
      });
      if (poolsData.rowCount > 0) {
        const responseData = poolsData.rows.map(createResponseData);
        res.status(200).json({ data: responseData, message: "SUCCESS" });
      } else {
        res.status(200).json({ data: [], message: "SUCCESS" });
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/volume-24h-change", async (req: Request, res: Response) => {
    try {
      const ammAddress = req.query.amm_address as string;
      if (!ammAddress || ammAddress === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const currentTime = new Date().getTime();
        const twentyFourHoursAgo = new Date(currentTime - 24 * 60 * 60 * 1000).getTime();
        const fourtyEightHoursAgo = new Date(currentTime - 48 * 60 * 60 * 1000).getTime();
        const twentyFourHoursData = await dbClient.get({
          // select: `sum(CASE WHEN ts >= ${Math.floor(twentyFourHoursAgo / 1000)} and ts <= ${Math.floor(currentTime / 1000)} then value else 0 end) as volume_24H`, //TODO: Uncomment
          select: "sum(CASE WHEN ts >= 1653015044 and ts <= 1653127514 then value else 0 end) as volume_24H", //TODO: Remove this line
          table: "swap",
          where: `amm = '${ammAddress}' group by amm`,
        });
        const fourtyEightHoursData = await dbClient.get({
          // select: `sum(CASE WHEN ts >= ${Math.floor(fourtyEightHoursAgo / 1000)} and ts <= ${Math.floor(currentTime / 1000)} then value else 0 end) as volume_24H`, //TODO: Uncomment
          select: "sum(CASE WHEN ts >= 1652928644 and ts <= 1653127514 then value else 0 end) as volume_48H", //TODO: Remove this line
          table: "swap",
          where: `amm = '${ammAddress}' group by amm`,
        });
        if (twentyFourHoursData.rowCount > 0 && fourtyEightHoursData.rowCount > 0) {
          const twentyFourHoursVolume = new BigNumber(twentyFourHoursData.rows[0].volume_24h);
          const fourtyEightHoursVolume = new BigNumber(fourtyEightHoursData.rows[0].volume_48h);
          const volumeBefore24Hours = fourtyEightHoursVolume.minus(twentyFourHoursVolume);
          const changePercentage = percentageChange(volumeBefore24Hours, twentyFourHoursVolume);
          res
            .status(200)
            .json({
              data: {
                amm: ammAddress,
                volume24Hours: twentyFourHoursVolume.toString(),
                percentageChange: changePercentage,
              },
              message: "SUCCESS",
            });
        } else {
          res
            .status(200)
            .json({ data: { amm: ammAddress, volume24Hours: "0", percentageChange: "0" }, message: "NO_DATA_FOUND" });
        }
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });


  router.get("/fee-24h", async (req: Request, res: Response) => {
    try {
      const ammAddress = req.query.amm_address as string;
      if (!ammAddress || ammAddress === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const currentTime = new Date().getTime();
        const twentyFourHoursAgo = new Date(currentTime - 24 * 60 * 60 * 1000).getTime();
        const twentyFourHoursData = await dbClient.get({
          // select: `sum(CASE WHEN ts >= ${Math.floor(twentyFourHoursAgo / 1000)} and ts <= ${Math.floor(currentTime / 1000)} then fee else 0 end) as fee_24H`, //TODO: Uncomment
          select: "sum(CASE WHEN ts >= 1653015044 and ts <= 1653127514 then fee else 0 end) as fee_24H", //TODO: Remove this line
          table: "swap",
          where: `amm = '${ammAddress}' group by amm`,
        });
        if (twentyFourHoursData.rowCount > 0) {
          const twentyFourHoursFee = twentyFourHoursData.rows[0].fee_24h;
          res
            .status(200)
            .json({
              data: {
                amm: ammAddress,
                fees24Hours: twentyFourHoursFee,
              },
              message: "SUCCESS",
            });
        } else {
          res
            .status(200)
            .json({ data: { amm: ammAddress, fees24Hours: "0", }, message: "NO_DATA_FOUND" });
        }
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });


  router.get("/tvl-24h-change", async (req: Request, res: Response) => {
    try {
      const ammAddress = req.query.amm_address as string;
      if (!ammAddress || ammAddress === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const tvlResponse = await dbClient.getFunction({
          select: "*",
          function: `FetchTvl24hDataChange('${ammAddress}')`
        });
        if (tvlResponse.rowCount > 0) {
          const twentyFourHoursTvl = new BigNumber(tvlResponse.rows[0].tvl);
          const fourtyEightHoursTvl = new BigNumber(tvlResponse.rows[1].tvl);
          const changePercentage = percentageChange(fourtyEightHoursTvl, twentyFourHoursTvl);
          res
            .status(200)
            .json({
              data: {
                amm: ammAddress,
                tvl24Hours: twentyFourHoursTvl.toString(),
                percentageChange: changePercentage,
              },
              message: "SUCCESS",
            });
        } else {
          res
            .status(200)
            .json({ data: { amm: ammAddress, tvl24Hours: "0", percentageChange: "0" }, message: "NO_DATA_FOUND" });
        }
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });


  router.get("/graphs-data", async (req: Request, res: Response) => {
    try {
      const ammAddress = req.query.amm_address as string;
      if (!ammAddress || ammAddress === "") {
        res.status(500).json({ data: [], message: "MISSING_QUERY_ARGUMENT" });
      } else {
        const now = Math.floor(new Date().getTime() / 1000);
        const oneYearBack = Math.floor(
          new Date(new Date(new Date().setFullYear(new Date().getFullYear() - 1)).setHours(0, 0, 0, 0)).getTime() / 1000
        );
        const graphsData = await dbClient.get({
          select: "amm, ts, volume_usd as volume, tvl_usd as tvl, fee_usd as fee",
          table: "amm_aggregate",
          where: `amm = '${ammAddress}' and ts >= ${oneYearBack} and ts <= ${now} ORDER BY ts ASC`,
        });
        if (graphsData.rowCount > 0) {
          const finalGraphsData = graphsData.rows.map((row) => {
            const dateFromDb = new Date(row.ts * 1000);
            const date = `${dateFromDb.toLocaleString("en-GB", { month: "long" })} ${dateFromDb.toLocaleString(
              "en-GB",
              { day: "numeric" }
            )}, ${dateFromDb.toLocaleString("en-GB", { year: "numeric" })}`;
            return {
              amm: row.amm,
              date,
              volume: row.volume,
              tvl: row.tvl,
              fees: row.fee,
            };
          });
          res.status(200).json({
            data: finalGraphsData,
            message: "SUCCESS",
          });
        } else {
          res
            .status(200)
            .json({ data: { amm: ammAddress, date: "NA", volume: 0, tvl: 0, fees: 0 }, message: "NO_DATA_FOUND" });
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
