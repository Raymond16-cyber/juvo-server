import {
  registerService,
  loginService,
  appleAuthService,
  generateResetPasswordTokenService,
  verifyResetPasswordCodeService,
  resetPasswordService,
} from "../services/authService.js";

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

async function generateResetPasswordToken(req, res, next) {
  try {
    // Check for limit request rate remaining
    const resetRequestTriesLeft = req.rateLimit.remaining;
    if (resetRequestTriesLeft === 0) {
      const error = new Error(
        "Too many password reset requests. Please try again later.",
      );
      error.status = 429;
      return next(error);
    }
    const result = await generateResetPasswordTokenService(req.body, res);
    return res.status(200).json({
      message: "Password reset token generated successfully.",
      resetRequestTriesLeft,
      resetPasswordCode: result.passwordResetCode,
      resetPasswordToken: result.resetPasswordToken,
      resetPasswordExpires: result.resetPasswordExpires,
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyPasswordResetCode(req, res, next) {
  try {
    const { resetPasswordCode, email } = req.body;
    const result = await verifyResetPasswordCodeService(
      resetPasswordCode,
      email,
    );
    return res.status(200).json({
      message: "Password reset code verified successfully.",
      isValid: result.isValid,
    });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  const { email, passwords } = req.body;
  const result = await resetPasswordService({email,passwords,res});
  return res.status(200).json({
    message: "Password reset successful.",
    user: result.user,
  });
}

export {
  signup,
  signin,
  appleAuth,
  me,
  generateResetPasswordToken,
  verifyPasswordResetCode,
  resetPassword,
};
