import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { getAnalyticsController } from "../controllers/analytics.controller.js";

const analyticsRoutes = Router();

analyticsRoutes.get("/", requireAuth, getAnalyticsController);

export default analyticsRoutes;
