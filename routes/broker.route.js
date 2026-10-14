import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import metatraderRoutes from "../brokers/metatrader/metatrader.routes.js";
import {
  callbackCTrader,
  completeCTrader,
  connectCTrader,
  disconnectCTrader,
  getBrokerConnections,
  getBrokerPositions,
  syncCTrader,
} from "../controllers/broker.controller.js";

const brokerRoutes = Router();
brokerRoutes.use("/metatrader", metatraderRoutes);

brokerRoutes.get("/ctrader/connect", requireAuth, connectCTrader);
brokerRoutes.get("/ctrader/callback", callbackCTrader);
brokerRoutes.post("/ctrader/callback", requireAuth, completeCTrader);
brokerRoutes.post("/ctrader/sync", requireAuth, syncCTrader);
brokerRoutes.post("/ctrader/disconnect", requireAuth, disconnectCTrader);
brokerRoutes.get("/connections", requireAuth, getBrokerConnections);
brokerRoutes.get("/positions", requireAuth, getBrokerPositions);

export default brokerRoutes;
