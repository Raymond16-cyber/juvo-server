import { Router } from "express";
import {
  celebrateAchievementsController,
  getAchievementsController,
  setFeaturedAchievementsController,
} from "../controllers/achievement.controller.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const achievementRoutes = Router();

achievementRoutes.get("/", requireAuth, getAchievementsController);
achievementRoutes.post(
  "/celebrate",
  requireAuth,
  celebrateAchievementsController,
);
achievementRoutes.put(
  "/featured",
  requireAuth,
  setFeaturedAchievementsController,
);

export default achievementRoutes;
