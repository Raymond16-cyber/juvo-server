import { Router } from "express";
import {
  confirmBehaviourFlagController,
  dismissBehaviourFlagController,
  getBehaviourOverviewController,
} from "../controllers/behaviour.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const behaviourRoutes = Router();

behaviourRoutes.get("/", requireAuth, getBehaviourOverviewController);
behaviourRoutes.post(
  "/flags/confirm",
  requireAuth,
  confirmBehaviourFlagController,
);
behaviourRoutes.post(
  "/flags/dismiss",
  requireAuth,
  dismissBehaviourFlagController,
);

export default behaviourRoutes;
