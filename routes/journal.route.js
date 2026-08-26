import { Router } from "express";
import { createJournalController, getTodayJournalStatusController } from "../controllers/journal.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";


const journalRoutes = Router();

journalRoutes.post("/create-journal", requireAuth, createJournalController);
journalRoutes.get(
  "/get-today-journal-status",
  requireAuth,
  getTodayJournalStatusController,
);

export default journalRoutes;
