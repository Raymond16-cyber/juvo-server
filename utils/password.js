import bcrypt from "bcryptjs";
import { signToken } from "./token.js";

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, storedPassword) {
  return bcrypt.compare(password, storedPassword);
}


export async function generateResetPasswordToken() {
  const token = signToken({ resetPassword: true }, "1h"); // Token expires in 1 hour
  return token;
}