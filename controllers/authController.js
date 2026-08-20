import {
  registerService,
  loginService,
  appleAuthService,
  generateOtpVerificationTokenService,
  verifyOtpVerificationCodeService,
  resetPasswordService,
} from "../services/authService.js";
import { sendOtpToEmail } from "../utils/email.js";
import User from "../models/User.js";

async function signup(req, res, next) {
  try {
    const result = await registerService(req.body);

    return res.status(201).json({
      message: "User registered successfully.",
      user: result.user,
      token: result.token,
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
  console.log("Apple Auth Request Body:", req.body); // Log the request body for debugging
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
    user: req.user,
  });
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

    await sendOtpToEmail(
      req.body.email,
      result.otpVerificationCode,
      "request-reset-password",
    );

    return res.status(200).json({
      message:
        "If successfully sent, you'd be redirected to the OTP verification page.",
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
    // check if the otpVerificationToken in the request params matches the one stored in the database for the given email
    const user = await User.findOne({
      email,
      "security.otpVerificationToken": otpVerificationToken,
    });
    if (!user) {
      return res.status(400).json({
        error:
          "Invalid OTP verification token. Please request a new OTP.",
      });
    }
    const result = await verifyOtpVerificationCodeService(otp, email, res);
    if (result.isError) {
      return res.status(result.error.status).json({
        error: result.error.error,
      });
    }
    // const resetPasswordToken = await 
    return res.status(200).json({
      message: "OTP verified successfully.",
      isValid: result.isValid,
    });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, passwords } = req.body;

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
  generateOtpVerificationToken,
  verifyOtpVerificationCode,
  resetPassword,
  editUserInfo,
};
