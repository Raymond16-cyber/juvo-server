import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  isAuthorizedTesterCode,
  isAuthorizedTesterEmail,
} from "../config/authorizedTesters.js";
import BetaTesterCode from "../models/BetaTesterCode.js";
import User from "../models/User.js";

const BETA_WINDOW_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GENERIC_CODE_ERROR =
  "This tester access code is invalid or unavailable.";

function isBetaAccessModeEnabled() {
  const raw = String(process.env.BETA_ACCESS_MODE || "")
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function getCodePepper() {
  return (
    process.env.BETA_CODE_PEPPER ||
    process.env.JWT_SECRET ||
    "juvo-beta-dev-pepper"
  );
}

function normalizeTesterCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function hashTesterCode(plainCode) {
  const normalized = normalizeTesterCode(plainCode);
  return createHash("sha256")
    .update(`${getCodePepper()}:${normalized}`)
    .digest("hex");
}

function codesMatch(plainCode, storedHash) {
  if (!plainCode || !storedHash) return false;
  const left = Buffer.from(hashTesterCode(plainCode), "utf8");
  const right = Buffer.from(String(storedHash), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function randomSegment(length = 4) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function generatePlainTesterCode() {
  return `JUVO-TEST-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
}

function presentBetaAccess(user, now = new Date()) {
  const role = user?.role || "user";
  if (role === "admin") {
    return {
      required: isBetaAccessModeEnabled(),
      role: "admin",
      status: "admin",
      activatedAt: null,
      expiresAt: null,
      remainingMs: null,
      hasAccess: true,
    };
  }

  const beta = user?.betaAccess || {};
  let status = beta.status || "none";
  const expiresAt = beta.expiresAt ? new Date(beta.expiresAt) : null;
  const activatedAt = beta.activatedAt ? new Date(beta.activatedAt) : null;

  if (status === "active" && expiresAt && expiresAt.getTime() <= now.getTime()) {
    status = "expired";
  }

  const remainingMs =
    status === "active" && expiresAt
      ? Math.max(0, expiresAt.getTime() - now.getTime())
      : 0;

  const hasAccess =
    !isBetaAccessModeEnabled() ||
    (status === "active" && remainingMs > 0);

  return {
    required: isBetaAccessModeEnabled(),
    role,
    status,
    activatedAt: activatedAt ? activatedAt.toISOString() : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    remainingMs: status === "active" ? remainingMs : null,
    hasAccess,
  };
}

async function syncExpiredBetaStatus(user, now = new Date()) {
  if (!user?.betaAccess) return user;
  if (user.role === "admin") return user;
  if (user.betaAccess.status !== "active") return user;
  const expiresAt = user.betaAccess.expiresAt
    ? new Date(user.betaAccess.expiresAt)
    : null;
  if (!expiresAt || expiresAt.getTime() > now.getTime()) return user;

  const updated = await User.findOneAndUpdate(
    {
      _id: user._id || user.id,
      "betaAccess.status": "active",
      "betaAccess.expiresAt": { $lte: now },
    },
    { $set: { "betaAccess.status": "expired" } },
    { new: true },
  );

  return updated || user;
}

function evaluateUserBetaAccess(user, now = new Date()) {
  if (!isBetaAccessModeEnabled()) {
    return { allowed: true, code: null, message: null, beta: presentBetaAccess(user, now) };
  }

  if ((user?.role || "user") === "admin") {
    return { allowed: true, code: null, message: null, beta: presentBetaAccess(user, now) };
  }

  const beta = presentBetaAccess(user, now);

  if (beta.status === "active" && beta.hasAccess) {
    return { allowed: true, code: null, message: null, beta };
  }

  if (beta.status === "expired") {
    return {
      allowed: false,
      code: "BETA_ACCESS_EXPIRED",
      message:
        "Your JUVO testing period has ended. Thank you for helping us test JUVO!",
      beta,
    };
  }

  if (beta.status === "revoked") {
    return {
      allowed: false,
      code: "BETA_ACCESS_REVOKED",
      message: "Your beta tester access has been revoked.",
      beta,
    };
  }

  return {
    allowed: false,
    code: "BETA_ACCESS_REQUIRED",
    message:
      "JUVO is in private beta. Enter a valid tester access code to continue.",
    beta,
  };
}

async function createTesterCodes({
  count = 1,
  expiresInDays = null,
  maxRedemptions = 1,
  boundEmail = null,
  note = "",
  createdBy = "cli",
} = {}) {
  const safeCount = Math.min(Math.max(Number(count) || 1, 1), 100);
  const safeMax = Math.min(Math.max(Number(maxRedemptions) || 1, 1), 1000);
  const expiresAt =
    expiresInDays != null && Number(expiresInDays) > 0
      ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000)
      : null;
  const email =
    boundEmail && String(boundEmail).trim()
      ? String(boundEmail).trim().toLowerCase()
      : null;

  const created = [];

  for (let i = 0; i < safeCount; i += 1) {
    let attempts = 0;
    while (attempts < 8) {
      attempts += 1;
      const plainCode = generatePlainTesterCode();
      const codeHash = hashTesterCode(plainCode);
      try {
        const doc = await BetaTesterCode.create({
          codeHash,
          codeHint: plainCode.slice(-4),
          status: "available",
          boundEmail: email,
          maxRedemptions: safeMax,
          redemptionCount: 0,
          expiresAt,
          note: String(note || "").trim().slice(0, 500),
          createdBy,
        });
        created.push({
          id: String(doc._id),
          code: plainCode,
          codeHint: doc.codeHint,
          boundEmail: doc.boundEmail,
          maxRedemptions: doc.maxRedemptions,
          expiresAt: doc.expiresAt,
          status: doc.status,
        });
        break;
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
  }

  return created;
}

async function listTesterCodes({ limit = 50 } = {}) {
  const rows = await BetaTesterCode.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();

  return rows.map((row) => ({
    id: String(row._id),
    codeHint: row.codeHint,
    status: row.status,
    boundEmail: row.boundEmail,
    maxRedemptions: row.maxRedemptions,
    redemptionCount: row.redemptionCount,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    note: row.note,
    redemptions: (row.redemptions || []).map((item) => ({
      userId: String(item.user),
      email: item.email || null,
      redeemedAt: item.redeemedAt,
    })),
    createdAt: row.createdAt,
  }));
}

async function revokeTesterCode(codeId, reason = "") {
  const updated = await BetaTesterCode.findOneAndUpdate(
    {
      _id: codeId,
      status: { $in: ["available", "exhausted"] },
    },
    {
      $set: {
        status: "revoked",
        revokedAt: new Date(),
        revokedReason: String(reason || "").trim().slice(0, 500),
      },
    },
    { new: true },
  );

  if (!updated) {
    return {
      success: false,
      message: "Code not found or already revoked.",
    };
  }

  return {
    success: true,
    data: {
      id: String(updated._id),
      status: updated.status,
      revokedAt: updated.revokedAt,
    },
  };
}

async function ensureHardcodedCodeDocument(plainCode) {
  const normalized = normalizeTesterCode(plainCode);
  if (!isAuthorizedTesterCode(normalized)) return null;

  const codeHash = hashTesterCode(normalized);
  let doc = await BetaTesterCode.findOne({ codeHash }).select("+codeHash");
  if (doc) return doc;

  try {
    doc = await BetaTesterCode.create({
      codeHash,
      codeHint: normalized.slice(-4),
      status: "available",
      maxRedemptions: 1,
      redemptionCount: 0,
      note: "hardcoded-config",
      createdBy: "config/authorizedTesters",
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    doc = await BetaTesterCode.findOne({ codeHash }).select("+codeHash");
  }
  return doc;
}

async function activateBetaWindowForUser(user, { codeId = null, now = new Date() } = {}) {
  const activatedAt = now;
  const expiresAt = new Date(activatedAt.getTime() + BETA_WINDOW_MS);
  user.betaAccess = {
    status: "active",
    activatedAt,
    expiresAt,
    codeId,
    grantedAt: activatedAt,
  };
  await user.save();
  return user;
}

/**
 * Activate a hardcoded allowlisted email without requiring a tester code.
 */
async function activateAuthorizedEmailForUser({ userId, email, now = new Date() }) {
  const user = await User.findById(userId);
  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  if ((user.role || "user") === "admin") {
    return {
      success: true,
      alreadyAdmin: true,
      user,
      beta: presentBetaAccess(user, now),
    };
  }

  const normalizedEmail = String(email || user.email || "")
    .trim()
    .toLowerCase();

  if (!isAuthorizedTesterEmail(normalizedEmail)) {
    return {
      success: false,
      statusCode: 403,
      code: "BETA_ACCESS_REQUIRED",
      message:
        "JUVO is in private beta. Enter a valid tester access code to continue.",
    };
  }

  if (
    user.betaAccess?.status === "active" ||
    user.betaAccess?.status === "expired" ||
    user.betaAccess?.status === "revoked"
  ) {
    const synced = await syncExpiredBetaStatus(user, now);
    const access = evaluateUserBetaAccess(synced, now);
    if (access.allowed) {
      return { success: true, user: synced, beta: access.beta };
    }
    return {
      success: false,
      statusCode: 403,
      code: access.code || "BETA_ACCESS_LOCKED",
      message: access.message,
      beta: access.beta,
    };
  }

  const activated = await activateBetaWindowForUser(user, { now });
  return {
    success: true,
    user: activated,
    beta: presentBetaAccess(activated, now),
  };
}

/**
 * Atomically redeem a tester code for a user and activate a 24h window.
 * Does not extend already-activated (active/expired/revoked) testers.
 */
async function redeemTesterCodeForUser({
  userId,
  email,
  plainCode,
  now = new Date(),
}) {
  const normalized = normalizeTesterCode(plainCode);
  if (!normalized || !normalized.startsWith("JUVO-TEST-")) {
    return { success: false, statusCode: 400, message: GENERIC_CODE_ERROR };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  if ((user.role || "user") === "admin") {
    return {
      success: true,
      alreadyAdmin: true,
      user,
      beta: presentBetaAccess(user, now),
    };
  }

  // Non-renewable: already activated testers cannot redeem another code.
  if (
    user.betaAccess?.status === "active" ||
    user.betaAccess?.status === "expired" ||
    user.betaAccess?.status === "revoked"
  ) {
    const synced = await syncExpiredBetaStatus(user, now);
    const access = evaluateUserBetaAccess(synced, now);
    return {
      success: false,
      statusCode: 403,
      code: access.code || "BETA_ACCESS_LOCKED",
      message:
        access.code === "BETA_ACCESS_EXPIRED"
          ? access.message
          : "This account already used a tester access window and cannot redeem another code.",
      beta: access.beta,
    };
  }

  const normalizedEmail = String(email || user.email || "")
    .trim()
    .toLowerCase();

  // Prefer hardcoded config codes so cloud setups do not need the CLI.
  let codeDoc = await ensureHardcodedCodeDocument(normalized);
  if (!codeDoc) {
    const codeHash = hashTesterCode(normalized);
    codeDoc = await BetaTesterCode.findOne({ codeHash }).select("+codeHash");
  }

  if (!codeDoc || !codesMatch(normalized, codeDoc.codeHash)) {
    return { success: false, statusCode: 400, message: GENERIC_CODE_ERROR };
  }

  if (codeDoc.status === "revoked") {
    return { success: false, statusCode: 400, message: GENERIC_CODE_ERROR };
  }

  if (codeDoc.expiresAt && new Date(codeDoc.expiresAt).getTime() <= now.getTime()) {
    if (codeDoc.status !== "expired") {
      codeDoc.status = "expired";
      await codeDoc.save();
    }
    return { success: false, statusCode: 400, message: GENERIC_CODE_ERROR };
  }

  if (codeDoc.boundEmail && codeDoc.boundEmail !== normalizedEmail) {
    return { success: false, statusCode: 400, message: GENERIC_CODE_ERROR };
  }

  if (codeDoc.redemptionCount >= codeDoc.maxRedemptions) {
    return { success: false, statusCode: 400, message: GENERIC_CODE_ERROR };
  }

  // Atomic reservation of a redemption slot.
  const reserveFilter = {
    _id: codeDoc._id,
    status: "available",
    redemptionCount: { $lt: codeDoc.maxRedemptions },
    $and: [
      {
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      codeDoc.boundEmail
        ? { boundEmail: normalizedEmail }
        : {
            $or: [
              { boundEmail: null },
              { boundEmail: { $exists: false } },
              { boundEmail: "" },
            ],
          },
    ],
  };

  const reserved = await BetaTesterCode.findOneAndUpdate(
    reserveFilter,
    {
      $inc: { redemptionCount: 1 },
      $push: {
        redemptions: {
          user: user._id,
          redeemedAt: now,
          email: normalizedEmail || null,
        },
      },
    },
    { new: true },
  );

  if (!reserved) {
    return { success: false, statusCode: 400, message: GENERIC_CODE_ERROR };
  }

  if (reserved.redemptionCount >= reserved.maxRedemptions) {
    reserved.status = "exhausted";
    await reserved.save();
  }

  const activated = await activateBetaWindowForUser(user, {
    codeId: reserved._id,
    now,
  });

  return {
    success: true,
    user: activated,
    beta: presentBetaAccess(activated, now),
  };
}

async function assertBetaAccessForRequest(user, now = new Date()) {
  if (!isBetaAccessModeEnabled()) {
    return { allowed: true, user, beta: presentBetaAccess(user, now) };
  }

  const synced = await syncExpiredBetaStatus(user, now);
  const access = evaluateUserBetaAccess(synced, now);
  return {
    ...access,
    user: synced,
  };
}

export {
  BETA_WINDOW_MS,
  activateAuthorizedEmailForUser,
  assertBetaAccessForRequest,
  codesMatch,
  createTesterCodes,
  evaluateUserBetaAccess,
  generatePlainTesterCode,
  hashTesterCode,
  isBetaAccessModeEnabled,
  listTesterCodes,
  normalizeTesterCode,
  presentBetaAccess,
  redeemTesterCodeForUser,
  revokeTesterCode,
  syncExpiredBetaStatus,
};
