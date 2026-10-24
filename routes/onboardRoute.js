import { Router } from "express";
import { onBoardingUser } from "../controllers/onBoarding.js";

import { requireAuth } from "../middleware/authMiddleware.js";
import { getDashboardGuide, updateDashboardGuide } from "../controllers/dashboard.controller.js";

const onboardRoutes = Router();

onboardRoutes.post("/onboard-user", requireAuth, onBoardingUser);

onboardRoutes.get("/dashboard-guide", requireAuth, getDashboardGuide);

onboardRoutes.patch("/dashboard-guide", requireAuth, updateDashboardGuide);

export default onboardRoutes;
