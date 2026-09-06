import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  callbackCTrader,
  completeCTrader,
  connectCTrader,
  getBrokerConnections,
} from "../controllers/broker.controller.js";

const brokerRoutes = Router();

brokerRoutes.get("/ctrader/connect", requireAuth, connectCTrader);
brokerRoutes.get("/ctrader/callback", callbackCTrader);
brokerRoutes.post("/ctrader/callback", requireAuth, completeCTrader);
brokerRoutes.get("/connections", requireAuth, getBrokerConnections);

export default brokerRoutes;
