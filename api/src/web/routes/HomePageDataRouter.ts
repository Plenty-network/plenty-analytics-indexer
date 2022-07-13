import BigNumber from "bignumber.js";
import { Request, Response, Router } from "express";
import { percentageChange } from "../../helpers";
import { Dependecies, VolumeGraphData, VolumeGraphRow } from "../../types";
import { getWeek, getYear, startOfWeek, lastDayOfWeek, getMonth, startOfMonth, lastDayOfMonth } from "date-fns";

function createWeeklyData(dailyData: any[]): VolumeGraphRow[] {
  const weeklyData: VolumeGraphData = {};
  dailyData.forEach((data: { ts: number; volume: string }) => {
    const date = new Date(data.ts * 1000);
    const weekStartDate = startOfWeek(date); // Currently considering Sunday as start of the week. Can change by passing other day as options.
    const weekEndDate = lastDayOfWeek(date); // Currently considering Sunday as start of the week. Can change by passing other day as options.
    const weekNumber = getWeek(date);
    const year = getYear(date);
    const weekYear = `${weekNumber}-${year}`;
    if (!weeklyData[weekYear]) {
      weeklyData[weekYear] = {
        startDay: `${weekStartDate.toLocaleString("en-GB", { month: "long" })} ${weekStartDate.toLocaleString("en-GB", {
          day: "numeric",
        })}, ${weekStartDate.toLocaleString("en-GB", { year: "numeric" })}`,
        endDay: `${weekEndDate.toLocaleString("en-GB", { month: "long" })} ${weekEndDate.toLocaleString("en-GB", {
          day: "numeric",
        })}, ${weekEndDate.toLocaleString("en-GB", { year: "numeric" })}`,
        volume: new BigNumber(data.volume).toString(),
      };
    } else {
      weeklyData[weekYear].volume = new BigNumber(weeklyData[weekYear].volume)
        .plus(new BigNumber(data.volume))
        .toString();
    }
  });
  return Object.values(weeklyData);
}

function createMonthlyData(dailyData: any[]): VolumeGraphRow[] {
  const monthlyData: VolumeGraphData = {};
  dailyData.forEach((data: { ts: number; volume: string }) => {
    const date = new Date(data.ts * 1000);
    const monthStartDate = startOfMonth(date);
    const monthEndDate = lastDayOfMonth(date);
    const monthNumber = getMonth(date);
    const year = getYear(date);
    const monthYear = `${monthNumber}-${year}`;
    if (!monthlyData[monthYear]) {
      monthlyData[monthYear] = {
        startDay: `${monthStartDate.toLocaleString("en-GB", { month: "long" })} ${monthStartDate.toLocaleString("en-GB", {
          day: "numeric",
        })}, ${monthStartDate.toLocaleString("en-GB", { year: "numeric" })}`,
        endDay: `${monthEndDate.toLocaleString("en-GB", { month: "long" })} ${monthEndDate.toLocaleString("en-GB", {
          day: "numeric",
        })}, ${monthEndDate.toLocaleString("en-GB", { year: "numeric" })}`,
        volume: new BigNumber(data.volume).toString(),
      };
    } else {
      monthlyData[monthYear].volume = new BigNumber(monthlyData[monthYear].volume)
        .plus(new BigNumber(data.volume))
        .toString();
    }
  });
  return Object.values(monthlyData);
}


function build({ dbClient, data }: Dependecies): Router {
  const router = Router();
  router.get("/tvl-graph-data", async (_req: Request, res: Response) => {
    try {
      const now = Math.floor(new Date().getTime() / 1000);
      const oneYearBack = Math.floor(
        new Date(new Date(new Date().setFullYear(new Date().getFullYear() - 1)).setHours(0, 0, 0, 0)).getTime() / 1000
      );
      const tvlGraphData = await dbClient.get({
        select: "sum(tvl_usd) as tvl, ts",
        table: "amm_aggregate",
        where: `ts >= ${oneYearBack} AND ts <= ${now} GROUP BY ts ORDER BY ts ASC`,
      });
      if (tvlGraphData.rowCount > 0) {
        const responseData = tvlGraphData.rows.map((row) => {
          const dateFromDb = new Date(row.ts * 1000);
          const date = `${dateFromDb.toLocaleString("en-GB", { month: "long" })} ${dateFromDb.toLocaleString("en-GB", {
            day: "numeric",
          })}, ${dateFromDb.toLocaleString("en-GB", { year: "numeric" })}`;
          return {
            date,
            tvl: row.tvl,
          };
        });
        res.status(200).json({ data: responseData, message: "SUCCESS" });
      } else {
        res.status(200).json({ data: [], message: "SUCCESS" });
      }
    } catch(error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/daily-volume-graph-data", async (_req: Request, res: Response) => {
    try {
      const now = Math.floor(new Date().getTime() / 1000);
      const oneYearBack = Math.floor(
        new Date(new Date(new Date().setFullYear(new Date().getFullYear() - 1)).setHours(0, 0, 0, 0)).getTime() / 1000
      );
      const volumeGraphData = await dbClient.get({
        select: "sum(volume_usd) as volume, ts",
        table: "amm_aggregate",
        where: `ts >= ${oneYearBack} AND ts <= ${now} GROUP BY ts ORDER BY ts ASC`,
      });
      if (volumeGraphData.rowCount > 0) {
        const responseData = volumeGraphData.rows.map((row) => {
          const dateFromDb = new Date(row.ts * 1000);
          const date = `${dateFromDb.toLocaleString("en-GB", { month: "long" })} ${dateFromDb.toLocaleString("en-GB", {
            day: "numeric",
          })}, ${dateFromDb.toLocaleString("en-GB", { year: "numeric" })}`;
          return {
            date,
            volumeDaily: row.volume,
          };
        });
        res.status(200).json({ data: responseData, message: "SUCCESS" });
      } else {
        res.status(200).json({ data: [], message: "SUCCESS" });
      }
    } catch(error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/volume-change-24h", async (_req: Request, res: Response) => {
    try {
      const currentTime = new Date().getTime();
      const twentyFourHoursAgo = new Date(currentTime - 24 * 60 * 60 * 1000).getTime();
      const fourtyEightHoursAgo = new Date(currentTime - 48 * 60 * 60 * 1000).getTime();
      const twentyFourHoursData = await dbClient.get({
        select: "sum(value) as volume_24h",
        table: "swap",
        // where: `ts >= ${Math.floor(twentyFourHoursAgo / 1000)} AND ts <= ${Math.floor(currentTime / 1000)}`, // TODO: Uncomment
        where: `ts >= 1653015044 AND ts <= 1653127514`, // TODO: Remove this line
      });
      const fourtyEightHoursData = await dbClient.get({
        select: "sum(value) as volume_48h",
        table: "swap",
        // where: `ts >= ${Math.floor(fourtyEightHoursAgo / 1000)} AND ts <= ${Math.floor(currentTime / 1000)}`, // TODO: Uncomment
        where: `ts >= 1652928644 AND ts <= 1653127514`, // TODO: Remove this line
      });
      if (twentyFourHoursData.rowCount > 0 && fourtyEightHoursData.rowCount > 0) {
        const twentyFourHoursVolume = new BigNumber(twentyFourHoursData.rows[0].volume_24h);
        const fourtyEightHoursVolume = new BigNumber(fourtyEightHoursData.rows[0].volume_48h);
        const volumeBefore24Hours = fourtyEightHoursVolume.minus(twentyFourHoursVolume);
        console.log(volumeBefore24Hours.toString());
        const changePercentage = percentageChange(volumeBefore24Hours, twentyFourHoursVolume);
        res.status(200).json({
          data: {
            volume24Hours: twentyFourHoursVolume.toString(),
            percentageChange: changePercentage,
          },
          message: "SUCCESS",
        });
      } else {
        res
          .status(200)
          .json({ data: { volume24Hours: "0", percentageChange: "0" }, message: "NO_DATA_FOUND" });
      }
    } catch(error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/fee-change-24h", async (_req: Request, res: Response) => {
    try {
      const currentTime = new Date().getTime();
      const twentyFourHoursAgo = new Date(currentTime - 24 * 60 * 60 * 1000).getTime();
      const fourtyEightHoursAgo = new Date(currentTime - 48 * 60 * 60 * 1000).getTime();
      const twentyFourHoursData = await dbClient.get({
        select: "sum(fee) as fee_24h",
        table: "swap",
        // where: `ts >= ${Math.floor(twentyFourHoursAgo / 1000)} AND ts <= ${Math.floor(currentTime / 1000)}`, // TODO: Uncomment
        where: `ts >= 1653015044 AND ts <= 1653127514`, // TODO: Remove this line
      });
      const fourtyEightHoursData = await dbClient.get({
        select: "sum(fee) as fee_48h",
        table: "swap",
        // where: `ts >= ${Math.floor(fourtyEightHoursAgo / 1000)} AND ts <= ${Math.floor(currentTime / 1000)}`, // TODO: Uncomment
        where: `ts >= 1652928644 AND ts <= 1653127514`, // TODO: Remove this line
      });
      if (twentyFourHoursData.rowCount > 0 && fourtyEightHoursData.rowCount > 0) {
        const twentyFourHoursFee = new BigNumber(twentyFourHoursData.rows[0].fee_24h);
        const fourtyEightHoursFee = new BigNumber(fourtyEightHoursData.rows[0].fee_48h);
        const feeBefore24Hours = fourtyEightHoursFee.minus(twentyFourHoursFee);
        console.log(feeBefore24Hours.toString());
        const changePercentage = percentageChange(feeBefore24Hours, twentyFourHoursFee);
        res.status(200).json({
          data: {
            fee24Hours: twentyFourHoursFee.toString(),
            percentageChange: changePercentage,
          },
          message: "SUCCESS",
        });
      } else {
        res
          .status(200)
          .json({ data: { fee24Hours: "0", percentageChange: "0" }, message: "NO_DATA_FOUND" });
      }
    } catch(error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/tvl-change-24h", async (_req: Request, res: Response) => {
    try {
      const currentTime = new Date().getTime();
      const fourtyEightHoursAgo = new Date(currentTime - 48 * 60 * 60 * 1000).getTime();
      const tvlData = await dbClient.get({
        select: "sum(tvl_usd) tvl, ts",
        table: "amm_aggregate",
        // where: `${Math.floor(fourtyEightHoursAgo / 1000)} AND ts <= ${Math.floor(currentTime / 1000)} GROUP BY ts ORDER BY ts DESC`, // TODO: Uncomment
        where: `ts >= 1652928644 AND ts <= 1653127514 GROUP BY ts ORDER BY ts DESC`, // TODO: Remove this line
      });
      
      if (tvlData.rowCount > 0) {
        const twentyFourHoursTvl = new BigNumber(tvlData.rows[0].tvl);
        const fourtyEightHoursTvl = new BigNumber(tvlData.rows[1].tvl);
        const changePercentage = percentageChange(fourtyEightHoursTvl, twentyFourHoursTvl);
        res
          .status(200)
          .json({
            data: {
              tvl24Hours: twentyFourHoursTvl.toString(),
              percentageChange: changePercentage,
            },
            message: "SUCCESS",
          });
      } else {
        res
          .status(200)
          .json({ data: { tvl24Hours: "0", percentageChange: "0" }, message: "NO_DATA_FOUND" });
      }
    } catch(error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });

  router.get("/weekly-volume-graph-data", async (_req: Request, res: Response) => {
    try {
      const now = Math.floor(new Date().getTime() / 1000);
      const oneYearBack = Math.floor(
        new Date(new Date(new Date().setFullYear(new Date().getFullYear() - 1)).setHours(0, 0, 0, 0)).getTime() / 1000
      );
      const volumeGraphData = await dbClient.get({
        select: "sum(volume_usd) as volume, ts",
        table: "amm_aggregate",
        where: `ts >= ${oneYearBack} AND ts <= ${now} GROUP BY ts ORDER BY ts ASC`,
      });
      if (volumeGraphData.rowCount > 0) {
        const responseData = createWeeklyData(volumeGraphData.rows);
        res.status(200).json({ data: responseData, message: "SUCCESS" });
      } else {
        res.status(200).json({ data: [], message: "SUCCESS" });
      }
    } catch (error) {
      res.status(500).json({ data: [], message: "INTERNAL_SERVER_ERROR" });
      console.error(error.message);
    }
  });


  router.get("/monthly-volume-graph-data", async (_req: Request, res: Response) => {
    try {
      const now = Math.floor(new Date().getTime() / 1000);
      const oneYearBack = Math.floor(
        new Date(new Date(new Date().setFullYear(new Date().getFullYear() - 1)).setHours(0, 0, 0, 0)).getTime() / 1000
      );
      const volumeGraphData = await dbClient.get({
        select: "sum(volume_usd) as volume, ts",
        table: "amm_aggregate",
        where: `ts >= ${oneYearBack} AND ts <= ${now} GROUP BY ts ORDER BY ts ASC`,
      });
      if (volumeGraphData.rowCount > 0) {
        const responseData = createMonthlyData(volumeGraphData.rows);
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
