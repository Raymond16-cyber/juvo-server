import crypto from "crypto";
import {
  registerService,
  loginService,
  appleAuthService,
  generateOtpVerificationTokenService,
  verifyOtpVerificationCodeService,
  resetPasswordService,
  updatePreferencesService,
  sanitizeUser,
  issueEmailVerificationService,
} from "../services/authService.js";
import {
  hashStarEmail,
  sendEmailVerificationEmail,
  sendOtpToEmail,
} from "../utils/email.js";
import { updateUser } from "../repositories/userRepository.js";
import User from "../models/User.js";

async function signup(req, res, next) {
  try {
    const result = await registerService(req.body);
    let verificationSent = true;

    try {
      await sendEmailVerificationEmail(
        result.user.email,
        result.emailVerificationToken,
      );
    } catch (error) {
      console.error("Failed to send signup verification email:", error);
      verificationSent = false;
    }

    return res.status(201).json({
      message: verificationSent
        ? "Account created. Check your email for a verification link."
        : "Account created. We could not send the verification email yet; request a new one from the verification screen.",
      user: result.user,
      token: result.token,
      verificationSent,
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        message: "No verification token provided.",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const alreadyVerified = await User.findOne({
      "security.emailVerificationTokenUsedHash": tokenHash,
      "security.emailVerified": true,
    });

    if (alreadyVerified) {
      return res.status(200).json({
        message: "Email verified successfully.",
      });
    }

    const user = await User.findOne({
      "security.emailVerificationToken": token,
      "security.emailVerificationExpires": { $gt: new Date() },
    }).select("+security.emailVerificationToken +security.emailVerificationExpires");

    if (!user) {
      return res.status(400).json({
        message: "This verification link is invalid or expired.",
      });
    }

    await updateUser(user._id, {
      "security.emailVerified": true,
      "security.emailVerificationTokenUsedHash": tokenHash,
      "security.emailVerificationToken": null,
      "security.emailVerificationExpires": null,
    });

    console.log("Verification successful for", hashStarEmail(user.email));

    return res.status(200).json({
      message: "Email verified successfully.",
    });
  } catch (error) {
    return next(error);
  }
}

async function resendEmailVerification(req, res, next) {
  try {
    const result = await issueEmailVerificationService(req.body?.email);

    if (result.hasbeenVerified) {
      return res.status(200).json({
        message: "Your account has already been verified. Please log in.",
        alreadyVerified: true,
        verificationSent: false,
      });
    }

    if (result.notFound) {
      return res.status(200).json({
        message:
          "If the account can receive verification mail, a new link has been sent.",
        verificationSent: false,
      });
    }

    if (result.success) {
      try {
        await sendEmailVerificationEmail(result.email, result.token);
        return res.status(200).json({
          message: "A new verification link has been sent to your email.",
          verificationSent: true,
        });
      } catch (error) {
        console.error("Failed to send verification email:", error);
        return res.status(502).json({
          message:
            "We could not send the verification email right now. Please try again shortly.",
          verificationSent: false,
        });
      }
    }

    return res.status(200).json({
      message:
        "If the account can receive verification mail, a new link has been sent.",
      verificationSent: false,
    });
  } catch (error) {
    return next(error);
  }
}

async function signin(req, res, next) {
  try {
    const result = await loginService(req.body);

    return res.status(200).json({
      message: "Login successful.",
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    return next(error);
  }
}

async function appleAuth(req, res, next) {
  try {
    const result = await appleAuthService(req.body);

    return res.status(result.created ? 201 : 200).json({
      message: result.created
        ? "Apple account created successfully."
        : "Apple login successful.",
      user: result.user,
      token: result.token,
      created: result.created,
    });
  } catch (error) {
    return next(error);
  }
}

async function me(req, res) {
  return res.status(200).json({
    user: sanitizeUser(req.user),
  });
}

async function logout(req, res) {
  return res.status(200).json({
    message: "Signed out successfully.",
  });
}

async function updatePreferences(req, res, next) {
  try {
    const result = await updatePreferencesService(
      req.user.id,
      req.body?.data || req.body,
    );
    return res.status(200).json({
      message: "Preferences updated successfully.",
      user: result.user,
    });
  } catch (error) {
    return next(error);
  }
}

async function generateOtpVerificationToken(req, res, next) {
  try {
    const otpRequestTriesLeft = req.rateLimit.remaining;

    if (otpRequestTriesLeft === 0) {
      const error = new Error(
        "Too many OTP verification requests. Please try again later.",
      );

      error.status = 429;
      return next(error);
    }

    const result = await generateOtpVerificationTokenService(req.body);

    if (result.otpVerificationCode) {
      try {
        await sendOtpToEmail(
          req.body.email,
          result.otpVerificationCode,
          "request-reset-password",
        );
      } catch (error) {
        console.error("Failed to send password reset OTP:", error);
        const deliveryError = new Error(
          "We could not send the verification code right now. Please try again shortly.",
        );
        deliveryError.status = 502;
        return next(deliveryError);
      }
    }

    return res.status(200).json({
      message: result.otpVerificationCode
        ? "If an account exists for that email, a verification code has been sent."
        : "If an account exists for that email, a verification code has been sent.",
      otpRequestTriesLeft,
      passwordToken: result.otpVerificationToken,
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyOtpVerificationCode(req, res, next) {
  try {
    const { otp, email } = req.body;
    const { otpVerificationToken } = req.params;

    const user = await User.findOne({
      email,
      "security.otpVerificationToken": otpVerificationToken,
    });

    if (!user) {
      return res.status(400).json({
        error: "Invalid OTP verification token. Please request a new OTP.",
      });
    }

    const result = await verifyOtpVerificationCodeService(otp, email, res);

    if (result.isError) {
      return res.status(result.error.status).json({
        error: result.error.error,
      });
    }

    return res.status(200).json({
      isValid: result.isValid,
      message: "OTP verified successfully.",
      resetPasswordToken: result.resetPasswordToken,
    });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, passwords } = req.body;
    const { resetPasswordToken } = req.params;

    const user = await User.findOne({
      email,
      "security.resetPasswordToken": resetPasswordToken,
    });

    if (!user) {
      return res.status(400).json({
        error: "Invalid reset password token.",
      });
    }

    const result = await resetPasswordService({
      email,
      passwords,
    });

    return res.status(200).json({
      message: "Password reset successful.",
      user: result.user,
    });
  } catch (error) {
    return next(error);
  }
}

async function editUserInfo(req, res, next) {
  try {
    const { email, name, avatar } = req.body;
    const result = await editUserInfoService({ email, name, avatar });
    return res.status(200).json({
      message: "User information updated successfully.",
      user: result.user,
    });
  } catch (error) {
    return next(error);
  }
}

export {
  signup,
  signin,
  appleAuth,
  me,
  logout,
  updatePreferences,
  generateOtpVerificationToken,
  verifyOtpVerificationCode,
  verifyEmail,
  resendEmailVerification,
  resetPassword,
  editUserInfo,
};
