import * as express from "express";
import { Express } from "express";
import * as cors from "cors";
import AnalyticsRouter from "./routes/analytics/Router";
import VERouter from "./routes/ve/Router";
import { Dependencies } from "../types";

export function httpServer(dependencies: Dependencies): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors());
  app.use("/analytics", AnalyticsRouter(dependencies));
  app.use("/ve", VERouter(dependencies));
  return app;
}
