import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireEntitlement } from "../middleware/entitlementMiddleware.js";
import {
  chatController,
  deleteConversationsController,
  explainMetricController,
  getAiAccessController,
  getCheckinController,
  getConversationController,
  goalCoachController,
  journalInterviewerController,
  listConversationsController,
  periodReviewController,
  planComplianceController,
  putCheckinPreferencesController,
  startAiTrialController,
} from "../controllers/ai.controller.js";
import { transcribeAudioController } from "../controllers/transcription.controller.js";
import { ENTITLEMENTS } from "../services/entitlement.service.js";
import audioUpload from "../utils/audioUpload.js";
import { transcriptionLimiter } from "../utils/rateLimit.js";

const aiRoutes = Router();

const requireJuvoAi = requireEntitlement(ENTITLEMENTS.JUVO_AI);
const requireInterviewer = requireEntitlement(
  ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER,
);
const requirePlanCompliance = requireEntitlement(
  ENTITLEMENTS.PLAN_COMPLIANCE_CHECK,
);
const requirePeriodReview = requireEntitlement(ENTITLEMENTS.AI_PERIOD_REVIEW);
const requireExplainMetrics = requireEntitlement(ENTITLEMENTS.EXPLAIN_METRICS);
const requireGoalCoach = requireEntitlement(ENTITLEMENTS.GOAL_COACH);
const requireCheckins = requireEntitlement(ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS);

function handleAudioTranscriptionUpload(req, res, next) {
  audioUpload.single("audio")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Voice note must be 10 MB or smaller."
        : error.message || "Unable to read the voice note.";

    res.status(400).json({ success: false, message });
  });
}

aiRoutes.get("/access", requireAuth, getAiAccessController);
aiRoutes.post("/trial/start", requireAuth, startAiTrialController);
aiRoutes.post(
  "/transcribe",
  requireAuth,
  transcriptionLimiter,
  handleAudioTranscriptionUpload,
  transcribeAudioController,
);
aiRoutes.get(
  "/conversations",
  requireAuth,
  requireJuvoAi,
  listConversationsController,
);
aiRoutes.delete(
  "/conversations",
  requireAuth,
  requireJuvoAi,
  deleteConversationsController,
);
aiRoutes.get(
  "/conversations/:conversationId",
  requireAuth,
  requireJuvoAi,
  getConversationController,
);
aiRoutes.post("/chat", requireAuth, requireJuvoAi, chatController);

aiRoutes.post(
  "/journal-interviewer",
  requireAuth,
  requireInterviewer,
  journalInterviewerController,
);
aiRoutes.post(
  "/plan-compliance",
  requireAuth,
  requirePlanCompliance,
  planComplianceController,
);
aiRoutes.post(
  "/period-review",
  requireAuth,
  requirePeriodReview,
  periodReviewController,
);
aiRoutes.post(
  "/explain-metric",
  requireAuth,
  requireExplainMetrics,
  explainMetricController,
);
aiRoutes.post(
  "/goal-coach",
  requireAuth,
  requireGoalCoach,
  goalCoachController,
);
aiRoutes.get(
  "/checkins",
  requireAuth,
  requireCheckins,
  getCheckinController,
);
aiRoutes.put(
  "/checkins/preferences",
  requireAuth,
  requireCheckins,
  putCheckinPreferencesController,
);

export default aiRoutes;
