import { Router } from "express";
import TestRouter from "./TestRouter";
import AddLiquidityDataRouter from "./AddLiquidityDataRouter";
import RemoveLiquidityDataRouter from "./RemoveLiquidityDataRouter";
import SwapsDataRouter from "./SwapsDataRouter";
import PoolsDataRouter from "./PoolsDataRouter";
import TokensDataRouter from "./TokensDataRouter";
import HomePageDataRouter from "./HomePageDataRouter";

import { Dependecies } from "../../types";

function build(dependencies: Dependecies): Router {
  const router = Router();
  router.use("/test", TestRouter(dependencies));
  router.use("/add-liquidity-data", AddLiquidityDataRouter(dependencies));
  router.use("/remove-liquidity-data", RemoveLiquidityDataRouter(dependencies));
  router.use("/swaps", SwapsDataRouter(dependencies));
  router.use("/pools", PoolsDataRouter(dependencies));
  router.use("/tokens",TokensDataRouter(dependencies));
  router.use("/home", HomePageDataRouter(dependencies));
  return router;
}

export default build;
