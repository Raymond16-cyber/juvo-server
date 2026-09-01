import { Router } from "express";
import {
  closeJournalTradeController,
  completeJournalController,
  createJournalController,
  createJournalTradeController,
  getJournalByIdController,
  getTodayJournalStatusController,
  getUserJournalsController,
} from "../controllers/journal.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const journalRoutes = Router();

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
journalRoutes.get("/:journalId", requireAuth, getJournalByIdController);

export default journalRoutes;
