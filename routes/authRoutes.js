import { Router } from "express";
import {
  signup,
  signin,
  appleAuth,
  me,
  generateResetPasswordToken,
  verifyPasswordResetCode,
  resetPassword,
} from "../controllers/authController.js";
import { onBoardingUser } from "../controllers/onBoarding.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  forgotPasswordLimiter,
  verifyResetPasswordCodeLimiter,
} from "../utils/rateLimit.js";

const authRoutes = Router();

authRoutes.post("/sign-up", signup);
authRoutes.post("/sign-in", signin);
authRoutes.post("/apple", appleAuth);
authRoutes.get("/me", requireAuth, me);
authRoutes.post("/onboarding", requireAuth, onBoardingUser);
authRoutes.post(
  "/request-reset-password",
  forgotPasswordLimiter,
  generateResetPasswordToken,
);
authRoutes.post(
  "/verify-reset-password-code",
  verifyResetPasswordCodeLimiter,
  verifyPasswordResetCode,
);
authRoutes.post(
  "/reset-password",
  verifyResetPasswordCodeLimiter,
  resetPassword,
);

export default authRoutes;
