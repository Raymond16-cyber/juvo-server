import User from "../models/User.js";

export async function findUserByEmail(email) {
  if (!email) {
    return null;
  }

  return User.findOne({ email: email.toLowerCase().trim() });
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
  });

  return user;
}

export async function updateUser(userId, updates) {
  const user = await User.findByIdAndUpdate(userId, updates, { new: true });
  console.log("success")
  return user;
}

