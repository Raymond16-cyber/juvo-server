import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  addPlanRuleController,
  createTradingPlanController,
  getTradingPlanController,
  listPlanSuggestionsController,
  listPlanVersionsController,
  listTradingPlansController,
  removePlanRuleController,
  resolvePlanSuggestionController,
  updatePlanRuleController,
  updateTradingPlanController,
} from "../controllers/tradingPlan.controller.js";

const tradingPlanRoutes = Router();

tradingPlanRoutes.get("/", requireAuth, listTradingPlansController);
tradingPlanRoutes.post("/", requireAuth, createTradingPlanController);
tradingPlanRoutes.get(
  "/suggestions",
  requireAuth,
  listPlanSuggestionsController,
);
tradingPlanRoutes.post(
  "/suggestions/:suggestionId/resolve",
  requireAuth,
  resolvePlanSuggestionController,
);
tradingPlanRoutes.get("/:planId", requireAuth, getTradingPlanController);
tradingPlanRoutes.get(
  "/:planId/versions",
  requireAuth,
  listPlanVersionsController,
);
tradingPlanRoutes.patch("/:planId", requireAuth, updateTradingPlanController);
tradingPlanRoutes.post(
  "/:planId/rules",
  requireAuth,
  addPlanRuleController,
);
tradingPlanRoutes.patch(
  "/:planId/rules/:ruleId",
  requireAuth,
  updatePlanRuleController,
);
tradingPlanRoutes.delete(
  "/:planId/rules/:ruleId",
  requireAuth,
  removePlanRuleController,
);

export default tradingPlanRoutes;
