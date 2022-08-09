import { Router } from "express";
import PricesRouter from "./PricesRouter";
import PoolsRouter from "./PoolsRouter";

import { Dependencies } from "../../../types";

function build(dependencies: Dependencies): Router {
  const router = Router();
  router.use("/pools", PoolsRouter(dependencies));
  router.use("/prices", PricesRouter(dependencies));
  return router;
}

export default build;
