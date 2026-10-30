import { Router } from "express";
import {
  signup,
  signin,
  appleAuth,
  me,
  logout,
  updatePreferences,
  generateOtpVerificationToken,
  verifyOtpVerificationCode,
  resetPassword,
  verifyEmail,
  resendEmailVerification,
  getBetaStatus,
} from "../controllers/authController.js";
import { onBoardingUser } from "../controllers/onBoarding.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  forgotPasswordLimiter,
  verifyOtpVerificationCodeLimiter,
  betaCodeLimiter,
} from "../utils/rateLimit.js";

const authRoutes = Router();

authRoutes.get("/beta-status", getBetaStatus);
authRoutes.post("/sign-up", betaCodeLimiter, signup);
authRoutes.post("/sign-in", betaCodeLimiter, signin);
authRoutes.get("/verify-email/:token", verifyEmail);
authRoutes.post(
  "/resend-verification",
  verifyOtpVerificationCodeLimiter,
  resendEmailVerification,
);
authRoutes.post("/apple", betaCodeLimiter, appleAuth);
authRoutes.get("/me", requireAuth, me);
authRoutes.post("/logout", requireAuth, logout);
authRoutes.patch("/preferences", requireAuth, updatePreferences);
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
  "/reset-password/:resetPasswordToken",
  verifyOtpVerificationCodeLimiter,
  resetPassword,
);

export default authRoutes;
