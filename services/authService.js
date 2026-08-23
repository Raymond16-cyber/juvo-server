import {
  generateOtpVerificationToken,
  generateRequestOtpToken,
  hashPassword,
  verifyPassword,
} from "../utils/password.js";
import { signToken } from "../utils/token.js";
import {
  findUserByEmail,
  createUser,
  findUserByProviderId,
  updateUser,
} from "../repositories/userRepository.js";
import {
  validateRegisterInput,
  validateLoginInput,
  validateAppleAuthInput,
  validateVerifyOtpVerificationCodeInput,
  validateRequestOtpInput,
  validateResetPasswordInput
} from "..//validations/authValidation.js";
import { sendWelcomeNotification } from "../services/notificationService.js";

function sanitizeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function registerService(payload) {
  const result = validateRegisterInput(payload);

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    error.status = 400;
    throw error;
  }

  const existingUser = await findUserByEmail(result.data.email);
  if (existingUser) {
    const error = new Error("Email is already registered.");
    error.status = 409;
    throw error;
  }

  const passwordHash = await hashPassword(result.data.password);
  const createdUser = await createUser({
    fullName: result.data.fullName,
    email: result.data.email,
    authProvider: "local",
    password: passwordHash,
    pushToken: result.data.pushToken || null,
    // providerId:payload.providerId
  });
  console.log("results:");

  if (result.data.pushToken) {
    sendWelcomeNotification(result.data.pushToken).catch((error) => {
      console.error("Failed to send welcome push notification", error);
    });
  }

  const token = signToken(createdUser);

  return {
    user: sanitizeUser(createdUser),
    token,
  };
}

async function loginService(payload) {
  const result = validateLoginInput(payload);

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    error.status = 400;
    throw error;
  }

  const user = await findUserByEmail(result.data.email);
  if (!user) {
    const error = new Error("Invalid email or password.");
    error.status = 401;
    throw error;
  }

  const passwordMatches = await verifyPassword(
    result.data.password,
    user.password,
  );
  if (!passwordMatches) {
    const error = new Error("Invalid email or password.");
    error.status = 401;
    throw error;
  }

  const token = signToken(user);

  return {
    user: sanitizeUser(user),
    token,
  };
}

async function appleAuthService(payload) {
  const result = validateAppleAuthInput(payload);

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    error.status = 400;
    throw error;
  }

  let user = await findUserByProviderId(result.data.appleUserId);
  let created = false;

  if (!user && result.data.email) {
    user = await findUserByEmail(result.data.email);
  }

  if (!user) {
    created = true;
    user = await createUser({
      fullName: result.data.fullName || "MyHub User",
      email: result.data.email || null,
      authProvider: "apple",
      providerId: result.data.appleUserId,
      pushToken: result.data.pushToken || null,
      password: null,
    });
  } else {
    user = await updateUser(user.id, {
      authProvider: "apple",
      providerId: result.data.appleUserId,
      pushToken: result.data.pushToken || user.pushToken || null,
      ...(result.data.fullName && !user.fullName
        ? { fullName: result.data.fullName }
        : {}),
      ...(result.data.email && !user.email ? { email: result.data.email } : {}),
    });
  }

  if (created && result.data.pushToken) {
    sendWelcomeNotification(result.data.pushToken).catch((error) => {
      console.error("Failed to send welcome push notification", error);
    });
  }
  const token = signToken(user);

  return {
    user: sanitizeUser(user),
    token,
    created,
  };
}

async function generateOtpVerificationTokenService(payload) {
  const result = validateRequestOtpInput(payload);

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    error.status = 400;
    throw error;
  }

  const user = await findUserByEmail(result.data.email);

  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  // Prevent another request within 1 minute
  if (
    user.security?.otpVerificationRequestedAt &&
    Date.now() - new Date(user.security.otpVerificationRequestedAt).getTime() <
      60 * 1000
  ) {
    const error = new Error(
      "You can only request a password reset once every minute. Please try again later.",
    );

    error.status = 429;
    throw error;
  }

  const otpVerificationRequestedAt = new Date();

  const otpVerificationToken = await generateRequestOtpToken();

  const otpVerificationExpires = new Date(Date.now() + 15 * 60 * 1000);

  const otpVerificationCode = Math.floor(
    100000 + Math.random() * 900000,
  ).toString();

  const security = user.security?.toObject
    ? user.security.toObject()
    : user.security || {};

  const updatedUser = await updateUser(user.id, {
    security: {
      ...security,
      otpVerificationRequestedAt,
      otpVerificationToken,
      otpVerificationExpires,
      otpVerificationCode,
      isOtpVerified: false,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      resetPasswordRequestedAt: null,
      resetPasswordVerified: false,
    },
  });

  return {
    user: sanitizeUser(updatedUser),
    otpVerificationToken,
    otpVerificationExpires,
    otpVerificationCode,
  };
}

// verify the OTP verification code provided by the user
async function verifyOtpVerificationCodeService(otp, email, res) {
  const result = validateVerifyOtpVerificationCodeInput({ otp });

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    error.status = 400;
    throw error;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  const security = user.security?.toObject
    ? user.security.toObject()
    : user.security || {};

  // Check if time for verifying the code has expired
  if (
    !security.otpVerificationExpires ||
    security.otpVerificationExpires < new Date()
  ) {
    const error = new Error("OTP verification code has expired.");
    error.status = 400;
    throw error;
  }

  // Compare the user input and available reset code in DB
  if (security.otpVerificationCode !== otp) {
    let error = {};
    error.error = "Invalid OTP verification code";
    error.status = 400;
    return { error, isError: true };
  }

  const resetPasswordToken = await generateOtpVerificationToken();
  const resetPasswordRequestedAt = new Date();
  const resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

  await updateUser(user._id, {
    security: {
      ...security,
      resetPasswordToken,
      resetPasswordRequestedAt,
      resetPasswordExpires,
      isOtpVerified: true,
    },
  });

  return {
    isValid: true,
    resetPasswordToken,
  };
}

async function resetPasswordService(payload) {
  const result = validateResetPasswordInput(payload);

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    error.status = 400;
    throw error;
  }

  const user = await findUserByEmail(result.data.email);

  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  const security = user.security?.toObject
    ? user.security.toObject()
    : user.security || {};

  // Make sure OTP was verified
  if (!security.isOtpVerified) {
    const error = new Error("Please verify your password reset code first.");

    error.status = 403;
    throw error;
  }

  // Make sure reset session hasn't expired
  if (
    !security.resetPasswordExpires ||
    new Date(security.resetPasswordExpires) < new Date()
  ) {
    const error = new Error(
      "Your password reset session has expired. Please request a new code.",
    );

    error.status = 400;
    throw error;
  }

  const newPasswordHash = await hashPassword(result.data.passwords);

  const updatedUser = await updateUser(user.id, {
    password: newPasswordHash,

    security: {
      ...security,

      // Invalidate the reset session
      resetPasswordToken: null,
      resetPasswordExpires: null,
      resetPasswordCode: null,
      resetPasswordRequestedAt: null,
      resetPasswordVerified: false,
    },
  });

  return {
    user: sanitizeUser(updatedUser),
  };
}

async function editUserInfoService(payload) {}

export {
  registerService,
  loginService,
  appleAuthService,
  generateOtpVerificationTokenService,
  verifyOtpVerificationCodeService,
  resetPasswordService,
};
