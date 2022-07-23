import { Router } from "express";
import TokensDataRouter from "./TokensDataRouter";
// import TokensDataRouter from "./TokensDataRouter";

import { Dependecies } from "../../types";

function build(dependencies: Dependecies): Router {
  const router = Router();
  router.use("/tokens", TokensDataRouter(dependencies));
  // router.use("/plenty", );
  return router;
}

export default build;
