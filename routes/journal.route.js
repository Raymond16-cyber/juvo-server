import { Router } from "express";
import {
  exportJournalsController,
  closeJournalTradeController,
  completeJournalController,
  createJournalController,
  createJournalTradeController,
  getJournalByIdController,
  getJournalStreakController,
  getTodayJournalStatusController,
  getUserJournalsController,
} from "../controllers/journal.controller.js";
import {
  uploadBeforeTradingAudioController,
  getBeforeTradingAudioController,
} from "../controllers/journalAudio.controller.js";
import {
  analyzeTradeScreenshotController,
  getTradeScreenshotReviewController,
} from "../controllers/screenshotReview.controller.js";
import {
  getTodayNoTradeDayController,
  liftNoTradeDayController,
  upsertNoTradeDayController,
} from "../controllers/noTradeDay.controller.js";

import { requireAuth } from "../middleware/authMiddleware.js";
import { requireEntitlement } from "../middleware/entitlementMiddleware.js";
import { ENTITLEMENTS } from "../services/entitlement.service.js";
import audioUpload from "../utils/audioUpload.js";
import { handleScreenshotUpload } from "../utils/imageUpload.js";
import { screenshotReviewLimiter } from "../utils/rateLimit.js";

const journalRoutes = Router();
const requireJuvoAi = requireEntitlement(ENTITLEMENTS.JUVO_AI);

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
journalRoutes.post(
  "/:journalId/trades/:tradeId/screenshot-review",
  requireAuth,
  requireJuvoAi,
  screenshotReviewLimiter,
  handleScreenshotUpload,
  analyzeTradeScreenshotController,
);
journalRoutes.get(
  "/:journalId/trades/:tradeId/screenshot-review",
  requireAuth,
  getTradeScreenshotReviewController,
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
journalRoutes.get("/streak", requireAuth, getJournalStreakController);
journalRoutes.get("/no-trade-day/today", requireAuth, getTodayNoTradeDayController);
journalRoutes.post("/no-trade-day", requireAuth, upsertNoTradeDayController);
journalRoutes.patch("/no-trade-day", requireAuth, upsertNoTradeDayController);
journalRoutes.post("/no-trade-day/lift", requireAuth, liftNoTradeDayController);
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
