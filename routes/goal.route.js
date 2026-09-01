import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  createGoalController,
  deleteGoalController,
  listGoalsController,
  updateGoalController,
} from "../controllers/goal.controller.js";

const goalRoutes = Router();

goalRoutes.get("/", requireAuth, listGoalsController);
goalRoutes.post("/", requireAuth, createGoalController);
goalRoutes.patch("/:goalId", requireAuth, updateGoalController);
goalRoutes.delete("/:goalId", requireAuth, deleteGoalController);

export default goalRoutes;
