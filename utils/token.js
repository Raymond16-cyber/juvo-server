import "../config/loadEnv.js";
import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required.");
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
    },
    jwtSecret,
    {
      expiresIn: jwtExpiresIn,
    }
  );
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

export {
  signToken,
  verifyToken,
  signOAuthState,
  verifyOAuthState,
};
