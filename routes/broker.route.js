import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  callbackCTrader,
  completeCTrader,
  connectCTrader,
  getBrokerConnections,
  getBrokerPositions,
  syncCTrader,
} from "../controllers/broker.controller.js";

const brokerRoutes = Router();

brokerRoutes.get("/ctrader/connect", requireAuth, connectCTrader);
brokerRoutes.get("/ctrader/callback", callbackCTrader);
brokerRoutes.post("/ctrader/callback", requireAuth, completeCTrader);
brokerRoutes.post("/ctrader/sync", requireAuth, syncCTrader);
brokerRoutes.get("/connections", requireAuth, getBrokerConnections);
brokerRoutes.get("/positions", requireAuth, getBrokerPositions);

export default brokerRoutes;
