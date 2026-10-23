import { Router } from "express";
import {
  exportJournalsController,
  closeJournalTradeController,
  completeJournalController,
  createJournalController,
  createJournalTradeController,
  getJournalByIdController,
  getTodayJournalStatusController,
  getUserJournalsController,
} from "../controllers/journal.controller.js";
import {
  uploadBeforeTradingAudioController,
  getBeforeTradingAudioController,
} from "../controllers/journalAudio.controller.js";

import { requireAuth } from "../middleware/authMiddleware.js";
import { requireEntitlement } from "../middleware/entitlementMiddleware.js";
import { ENTITLEMENTS } from "../services/entitlement.service.js";
import audioUpload from "../utils/audioUpload.js";

const journalRoutes = Router();

journalRoutes.get(
  "/export",
  requireAuth,
  requireEntitlement(ENTITLEMENTS.DATA_EXPORT),
  exportJournalsController,
);



journalRoutes.post("/create-journal", requireAuth, createJournalController);
journalRoutes.post(
  "/:journalId/trades",
  requireAuth,
  createJournalTradeController,
);
journalRoutes.patch(
  "/:journalId/trades/:tradeId/close",
  requireAuth,
  closeJournalTradeController,
);
journalRoutes.patch(
  "/:journalId/complete",
  requireAuth,
  completeJournalController,
);
journalRoutes.get("/get-user-journals", requireAuth, getUserJournalsController);
journalRoutes.get(
  "/get-today-journal-status",
  requireAuth,
  getTodayJournalStatusController,
);
journalRoutes.post(
  "/:journalId/before-trading-audio",
  requireAuth,
  audioUpload.single("audio"),
  uploadBeforeTradingAudioController,
);

journalRoutes.get(
  "/:journalId/before-trading-audio",
  requireAuth,
  getBeforeTradingAudioController,
);
journalRoutes.get("/:journalId", requireAuth, getJournalByIdController);

export default journalRoutes;
