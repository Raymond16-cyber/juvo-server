import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  chatController,
  getConversationController,
  listConversationsController,
} from "../controllers/ai.controller.js";

const aiRoutes = Router();

aiRoutes.get("/conversations", requireAuth, listConversationsController);
aiRoutes.get(
  "/conversations/:conversationId",
  requireAuth,
  getConversationController,
);
aiRoutes.post("/chat", requireAuth, chatController);

export default aiRoutes;
