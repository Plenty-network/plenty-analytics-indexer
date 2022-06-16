import { Router } from "express";
import TestRouter from "./TestRouter";

import { Dependecies } from "../../types";

function build(dependencies: Dependecies): Router {
  const router = Router();
  router.use("/test", TestRouter(dependencies));
  return router;
}

export default build;
