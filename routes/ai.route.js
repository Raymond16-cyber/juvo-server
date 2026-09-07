import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireEntitlement } from "../middleware/entitlementMiddleware.js";
import {
  chatController,
  getAiAccessController,
  getConversationController,
  listConversationsController,
  startAiTrialController,
} from "../controllers/ai.controller.js";
import { ENTITLEMENTS } from "../services/entitlement.service.js";

const aiRoutes = Router();

const requireJuvoAi = requireEntitlement(ENTITLEMENTS.JUVO_AI);

aiRoutes.get("/access", requireAuth, getAiAccessController);
aiRoutes.post("/trial/start", requireAuth, startAiTrialController);
aiRoutes.get("/conversations", requireAuth, requireJuvoAi, listConversationsController);
aiRoutes.get(
  "/conversations/:conversationId",
  requireAuth,
  requireJuvoAi,
  getConversationController,
);
aiRoutes.post("/chat", requireAuth, requireJuvoAi, chatController);

export default aiRoutes;
