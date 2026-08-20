import { Router } from "express";
import {
  signup,
  signin,
  appleAuth,
  me,
  generateOtpVerificationToken,
  verifyOtpVerificationCode,
  resetPassword,
} from "../controllers/authController.js";
import { onBoardingUser } from "../controllers/onBoarding.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  forgotPasswordLimiter,
  verifyOtpVerificationCodeLimiter,
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
  generateOtpVerificationToken,
);
authRoutes.post(
  "/verify-reset-password-code/:otpVerificationToken",
  verifyOtpVerificationCodeLimiter,
  verifyOtpVerificationCode,
);
authRoutes.post(
  "/reset-password",
  verifyOtpVerificationCodeLimiter,
  resetPassword,
);

export default authRoutes;
