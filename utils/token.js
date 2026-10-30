import "../config/loadEnv.js";
import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required.");
}

function resolveTokenTtlSeconds(user) {
  const betaExpiresAt = user?.betaAccess?.expiresAt
    ? new Date(user.betaAccess.expiresAt)
    : null;
  const betaActive =
    user?.betaAccess?.status === "active" &&
    betaExpiresAt &&
    betaExpiresAt.getTime() > Date.now();

  if (!betaActive || (user?.role || "user") === "admin") {
    return jwtExpiresIn;
  }

  const remainingSeconds = Math.max(
    1,
    Math.floor((betaExpiresAt.getTime() - Date.now()) / 1000),
  );
  // Never issue a JWT that outlives the tester window.
  return `${remainingSeconds}s`;
}

function signToken(user) {
  const payload = {
    sub: user.id || user._id,
    email: user.email,
    fullName: user.fullName,
    role: user.role || "user",
  };

  if (user?.betaAccess?.expiresAt) {
    payload.betaExp = new Date(user.betaAccess.expiresAt).toISOString();
  }

  return jwt.sign(payload, jwtSecret, {
    expiresIn: resolveTokenTtlSeconds(user),
  });
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

function signOAuthState(payload, expiresIn = "15m") {
  return jwt.sign(
    {
      ...payload,
      purpose: "ctrader-oauth",
    },
    jwtSecret,
    { expiresIn },
  );
}

function verifyOAuthState(token) {
  const decoded = jwt.verify(token, jwtSecret);
  if (decoded?.purpose !== "ctrader-oauth") {
    throw new Error("Invalid broker OAuth state.");
  }
  return decoded;
}

function signWaitlistUnsubscribeToken(waitlistId) {
  return jwt.sign(
    { sub: String(waitlistId), purpose: "waitlist-unsubscribe" },
    jwtSecret,
    { expiresIn: "365d" },
  );
}

function verifyWaitlistUnsubscribeToken(token) {
  const decoded = jwt.verify(token, jwtSecret);
  if (decoded?.purpose !== "waitlist-unsubscribe")
    throw new Error("Invalid waitlist unsubscribe token.");
  return decoded;
}

export {
  signToken,
  verifyToken,
  signOAuthState,
  verifyOAuthState,
  signWaitlistUnsubscribeToken,
  verifyWaitlistUnsubscribeToken,
};
