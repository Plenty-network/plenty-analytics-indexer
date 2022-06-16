import { Request, Response, Router } from "express";
import { Dependecies } from "../../types";

function build(dependencies: Dependecies): Router {
  const router = Router();
  router.get("/", async (req: Request, res: Response) => {
    return res.json({ result: `Your request - ${req.query.content}` });
  });
  return router;
}

export default build;
