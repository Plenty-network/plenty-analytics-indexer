import * as express from "express";
import { Express } from "express";
import AnalyticsRouter from "./routes/analytics/Router";
import VERouter from "./routes/ve/Router";
import IntegrationsRouter from "./routes/integrations/Router";
import { Dependencies } from "../types";

export function httpServer(dependencies: Dependencies): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/analytics", AnalyticsRouter(dependencies));
  app.use("/ve", VERouter(dependencies));
  app.use("/integrations", IntegrationsRouter(dependencies));
  return app;
}
