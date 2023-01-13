import { Request, Response, Router } from "express";
import { Dependencies, PlentyResponse } from "../../../types";
import { percentageChange } from "../../../utils";

function build({ cache, config, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/", async (_: Request, res: Response) => {
    try {
      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t48h = tch - 48 * 3600; // Current hourly - 48 hours
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t1Y = tch - 365 * 86400; // Current hourly - 1 year

      // Fetch aggregated system-wide record between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `plenty_aggregate_hour`,
          select: `SUM(volume_value) as volume, SUM(fees_value) as fees`,
          where: `ts>=${ts1} AND ts<${ts2}`,
        });
      }

      // Fetch locked value acrosss all pools for both tokens by the hour
      async function getLockedValueHour(ts: number, num: number) {
        return await dbClient.raw(`
          SELECT SUM(t.token_${num}_locked_value)
          FROM (
            SELECT MAX(ts) mts, pool 
            FROM pool_aggregate_hour WHERE ts<=${ts} GROUP BY pool
          ) r
          JOIN pool_aggregate_hour t ON
            t.pool=r.pool AND t.ts=r.mts;
        `);
      }

      // Fetch locked value acrosss all pools for both tokens by the day
      async function getLockedValueDay(ts: number, num: number) {
        return await dbClient.raw(`
          SELECT SUM(t.token_${num}_locked_value)
          FROM (
            SELECT MAX(ts) mts, pool 
            FROM pool_aggregate_day WHERE ts<=${ts} GROUP BY pool
          ) r
          JOIN pool_aggregate_day t ON
            t.pool=r.pool AND t.ts=r.mts;
        `);
      }

      const aggregate48H = (await getAggregate(t48h, t24h)).rows[0];
      const aggregate24H = (await getAggregate(t24h, tch)).rows[0];

      // Fetch a year's worth of system-wide aggregated data
      let aggregate1Y = [];
      const _entry = await dbClient.get({
        table: `plenty_aggregate_day`,
        select: `
            ts, 
            volume_value,
            fees_value
          `,
        where: `ts>=${t1Y} AND ts<=${tch} ORDER BY ts`,
      });
      aggregate1Y = _entry.rows;

      // Get locked value across all pools for both tokens at current hour and 24 hours ago
      const t1LockedValue24H = parseFloat((await getLockedValueHour(t24h, 1)).rows[0].sum ?? 0);
      const t2LockedValue24H = parseFloat((await getLockedValueHour(t24h, 2)).rows[0].sum ?? 0);

      const t1LockedValueCH = parseFloat((await getLockedValueHour(tch, 1)).rows[0].sum ?? 0);
      const t2LockedValueCH = parseFloat((await getLockedValueHour(tch, 2)).rows[0].sum ?? 0);

      // Retrieve data fields from DB entry
      const vol48H = parseFloat(aggregate48H.volume ?? 0);
      const vol24H = parseFloat(aggregate24H.volume ?? 0);

      const fees48H = parseFloat(aggregate48H.fees ?? 0);
      const fees24H = parseFloat(aggregate24H.fees ?? 0);

      const volumeHistory = aggregate1Y.map((item) => {
        return <{ [key: string]: string }>{
          [item.ts]: item.volume_value,
        };
      });
      const feesHistory = aggregate1Y.map((item) => {
        return <{ [key: string]: string }>{
          [item.ts]: item.fees_value,
        };
      });

      const tvlHistory = [];

      const t0 = Math.floor(tc / 86400) * 86400; // Current daily rounded timestamp
      const t365 = t0 - 365 * 86400; // Current daily - 1 year

      // Fetch a year's worth of daily TVL of a specific token
      for (let ts = t365; ts <= t0; ts += 86400) {
        const cached = cache.get(ts.toString(6));
        let lockedValueTS;
        if (!cached) {
          const t1LockedValueTS = (await getLockedValueDay(ts, 1)).rows[0];
          const t2LockedValueTS = (await getLockedValueDay(ts, 2)).rows[0];
          lockedValueTS = parseFloat(t1LockedValueTS.sum ?? 0) + parseFloat(t2LockedValueTS.sum ?? 0);
        } else {
          lockedValueTS = cached;
          cache.insert(ts.toString(6), lockedValueTS, config.ttl.history);
        }
        if (lockedValueTS > 0) {
          tvlHistory.push({ [ts]: lockedValueTS.toFixed(6) });
        }
      }

      const plenty: PlentyResponse = {
        volume: {
          value24H: vol24H.toFixed(6),
          // (aggregated volume 48 hrs -> 24 hrs ago, aggregated volume 24 hrs -> now)
          change24H: percentageChange(vol48H, vol24H),
          history: volumeHistory,
        },
        fees: {
          value24H: fees24H.toFixed(6),
          // (aggregated fees 48 hrs -> 24 hrs ago, aggregated fees 24 hrs -> now)
          change24H: percentageChange(fees48H, fees24H),
          history: feesHistory,
        },
        tvl: {
          value: (t1LockedValue24H + t2LockedValue24H).toFixed(6),
          // (tvl record 24 hrs ago, last tvl record)
          change24H: percentageChange(t1LockedValue24H + t2LockedValue24H, t1LockedValueCH + t2LockedValueCH),
          history: tvlHistory,
        },
      };

      res.json(plenty).status(200);
    } catch (err) {
      res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
      console.error(err.message);
    }
  });

  return router;
}

export default build;
