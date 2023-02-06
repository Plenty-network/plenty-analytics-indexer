import { Router } from "express";
import IntegrationsRouterV1 from "./IntegrationsRouterV1";
import IntegrationsRouterV2 from "./IntegrationsRouterV2";

import { Dependencies } from "../../../types";

function build(dependencies: Dependencies): Router {
  const router = Router();
  router.use("/v1", IntegrationsRouterV1(dependencies));
  router.use("/v2", IntegrationsRouterV2(dependencies));
  return router;
}

export default build;
