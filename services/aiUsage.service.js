import AiUsage from "../models/AiUsage.js";
import { ENTITLEMENTS } from "./entitlement.service.js";

// Configurable monthly limits per plan/feature. null = unlimited within access.
const MONTHLY_LIMITS = Object.freeze({
  free: {
    [ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER]: 3,
    [ENTITLEMENTS.PLAN_COMPLIANCE_CHECK]: 0,
    [ENTITLEMENTS.AI_PERIOD_REVIEW]: 0,
    [ENTITLEMENTS.ASK_YOUR_JOURNAL]: 0,
    [ENTITLEMENTS.EXPLAIN_METRICS]: 0,
    [ENTITLEMENTS.GOAL_COACH]: 0,
    [ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS]: 0,
    [ENTITLEMENTS.JUVO_AI]: 0,
  },
  // During an active JUVO AI trial, free users get elevated interviewer quota.
  free_trial: {
    [ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER]: 30,
    [ENTITLEMENTS.ASK_YOUR_JOURNAL]: 40,
    [ENTITLEMENTS.JUVO_AI]: null,
  },
  pro: {
    [ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER]: 50,
    [ENTITLEMENTS.PLAN_COMPLIANCE_CHECK]: 40,
    [ENTITLEMENTS.AI_PERIOD_REVIEW]: 8,
    [ENTITLEMENTS.ASK_YOUR_JOURNAL]: 60,
    [ENTITLEMENTS.EXPLAIN_METRICS]: 40,
    [ENTITLEMENTS.GOAL_COACH]: 0,
    [ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS]: 0,
    [ENTITLEMENTS.JUVO_AI]: null,
  },
  super: {
    [ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER]: 100,
    [ENTITLEMENTS.PLAN_COMPLIANCE_CHECK]: 80,
    [ENTITLEMENTS.AI_PERIOD_REVIEW]: 20,
    [ENTITLEMENTS.ASK_YOUR_JOURNAL]: 120,
    [ENTITLEMENTS.EXPLAIN_METRICS]: 80,
    [ENTITLEMENTS.GOAL_COACH]: 40,
    [ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS]: 30,
    [ENTITLEMENTS.JUVO_AI]: null,
  },
});

const USAGE_FEATURES = Object.freeze([
  ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER,
  ENTITLEMENTS.PLAN_COMPLIANCE_CHECK,
  ENTITLEMENTS.AI_PERIOD_REVIEW,
  ENTITLEMENTS.ASK_YOUR_JOURNAL,
  ENTITLEMENTS.EXPLAIN_METRICS,
  ENTITLEMENTS.GOAL_COACH,
  ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS,
]);

function periodKeyFromDate(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function resolveLimitBucket(plan, trialActive) {
  const normalized = ["free", "pro", "super"].includes(plan) ? plan : "free";
  if (normalized === "free" && trialActive) return "free_trial";
  return normalized;
}

function getMonthlyLimit(plan, feature, { trialActive = false } = {}) {
  const bucket = resolveLimitBucket(plan, trialActive);
  const table = MONTHLY_LIMITS[bucket] || MONTHLY_LIMITS.free;
  if (Object.prototype.hasOwnProperty.call(table, feature)) {
    return table[feature];
  }
  const fallback = MONTHLY_LIMITS[plan] || MONTHLY_LIMITS.free;
  return Object.prototype.hasOwnProperty.call(fallback, feature)
    ? fallback[feature]
    : 0;
}

function remainingFromCount(limit, count) {
  if (limit === null) return null;
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, limit - Number(count || 0));
}

function evaluateUsageGate({ limit, count }) {
  if (limit === 0) {
    return {
      allowed: false,
      reason: "not_included",
      limit,
      used: Number(count || 0),
      remaining: 0,
    };
  }
  if (limit === null) {
    return {
      allowed: true,
      reason: null,
      limit: null,
      used: Number(count || 0),
      remaining: null,
    };
  }
  const used = Number(count || 0);
  const remaining = remainingFromCount(limit, used);
  return {
    allowed: remaining > 0,
    reason: remaining > 0 ? null : "quota_exceeded",
    limit,
    used,
    remaining,
  };
}

async function getUsageCount(userId, feature, periodKey = periodKeyFromDate()) {
  const row = await AiUsage.findOne({
    user: userId,
    feature,
    periodKey,
  })
    .select("count")
    .lean();
  return Number(row?.count || 0);
}

async function getUsageSnapshot(
  userId,
  feature,
  { plan, trialActive = false, periodKey = periodKeyFromDate() } = {},
) {
  const limit = getMonthlyLimit(plan, feature, { trialActive });
  const used = await getUsageCount(userId, feature, periodKey);
  return {
    feature,
    periodKey,
    ...evaluateUsageGate({ limit, count: used }),
  };
}

async function assertWithinQuota(
  userId,
  feature,
  { plan, trialActive = false, periodKey = periodKeyFromDate() } = {},
) {
  const snapshot = await getUsageSnapshot(userId, feature, {
    plan,
    trialActive,
    periodKey,
  });
  if (!snapshot.allowed) {
    return {
      success: false,
      statusCode: 403,
      code:
        snapshot.reason === "not_included"
          ? "ENTITLEMENT_REQUIRED"
          : "AI_USAGE_LIMIT",
      message:
        snapshot.reason === "not_included"
          ? "Your plan does not include this feature."
          : "You have reached this month's Juvo AI usage limit for this feature.",
      usage: snapshot,
    };
  }
  return { success: true, usage: snapshot };
}

async function incrementUsage(
  userId,
  feature,
  { periodKey = periodKeyFromDate(), by = 1 } = {},
) {
  const updated = await AiUsage.findOneAndUpdate(
    { user: userId, feature, periodKey },
    { $inc: { count: by } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return {
    feature,
    periodKey,
    used: Number(updated?.count || by),
  };
}

async function buildUsageMapForUser(
  userId,
  { plan, trialActive = false, periodKey = periodKeyFromDate() } = {},
) {
  const rows = await AiUsage.find({
    user: userId,
    periodKey,
    feature: { $in: USAGE_FEATURES },
  })
    .select("feature count")
    .lean();

  const usedByFeature = Object.fromEntries(
    rows.map((row) => [row.feature, Number(row.count || 0)]),
  );

  const usage = {};
  for (const feature of USAGE_FEATURES) {
    const limit = getMonthlyLimit(plan, feature, { trialActive });
    const used = usedByFeature[feature] || 0;
    usage[feature] = {
      feature,
      periodKey,
      ...evaluateUsageGate({ limit, count: used }),
    };
  }
  return usage;
}

export {
  MONTHLY_LIMITS,
  USAGE_FEATURES,
  assertWithinQuota,
  buildUsageMapForUser,
  evaluateUsageGate,
  getMonthlyLimit,
  getUsageCount,
  getUsageSnapshot,
  incrementUsage,
  periodKeyFromDate,
  remainingFromCount,
};
