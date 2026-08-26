import { Router } from "express";
import { onBoardingUser } from "../controllers/onBoarding.js";
import { requireAuth } from "../middleware/authMiddleware.js";


const onboardRoutes = Router();
onboardRoutes.post("/onboard-user", 
    requireAuth, 
    onBoardingUser);


export default onboardRoutes;
