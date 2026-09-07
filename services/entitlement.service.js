import User from "../models/User.js";

const ENTITLEMENTS = Object.freeze({
  BASIC_JOURNAL: "basic_journal",
  BASIC_ANALYTICS: "basic_analytics",
  ADVANCED_ANALYTICS: "advanced_analytics",
  BEHAVIORAL_INSIGHTS: "behavioral_insights",
  JUVO_AI: "juvo_ai",
});

const PLAN_ENTITLEMENTS = Object.freeze({
  free: [ENTITLEMENTS.BASIC_JOURNAL, ENTITLEMENTS.BASIC_ANALYTICS],
  pro: [
    ENTITLEMENTS.BASIC_JOURNAL,
    ENTITLEMENTS.BASIC_ANALYTICS,
    ENTITLEMENTS.ADVANCED_ANALYTICS,
    ENTITLEMENTS.BEHAVIORAL_INSIGHTS,
    ENTITLEMENTS.JUVO_AI,
  ],
  super: [
    ENTITLEMENTS.BASIC_JOURNAL,
    ENTITLEMENTS.BASIC_ANALYTICS,
    ENTITLEMENTS.ADVANCED_ANALYTICS,
    ENTITLEMENTS.BEHAVIORAL_INSIGHTS,
    ENTITLEMENTS.JUVO_AI,
  ],
  // Future family plans should grant feature access here without sharing a
  // member's private journals, trades, broker tokens, or AI conversation data.
  family: [
    ENTITLEMENTS.BASIC_JOURNAL,
    ENTITLEMENTS.BASIC_ANALYTICS,
    ENTITLEMENTS.ADVANCED_ANALYTICS,
    ENTITLEMENTS.BEHAVIORAL_INSIGHTS,
    ENTITLEMENTS.JUVO_AI,
  ],
});

const JUVO_AI_TRIAL_DAYS = 3;
const JUVO_AI_TRIAL_MS = JUVO_AI_TRIAL_DAYS * 24 * 60 * 60 * 1000;
const JUVO_AI_ACCESS_REQUIRED = Object.freeze({
  success: false,
  code: "JUVO_AI_ACCESS_REQUIRED",
  message: "JUVO AI requires Pro, Super, or an active trial.",
});

function normalizePlan(plan) {
  return ["free", "pro", "super"].includes(plan) ? plan : "free";
}

function getPlanEntitlements(plan) {
  return PLAN_ENTITLEMENTS[normalizePlan(plan)] || PLAN_ENTITLEMENTS.free;
}

function serializeDate(value) {
  return value ? new Date(value).toISOString() : null;
}

function getAiTrialStatus(aiTrial = {}, now = new Date()) {
  const expiresAt = aiTrial?.expiresAt ? new Date(aiTrial.expiresAt) : null;
  const startedAt = aiTrial?.startedAt ? new Date(aiTrial.startedAt) : null;
  const used = Boolean(aiTrial?.used || startedAt || expiresAt);
  const isActive = Boolean(expiresAt && expiresAt.getTime() > now.getTime());

  if (isActive) return "active";
  if (used) return "expired";
  return "available";
}

function getAiTrial(user, now = new Date()) {
  const aiTrial = user?.entitlements?.aiTrial || {};
  const status = getAiTrialStatus(aiTrial, now);

  return {
    status,
    used: Boolean(aiTrial?.used || status !== "available"),
    startedAt: serializeDate(aiTrial?.startedAt),
    expiresAt: serializeDate(aiTrial?.expiresAt),
  };
}

function hasPlanEntitlement(user, entitlement) {
  const plan = normalizePlan(user?.subscription?.plan);
  return getPlanEntitlements(plan).includes(entitlement);
}

function getFeatureAccess(user, entitlement, now = new Date()) {
  const plan = normalizePlan(user?.subscription?.plan);
  const trial = getAiTrial(user, now);
  const hasSubscriptionAccess = hasPlanEntitlement(user, entitlement);
  const hasTrialAccess =
    entitlement === ENTITLEMENTS.JUVO_AI && trial.status === "active";

  return {
    feature: entitlement,
    plan,
    hasAccess: hasSubscriptionAccess || hasTrialAccess,
    source: hasSubscriptionAccess ? "subscription" : hasTrialAccess ? "trial" : null,
    trial,
  };
}

async function getUserFeatureAccess(userId, entitlement) {
  const user = await User.findById(userId).select("subscription entitlements");
  if (!user) {
    return null;
  }
  return getFeatureAccess(user, entitlement);
}

async function startJuvoAiTrial(userId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + JUVO_AI_TRIAL_MS);

  const startedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      $and: [
        {
          $or: [
            { "entitlements.aiTrial.used": { $exists: false } },
            { "entitlements.aiTrial.used": false },
          ],
        },
        { "entitlements.aiTrial.startedAt": { $exists: false } },
      ],
    },
    {
      $set: {
        "entitlements.aiTrial.status": "active",
        "entitlements.aiTrial.startedAt": now,
        "entitlements.aiTrial.expiresAt": expiresAt,
        "entitlements.aiTrial.used": true,
      },
    },
    { new: true },
  ).select("subscription entitlements");

  if (startedUser) {
    return getFeatureAccess(startedUser, ENTITLEMENTS.JUVO_AI, now);
  }

  const existingUser = await User.findById(userId).select("subscription entitlements");
  return existingUser ? getFeatureAccess(existingUser, ENTITLEMENTS.JUVO_AI, now) : null;
}

async function userCanUseJuvoAi(userId) {
  const access = await getUserFeatureAccess(userId, ENTITLEMENTS.JUVO_AI);
  return Boolean(access?.hasAccess);
}

export {
  ENTITLEMENTS,
  JUVO_AI_ACCESS_REQUIRED,
  PLAN_ENTITLEMENTS,
  getAiTrial,
  getFeatureAccess,
  getPlanEntitlements,
  getUserFeatureAccess,
  hasPlanEntitlement,
  startJuvoAiTrial,
  userCanUseJuvoAi,
};
