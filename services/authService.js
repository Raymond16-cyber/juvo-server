import { hashPassword, verifyPassword } from "../utils/password.js";
import { signToken } from "../utils/token.js";
import { findUserByEmail, createUser, findUserByProviderId, updateUser } from "../repositories/userRepository.js";
import { validateRegisterInput, validateLoginInput, validateAppleAuthInput } from "..//validations/authValidation.js";
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
  console.log("results: ")
  
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

  const passwordMatches = await verifyPassword(result.data.password, user.password);
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
      ...(result.data.fullName && !user.fullName ? { fullName: result.data.fullName } : {}),
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

export  {
  registerService,
  loginService,
  appleAuthService,
};