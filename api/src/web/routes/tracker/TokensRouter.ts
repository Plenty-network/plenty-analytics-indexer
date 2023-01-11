import BigNumber from "bignumber.js";
import { Request, Response, Router } from "express";
import { convertToMap, percentageChange, aggregateBykey } from "../../../utils";
import { Dependencies, PriceOHLC, TokenTrackerResponse } from "../../../types";

function build({ cache, config, getData, dbClient }: Dependencies): Router {
  const router = Router();

  router.get("/:token?", async (req: Request<{ token: string | undefined }>, res: Response) => {
    try {
      // Fetch system wide pool and token data
      const data = await getData();

      // Check request params validity
      if (req.params.token && !data.tokens[req.params.token]) {
        res.json({ error: "Token does not exist." });
        return;
      }

      const tc = Math.floor(new Date().getTime() / 1000); // Current timestamp
      const tch = Math.floor(tc / 3600) * 3600; // Current hourly rounded timestamp
      const t48h = tch - 48 * 3600; // Current hourly - 48 hours
      const t24h = tch - 24 * 3600; // Current hourly - 24 hours
      const t7d = tch - 7 * 86400; // Current hourly - 7 days
      const t1y = tch - 365 * 86400; // Current hourly - 1 year

      // Fetch aggregated token records between two timestamps
      async function getAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `token_aggregate_hour`,
          select: `token, SUM(volume_value) as volume, SUM(fees_value) as fees`,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY token`,
        });
      }

      // Fetch aggregated pool records between two timestamps
      async function getPoolAggregate(ts1: number, ts2: number) {
        return await dbClient.get({
          table: `pool_aggregate_hour`,
          select: `
            pool, 
            SUM(token_1_volume_value) as t1volume,
            SUM(token_2_volume_value) as t2volume
          `,
          where: `ts>=${ts1} AND ts<${ts2} GROUP BY pool`,
        });
      }

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

      // Returns the locked value across individual tokens of all pools.
      async function getLockedValueAll(ts: number, num: number) {
        return await dbClient.raw(`
          SELECT d.token_${num}, SUM(t.token_${num}_locked_value)
          FROM (
            SELECT MAX(ts) mts, pool 
            FROM pool_aggregate_hour WHERE ts<=${ts} GROUP BY pool
          ) r
          JOIN data d ON
            r.pool=d.pool
          JOIN pool_aggregate_hour t ON
            r.mts=t.ts AND r.pool=t.pool
          GROUP BY d.token_${num}
        `);
      }

      // Returns the locked value for a specific token across pools
      // taking one token at a time from the pair
      async function getLockedValue(ts: number, num: number) {
        return await dbClient.raw(`
          SELECT SUM(t.token_${num}_locked_value)
          FROM (
            SELECT MAX(ts) mts, pool 
            FROM pool_aggregate_hour WHERE ts<=${ts} GROUP BY pool
          ) r
          JOIN data d ON
            r.pool=d.pool
          JOIN pool_aggregate_hour t ON
            r.mts=t.ts AND r.pool=t.pool
          WHERE d.token_${num}='${req.params.token}'
        `);
      }

      // Fetch pool locked value (<=) to supplied timestamp
      async function getPoolLockedValueAll(ts: number) {
        return await dbClient.raw(`
          SELECT t.pool, t.token_1_locked_value l1, t.token_2_locked_value l2
          FROM (
            SELECT MAX(ts) mts, pool 
            FROM pool_aggregate_hour WHERE ts<=${ts} GROUP BY pool
          ) r
          JOIN pool_aggregate_hour t ON
            t.pool=r.pool AND t.ts=r.mts;
        `);
      }

      async function getPairWisePrice(ts: number) {
        return await dbClient.raw(`
          SELECT 
            t.pool, 
            d.token_1, 
            d.token_2, 
            t.token_1_amount t1amount, 
            t.token_2_amount t2amount,
            t.value
          FROM (
            SELECT MAX(ts) mts, pool
            FROM transaction WHERE ts<=${ts} GROUP BY pool
          ) r
          JOIN transaction t ON 
            r.pool=t.pool AND r.mts=t.ts
          JOIN data d ON
            d.pool=t.pool
        `);
      }

      // Aggregated data in the form of { token-symbol: { volume } }
      const aggregate48H = convertToMap((await getAggregate(t48h, t24h)).rows, "token");
      const aggregate24H = convertToMap((await getAggregate(t24h, tch)).rows, "token");

      // Last aggregated data in the form of { token-symbol: { close-price } }
      const lastAggregate24H = convertToMap((await getClosePriceAggregate(t24h)).rows, "token");
      const lastAggregateCH = convertToMap((await getClosePriceAggregate(tch)).rows, "token");

      // Last locked values across token 1 of all pools in the form { token-symbol: { sum } }
      const t1LockedValue24H = convertToMap((await getLockedValueAll(t24h, 1)).rows, "token_1");
      const t1LockedValueCH = convertToMap((await getLockedValueAll(tch, 1)).rows, "token_1");

      // Last locked values across token 2 of all pools in the form { token-symbol: { sum } }
      const t2LockedValue24H = convertToMap((await getLockedValueAll(t24h, 2)).rows, "token_2");
      const t2LockedValueCH = convertToMap((await getLockedValueAll(tch, 2)).rows, "token_2");

      const pairWise24H = (await getPairWisePrice(t24h)).rows;
      const pairWiseCH = (await getPairWisePrice(tch)).rows;

      // Pair wise pricing data across token 1 of all pools
      const t1PairWise24H = aggregateBykey(pairWise24H, "token_1");
      const t1PairWiseCH = aggregateBykey(pairWiseCH, "token_1");

      // Pair wise pricing data across token 2 of all pools
      const t2PairWise24H = aggregateBykey(pairWise24H, "token_2");
      const t2PairWiseCH = aggregateBykey(pairWiseCH, "token_2");

      // Aggregated data in the form of { pool-address: { t1volume, t2volume } }
      const poolAggregate48H = convertToMap((await getPoolAggregate(t48h, t24h)).rows, "pool");
      const poolAggregate24H = convertToMap((await getPoolAggregate(t24h, tch)).rows, "pool");

      // Last last locked value across all pools
      const poolLastLockedValue24H = convertToMap((await getPoolLockedValueAll(t24h)).rows, "pool");
      const poolLastLockedValueCH = convertToMap((await getPoolLockedValueAll(tch)).rows, "pool");

      let aggregate1Y = [];
      const tvlHistory = [];

      if (req.params.token) {
        // Fetch a year's worth of aggregated data if a specific token is supplied in the params
        const _entry = await dbClient.get({
          table: `token_aggregate_day`,
          select: `
            ts, 
            open_price o, 
            high_price h, 
            low_price l, 
            close_price c, 
            volume_value
          `,
          where: `token='${req.params.token}' AND ts>=${t1y} AND ts<=${tch} ORDER BY ts`,
        });
        aggregate1Y = _entry.rows;

        const t0 = Math.floor(tc / 86400) * 86400; // Current daily rounded timestamp
        const t365 = t0 - 365 * 86400; // Current daily - 1 year

        // Fetch a year's worth of daily TVL of a specific token
        for (let ts = t365; ts <= t0; ts += 86400) {
          const cached = cache.get(JSON.stringify({ ts, token: req.params.token }));
          let lockedValueTS;
          if (!cached) {
            const t1LockedValueTS = (await getLockedValue(ts, 1)).rows[0];
            const t2LockedValueTS = (await getLockedValue(ts, 2)).rows[0];
            lockedValueTS = parseFloat(t1LockedValueTS.sum ?? 0) + parseFloat(t2LockedValueTS.sum ?? 0);
          } else {
            lockedValueTS = cached;
            cache.insert(JSON.stringify({ ts, token: req.params.token }), lockedValueTS, config.ttl.history);
          }
          if (lockedValueTS > 0) {
            tvlHistory.push({ [ts]: lockedValueTS.toFixed(6) });
          }
        }
      }

      const tokens: TokenTrackerResponse[] = [];

      // Loop through every token in the system
      for (const token of req.params.token ? [req.params.token] : Object.keys(data.tokens)) {
        // Retrieve data fields from DB entry
        const priceCH = parseFloat(lastAggregateCH[token]?.close_price ?? 0);
        const price24H = parseFloat(lastAggregate24H[token]?.close_price ?? 0);

        const lockedValueCH =
          parseFloat(t1LockedValueCH[token]?.sum ?? 0) + parseFloat(t2LockedValueCH[token]?.sum ?? 0);
        const lockedValue24H =
          parseFloat(t1LockedValue24H[token]?.sum ?? 0) + parseFloat(t2LockedValue24H[token]?.sum ?? 0);

        const vol48H = parseFloat(aggregate48H[token]?.volume ?? 0);
        const vol24H = parseFloat(aggregate24H[token]?.volume ?? 0);

        const priceHistory = aggregate1Y.map((item) => {
          return <{ [key: string]: PriceOHLC }>{
            [item.ts]: {
              o: item.o,
              h: item.h,
              l: item.l,
              c: item.c,
            },
          };
        });

        let pairs: any = [];

        const totalPairWise24H = convertToMap((t1PairWise24H[token] ?? []).concat(t2PairWise24H[token] ?? []), "pool");
        const totalPairWiseCH = convertToMap((t1PairWiseCH[token] ?? []).concat(t2PairWiseCH[token] ?? []), "pool");

        for (const pool of Object.keys(totalPairWise24H)) {
          const tpCH = totalPairWiseCH[pool];
          const tp24H = totalPairWise24H[pool];

          const poolVol48H =
            parseFloat(poolAggregate48H[pool]?.t1volume ?? 0) + parseFloat(poolAggregate48H[pool]?.t2volume ?? 0);
          const poolVol24H =
            parseFloat(poolAggregate24H[pool]?.t1volume ?? 0) + parseFloat(poolAggregate24H[pool]?.t2volume ?? 0);

          const poolLockedValueCH =
            parseFloat(poolLastLockedValueCH[pool]?.l1 ?? 0) + parseFloat(poolLastLockedValueCH[pool]?.l2 ?? 0);
          const poolLockedValue24H =
            parseFloat(poolLastLockedValue24H[pool]?.l1 ?? 0) + parseFloat(poolLastLockedValue24H[pool]?.l2 ?? 0);

          const priceInPairCH =
            parseFloat(tpCH.value) / parseFloat(tpCH[token === tpCH.token_1 ? "t1amount" : "t2amount"]);
          const priceInPair24H =
            parseFloat(tp24H.value) / parseFloat(tp24H[token === tp24H.token_1 ? "t1amount" : "t2amount"]);

          pairs.push({
            symbol: `${totalPairWise24H[pool].token_1}/${totalPairWise24H[pool].token_2}`,
            contract: pool,
            exchangeLink: `https://app.plenty.network/swap?from=${totalPairWise24H[pool].token_1}&to=${totalPairWise24H[pool].token_2}`,
            price: {
              value: priceInPairCH.toFixed(6),
              change24H: percentageChange(priceInPair24H, priceInPairCH),
            },
            volume: {
              value24H: poolVol24H.toFixed(6),
              change24H: percentageChange(poolVol48H, poolVol24H),
            },
            tvl: {
              value: poolLockedValueCH.toFixed(6),
              change24H: percentageChange(poolLockedValue24H, poolLockedValueCH),
            },
          });
        }

        tokens.push({
          name: data.tokens[token].name,
          symbol: token,
          contract: data.tokens[token].address,
          price: {
            value: new BigNumber(lastAggregateCH[token]?.close_price ?? 0).toString(),
            change24H: percentageChange(price24H, priceCH), // (closing price 24 hrs ago, last closing price)
            history: req.params.token ? priceHistory : undefined,
          },
          volume: {
            value24H: vol24H.toString(),
            // (aggregated volume 48 hrs -> 24 hrs ago, aggregated volume 24 hrs -> now)
            change24H: percentageChange(vol48H, vol24H),
          },
          tvl: {
            value: lockedValueCH.toFixed(6),
            // (tvl record 24 hrs ago, last tvl record)
            change24H: percentageChange(lockedValue24H, lockedValueCH),
          },
          pairs,
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
