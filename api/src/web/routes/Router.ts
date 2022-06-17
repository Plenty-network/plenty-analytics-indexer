import { Router } from "express";
import TestRouter from "./TestRouter";
import AddLiquidityDataRouter from "./AddLiquidityDataRouter";

import { Dependecies } from "../../types";

function build(dependencies: Dependecies): Router {
  const router = Router();
  router.use("/test", TestRouter(dependencies));
  router.use("/add-liquidity-data", AddLiquidityDataRouter(dependencies));
  return router;
}

export default build;
