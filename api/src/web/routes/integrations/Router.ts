import { Router } from "express";
import IntegrationsRouter from "./IntegrationsRouter";

import { Dependencies } from "../../../types";

function build(dependencies: Dependencies): Router {
  const router = Router();
  router.use("/v1", IntegrationsRouter(dependencies));
  return router;
}

export default build;
