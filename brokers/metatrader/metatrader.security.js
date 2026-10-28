import { createHash, createHmac, randomBytes } from "node:crypto";
import BrokerConnection from "../../models/Broker.model.js";
import User from "../../models/User.js";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function accountKey(info) {
  return hash(`mt5\n${info.server.trim().toLowerCase()}\n${info.login}`);
}
export function connectorError(code, message, status = 400) {
  return Object.assign(new Error(message), {
    code,
    status,
    safeConnector: true,
  });
}
export function connectorLog(event, fields = {}) {
  if (process.env.MT5_DEBUG !== "true" || process.env.NODE_ENV === "production")
    return;
  console.info(`[MT5] ${event}`, {
    ...(Number.isInteger(fields.count) ? { count: fields.count } : {}),
  });
}
export function connectorConfig(env = process.env) {
  const url =
    env.MT5_CONNECTOR_URL ||
    (env.NODE_ENV !== "production" ? "http://localhost:5000" : "");
  if (!url) return { enabled: false, url: "" };
  const parsed = new URL(url);
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    (parsed.protocol !== "https:" &&
      !(
        env.NODE_ENV !== "production" &&
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      ))
  ) {
    throw connectorError(
      "CONFIG",
      "MT5_CONNECTOR_URL must be an HTTPS origin (localhost HTTP is allowed only in development).",
      503,
    );
  }
  return { enabled: Boolean(env.JWT_SECRET), url: parsed.origin };
}
export function newPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const value = [...randomBytes(12)]
    .map((byte) => alphabet[byte & 31])
    .join("");
  return `JUV-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
}
export function tokenForPair(pair) {
  if (!process.env.JWT_SECRET)
    throw connectorError(
      "CONFIG",
      "Connector authentication is not configured.",
      503,
    );
  return `jmt_${createHmac("sha256", process.env.JWT_SECRET).update(`juvo-mt5-v1:${pair._id}:${pair.codeHash}:${pair.attemptHash}:${pair.accountKey}`).digest("base64url")}`;
}
export async function authenticateMetaTraderConnector(req, res, next) {
  try {
    const token = /^Connector (jmt_[A-Za-z0-9_-]{43})$/.exec(
      req.headers.authorization || "",
    )?.[1];
    if (!token)
      throw connectorError(
        "UNAUTHORIZED",
        "Connector credential is missing or revoked.",
        401,
      );
    const connection = await BrokerConnection.findOne({
      provider: "metatrader",
      platform: "mt5",
      desiredConnected: true,
      revokedAt: null,
      connectorTokenHash: hash(token),
    }).select("+connectorTokenHash");
    if (!connection || !(await User.exists({ _id: connection.userId })))
      throw connectorError(
        "UNAUTHORIZED",
        "Connector credential is missing or revoked.",
        401,
      );
    req.connector = connection;
    next();
  } catch (error) {
    res
      .status(error.safeConnector ? error.status : 503)
      .json({
        message: error.safeConnector
          ? error.message
          : "Connector authentication is temporarily unavailable.",
      });
  }
}
export function requireConnectorHttps(req, res, next) {
  if (process.env.NODE_ENV === "production" && !req.secure)
    return res
      .status(426)
      .json({ message: "HTTPS is required for the MT5 connector." });
  next();
}
