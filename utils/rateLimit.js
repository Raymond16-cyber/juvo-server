import rateLimit from "express-rate-limit";

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes

  max: 5,

  message: {
    success: false,
    message:
      "Too many password reset requests. Please try again in 15 minutes.",
  },

  standardHeaders: true,

  legacyHeaders: false,
});

export const verifyOtpVerificationCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 15 minutes

  max: 5,
  message: {
    success: false,
    message:
      "Too many attempts to verify the reset password code. Please try again in 10 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
