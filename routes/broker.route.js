import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { connectCTrader } from "../controllers/broker.controller.js";

const brokerRoutes = Router();

brokerRoutes.get("/ctrader/connect", requireAuth, connectCTrader);

export default brokerRoutes;
