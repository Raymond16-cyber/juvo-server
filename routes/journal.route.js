import { Router } from "express";
import {
  createJournalController,
  createJournalTradeController,
  getTodayJournalStatusController,
  getUserJournalsController,
} from "../controllers/journal.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";


const journalRoutes = Router();

journalRoutes.post("/create-journal", requireAuth, createJournalController);
journalRoutes.post("/:journalId/trades", requireAuth, createJournalTradeController);
journalRoutes.get("/get-user-journals", requireAuth, getUserJournalsController);
journalRoutes.get(
  "/get-today-journal-status",
  requireAuth,
  getTodayJournalStatusController,
);

export default journalRoutes;
