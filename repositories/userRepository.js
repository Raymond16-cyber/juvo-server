import User from "../models/User.js";
import { hashStarEmail } from "../utils/email.js";

export async function findUserByEmail(email) {
  if (!email || typeof email !== "string") {
    console.log("Invalid email passed to findUserByEmail");
    return null;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const hashedEmail = hashStarEmail(normalizedEmail)

  console.log("Searching for:", hashedEmail);

  const user = await User.findOne({ email: normalizedEmail });

  return user;
}
export async function findUserById(id) {
  return User.findById(id);
}

export async function findUserByProviderId(providerId) {
  if (!providerId) {
    return null;
  }

  return await User.findOne({ providerId });
}

export async function createUser(userData) {
  const user = await User.create({
    fullName: userData.fullName,
    email: userData.email || null,
    authProvider: userData.authProvider || "local",
    providerId: userData.providerId || null,
    password: userData.password || null,
    pushToken: userData.pushToken || null,
    security: userData.security,
  });

  return user;
}

export async function updateUser(userId, updates) {
  const user = await User.findByIdAndUpdate(userId, updates, { new: true });
  return user;
}
