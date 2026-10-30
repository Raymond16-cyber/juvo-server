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

export const screenshotReviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return String(req.user?.id || req.user?._id || req.ip || "anonymous");
  },
  validate: {
    keyGeneratorIpFallback: false,
  },
  message: {
    success: false,
    message:
      "Too many screenshot reviews. Please wait a few minutes before trying again.",
  },
});

export const transcriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return String(req.user?.id || req.user?._id || req.ip || "anonymous");
  },
  validate: {
    keyGeneratorIpFallback: false,
  },
  message: {
    success: false,
    message:
      "Too many voice transcriptions. Please wait a few minutes before trying again.",
  },
});

export const betaCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many tester code attempts. Please try again later.",
  },
});
