import { Router } from "express";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "node:url";
import BrokerConnection from "../../models/Broker.model.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { authenticateMetaTraderConnector, requireConnectorHttps, connectorConfig, connectorLog } from "./metatrader.security.js";
import { createPairingCode, pairConnector, ownedConnector, revokeConnector } from "./metatrader.pairing.js";
import { metatraderRuntime } from "./metatrader.runtime.js";

const routes = Router();
const limit = (max, windowMs, connector = false) => rateLimit({ max, windowMs, standardHeaders: true, legacyHeaders: false,
  ...(connector ? { keyGenerator: (req) => String(req.connector._id) } : {}), message: { message: "Too many connector requests. Retry shortly." } });
const endpoint = (handler) => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const data = await handler(req, res);
    if (res.headersSent) return;
    if (req.headers.accept === "text/plain") res.type("text/plain").send(["JUVO1", data?.token || "", data?.connectionId || "", data?.accountKey || "", data?.historyCursor || 0, data?.syncRequestedAt || 0, data?.needsReconciliation ? 1 : 0].join("\n"));
    else res.json({ data });
  } catch (error) {
    connectorLog("request rejected");
    res.status(error.safeConnector ? error.status : 503).json({ code: error.safeConnector ? error.code : "UNAVAILABLE", message: error.safeConnector ? error.message : "Connector synchronization is temporarily unavailable. Retry shortly." });
  }
};
routes.use(requireConnectorHttps);
routes.get("/download", (_req, res) => res.download(fileURLToPath(new URL("../../connectors/mt5/JUVOConnector.mq5", import.meta.url)), "JUVOConnector.mq5"));
routes.get("/status", requireAuth, endpoint(async (req) => ({ ...connectorConfig(), connections: await BrokerConnection.find({ userId: req.user._id, provider: "metatrader" }) })));
routes.post("/pairing-code", requireAuth, limit(5, 15 * 60000), endpoint((req) => createPairingCode(req.user._id)));
routes.post("/pair", limit(10, 60000), endpoint(async (req) => {
  const result = await pairConnector(req.body);
  metatraderRuntime.forget(result.connectionId);
  return result;
}));
routes.post("/connections/:id/disconnect", requireAuth, endpoint(async (req) => {
  const connection = await ownedConnector(req.user._id, req.params.id);
  await metatraderRuntime.work(connection, () => revokeConnector(connection));
  metatraderRuntime.forget(connection._id); return { status: "disconnected" };
}));
routes.post("/connections/:id/sync", requireAuth, limit(15, 60000), endpoint(async (req) => {
  const connection = await ownedConnector(req.user._id, req.params.id);
  await BrokerConnection.updateOne({ _id: connection._id }, { $set: { syncRequestedAt: new Date() } });
  return { requested: true };
}));
routes.use(limit(600, 60000), authenticateMetaTraderConnector);
routes.post("/heartbeat", limit(30, 60000, true), endpoint((req) => metatraderRuntime.heartbeat(req.connector, req.body)));
routes.post("/account", limit(15, 60000, true), endpoint((req) => metatraderRuntime.work(req.connector, () => metatraderRuntime.account(req.connector, req.body))));
routes.post("/positions", limit(90, 60000, true), endpoint((req) => metatraderRuntime.positions(req.connector, req.body)));
routes.post("/history", limit(90, 60000, true), endpoint((req) => metatraderRuntime.history(req.connector, req.body)));
routes.post("/revoke", limit(5, 60000, true), endpoint(async (req) => {
  metatraderRuntime.envelope(req.connector, req.body, []);
  await metatraderRuntime.work(req.connector, () => revokeConnector(req.connector));
  metatraderRuntime.forget(req.connector._id); return {};
}));
export default routes;
