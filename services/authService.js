import {
  generateResetPasswordToken,
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
  validateResetPasswordInput,
  validateVerifyResetPasswordCodeInput,
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

async function generateResetPasswordTokenService(payload, res) {
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
  // Check if user just requested a password reset within the last 1 minute
  if (
    user.resetPasswordRequestedAt &&
    Date.now() - user.resetPasswordRequestedAt < 60 * 1000
  ) {
    return res.status(429).json({
      success: false,
      message:
        "You can only request a password reset once every minute. Please try again later.",
    });
  }

  // Generate a reset password token and expiration
  const resetPasswordRequestedAt = new Date();
  const resetPasswordToken = await generateResetPasswordToken();
  const resetPasswordExpires = new Date();
  resetPasswordExpires.setHours(resetPasswordExpires.getHours() + 0.25); // Token expires in 15 minutes
  const passwordResetCode = Math.floor(
    100000 + Math.random() * 900000,
  ).toString(); // Generate a 6-digit code

  // If client is wired, i'd like to hash the resetCode b4 saving in the DataBase and compare user input with hashed code. For now, saving the code in plain text for simplicity.

  const security = user.security?.toObject
    ? user.security.toObject()
    : user.security || {};

  await updateUser(user.id, {
    security: {
      ...security,
      resetPasswordRequestedAt,
      resetPasswordToken,
      resetPasswordExpires,
      resetPasswordCode: passwordResetCode,
    },
  });

  return {
    user: sanitizeUser(user),
    resetPasswordToken,
    resetPasswordExpires,
    passwordResetCode,
  };
}

// verify the reset password code provided by the user
async function verifyResetPasswordCodeService(resetPasswordCode, email) {
  const result = validateVerifyResetPasswordCodeInput({ resetPasswordCode });
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
  // if (!user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
  //   const error = new Error("Reset password code has expired.");
  //   error.status = 400;
  //   throw error;
  // }

  // Compare the user input and available reset code in DB
  if (security.resetPasswordCode !== resetPasswordCode) {
    const error = new Error("Invalid reset password code.");
    error.status = 400;
    throw error;
  }

  return {
    isValid: true,
  };
}

async function resetPasswordService(payload) {
  const result = validateResetPasswordInput(payload);

  // console.log("results from reset password service",result)
  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    payload.res.status(400).json({ message: result.errors.join(" ") });
  }

  const user = await findUserByEmail(result.data.email);
  if (!user) {
    const error = new Error("User not found.");
    payload.res.status(404).json({ message: "User not found." });
  }
  const security = user.security?.toObject
    ? user.security.toObject()
    : user.security || {};
    
  // hash the new password
  const newPasswordHash = await hashPassword(result.data.newPassword);

  // Update the user's password
  const updatedUser = await updateUser(user.id, {
    password: newPasswordHash,
    security: {
      ...security,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      resetPasswordCode: null,
      resetPasswordRequestedAt: null,
    },
  });

  return {
    user: sanitizeUser(updatedUser),
  };
}


async function editUserInfoService(payload){
  
}

export {
  registerService,
  loginService,
  appleAuthService,
  generateResetPasswordTokenService,
  verifyResetPasswordCodeService,
  resetPasswordService,
};
