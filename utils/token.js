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

export {
  signToken,
  verifyToken,
};
