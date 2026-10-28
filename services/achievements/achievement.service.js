import Journal from "../../models/Journal.js";
import NoTradeDay from "../../models/NoTradeDay.js";
import Trade from "../../models/Trades.js";
import User from "../../models/User.js";
import UserAchievement from "../../models/UserAchievement.js";
import { getUserTimeZone } from "../../utils/timezone.js";
import {
  isMeaningfulJournal,
  localDateKey,
} from "../journalStreak.service.js";
import {
  getAchievementDefinition,
  listAchievementDefinitions,
} from "./achievementCatalog.js";

const CRITERIA_VERSION = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function accountAgeDays(createdAt, now = new Date()) {
  const created = createdAt ? new Date(createdAt) : null;
  if (!created || !Number.isFinite(created.getTime())) return 0;
  const elapsed = now.getTime() - created.getTime();
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / MS_PER_DAY);
}

function collectQualifyingDayKeys(journals, noTradeDays, timeZone) {
  const keys = new Set();

  for (const journal of journals) {
    if (!isMeaningfulJournal(journal)) continue;
    // Prefer activity timestamp so backdated journalDate cannot invent days.
    const activityAt =
      journal.updatedAt || journal.createdAt || journal.journalDate || new Date();
    keys.add(localDateKey(new Date(activityAt), timeZone));
  }

  for (const entry of noTradeDays) {
    if (entry?.supersededByTrade) continue;
    if (entry?.localDayKey) keys.add(entry.localDayKey);
  }

  return keys;
}

async function computeProgressSnapshot(userId, now = new Date()) {
  const user = await User.findById(userId)
    .select(
      "createdAt profile.timezone profile.featuredAchievements stats.currentJournalStreak stats.longestJournalStreak",
    )
    .lean();

  if (!user) {
    return null;
  }

  const timeZone = getUserTimeZone(user);

  const [journals, noTradeDays, tradeCount] = await Promise.all([
    Journal.find({ user: userId })
      .select(
        "status psychology review trades createdAt updatedAt journalDate discipline",
      )
      .lean(),
    NoTradeDay.find({ user: userId, supersededByTrade: { $ne: true } })
      .select("localDayKey supersededByTrade")
      .lean(),
    Trade.countDocuments({
      user: userId,
      status: { $ne: "Cancelled" },
    }),
  ]);

  const qualifyingKeys = collectQualifyingDayKeys(journals, noTradeDays, timeZone);
  const completedReviews = journals.filter(
    (journal) => journal.status === "Completed",
  ).length;

  const planAnswered = journals.filter(
    (journal) => typeof journal.discipline?.followedTradingPlan === "boolean",
  );
  const planFollowed = planAnswered.filter(
    (journal) => journal.discipline?.followedTradingPlan === true,
  ).length;
  const riskFollowed = journals.filter(
    (journal) => journal.discipline?.followedRiskManagement === true,
  ).length;

  const planSample = planAnswered.length;
  const planAdherencePct =
    planSample > 0 ? Math.round((planFollowed / planSample) * 100) : 0;

  return {
    user,
    timeZone,
    metrics: {
      account_age_days: accountAgeDays(user.createdAt, now),
      qualifying_days: qualifyingKeys.size,
      completed_reviews: completedReviews,
      no_trade_days: noTradeDays.length,
      longest_streak: Number(user.stats?.longestJournalStreak || 0),
      current_streak: Number(user.stats?.currentJournalStreak || 0),
      trade_count: tradeCount,
      plan_answered_count: planSample,
      risk_followed_count: riskFollowed,
      plan_adherence_pct: planAdherencePct,
      plan_adherence_sample: planSample,
    },
  };
}

function evaluateDefinition(definition, metrics) {
  const threshold = Number(definition.threshold || 0);
  const metricKey = definition.metric;
  const current = Number(metrics[metricKey] || 0);

  if (definition.id === "plan_adherent_90") {
    const sample = Number(metrics.plan_adherence_sample || 0);
    const minSample = Number(definition.minSample || 20);
    const ready = sample >= minSample;
    const pct = Number(metrics.plan_adherence_pct || 0);
    return {
      current: ready ? pct : Math.min(pct, threshold - 1),
      threshold,
      sample,
      minSample,
      unlocked: ready && pct >= threshold,
      progressRatio: ready
        ? Math.min(1, pct / threshold)
        : Math.min(0.99, sample / minSample) * Math.min(1, pct / threshold),
    };
  }

  return {
    current,
    threshold,
    unlocked: current >= threshold,
    progressRatio:
      threshold > 0 ? Math.min(1, current / threshold) : current > 0 ? 1 : 0,
  };
}

async function awardAchievement(userId, achievementId, evaluation, metadata = {}) {
  const definition = getAchievementDefinition(achievementId);
  if (!definition) {
    return { awarded: false, reason: "unknown_achievement" };
  }

  try {
    const doc = await UserAchievement.create({
      user: userId,
      achievementId,
      earnedAt: new Date(),
      progressAtAward: evaluation.current,
      thresholdAtAward: evaluation.threshold,
      criteriaVersion: CRITERIA_VERSION,
      metadata,
    });
    return { awarded: true, achievement: doc };
  } catch (error) {
    // Duplicate key — already earned (idempotent).
    if (error?.code === 11000) {
      return { awarded: false, reason: "already_earned" };
    }
    throw error;
  }
}

/**
 * Evaluate all achievements for a user, persist any newly unlocked ones,
 * and return the gallery payload. Safe to call on demand.
 */
async function evaluateAndSyncAchievements(userId, options = {}) {
  const now = options.now || new Date();
  const snapshot = await computeProgressSnapshot(userId, now);

  if (!snapshot) {
    return {
      success: false,
      statusCode: 404,
      message: "User not found.",
    };
  }

  const definitions = listAchievementDefinitions();
  const existing = await UserAchievement.find({ user: userId }).lean();
  const earnedMap = new Map(
    existing.map((item) => [item.achievementId, item]),
  );

  const newlyEarned = [];

  for (const definition of definitions) {
    const evaluation = evaluateDefinition(definition, snapshot.metrics);
    if (!evaluation.unlocked) continue;
    if (earnedMap.has(definition.id)) continue;

    const result = await awardAchievement(
      userId,
      definition.id,
      evaluation,
      {
        metric: definition.metric,
        evaluatedAt: now.toISOString(),
      },
    );

    if (result.awarded && result.achievement) {
      earnedMap.set(definition.id, result.achievement.toObject?.() || result.achievement);
      newlyEarned.push(definition.id);
    }
  }

  const featured = Array.isArray(snapshot.user.profile?.featuredAchievements)
    ? snapshot.user.profile.featuredAchievements.filter((id) =>
        earnedMap.has(id),
      )
    : [];

  const items = definitions.map((definition) => {
    const evaluation = evaluateDefinition(definition, snapshot.metrics);
    const earned = earnedMap.get(definition.id) || null;
    const state = earned ? "earned" : evaluation.unlocked ? "available" : "locked";

    return {
      id: definition.id,
      category: definition.category,
      tier: definition.tier,
      title: definition.title,
      description: definition.description,
      criteriaLabel: definition.criteriaLabel,
      icon: definition.icon,
      threshold: evaluation.threshold,
      current: Math.min(evaluation.current, evaluation.threshold),
      progressRatio: evaluation.progressRatio,
      minSample: definition.minSample || null,
      sample: evaluation.sample ?? null,
      state,
      earnedAt: earned?.earnedAt || null,
      celebratedAt: earned?.celebratedAt || null,
      featured: featured.includes(definition.id),
    };
  });

  const earnedCount = items.filter((item) => item.state === "earned").length;

  return {
    success: true,
    data: {
      summary: {
        earned: earnedCount,
        total: definitions.length,
        featured,
      },
      newlyEarned: newlyEarned.map((id) => {
        const item = items.find((entry) => entry.id === id);
        return item
          ? {
              id: item.id,
              title: item.title,
              description: item.description,
              tier: item.tier,
              category: item.category,
              icon: item.icon,
              earnedAt: item.earnedAt,
            }
          : { id };
      }),
      achievements: items,
      metrics: snapshot.metrics,
    },
  };
}

async function getAchievementsService(userId) {
  return evaluateAndSyncAchievements(userId);
}

async function markAchievementsCelebratedService(userId, achievementIds) {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.filter((id) => typeof id === "string" && id.trim())
    : [];

  if (!ids.length) {
    return {
      success: false,
      statusCode: 400,
      message: "Select at least one achievement to mark as celebrated.",
    };
  }

  const result = await UserAchievement.updateMany(
    {
      user: userId,
      achievementId: { $in: ids },
      celebratedAt: null,
    },
    {
      $set: { celebratedAt: new Date() },
    },
  );

  return {
    success: true,
    data: { matched: result.matchedCount || 0, modified: result.modifiedCount || 0 },
  };
}

async function setFeaturedAchievementsService(userId, achievementIds) {
  const ids = Array.isArray(achievementIds)
    ? [...new Set(achievementIds.filter((id) => typeof id === "string" && id.trim()))]
    : [];

  if (ids.length > 3) {
    return {
      success: false,
      statusCode: 400,
      message: "You can feature up to three achievements.",
    };
  }

  for (const id of ids) {
    if (!getAchievementDefinition(id)) {
      return {
        success: false,
        statusCode: 400,
        message: "One or more achievement ids are invalid.",
      };
    }
  }

  if (ids.length) {
    const owned = await UserAchievement.find({
      user: userId,
      achievementId: { $in: ids },
    })
      .select("achievementId")
      .lean();
    if (owned.length !== ids.length) {
      return {
        success: false,
        statusCode: 400,
        message: "You can only feature achievements you have earned.",
      };
    }
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { "profile.featuredAchievements": ids } },
    { new: true, select: "profile.featuredAchievements" },
  );

  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  return {
    success: true,
    data: { featured: user.profile?.featuredAchievements || [] },
  };
}

/**
 * Lightweight hook after journaling activity. Does not throw into callers.
 */
async function syncAchievementsAfterActivity(userId) {
  try {
    const result = await evaluateAndSyncAchievements(userId);
    if (!result.success) return { newlyEarned: [] };
    return { newlyEarned: result.data?.newlyEarned || [] };
  } catch (error) {
    console.error(
      "Achievement sync failed:",
      error?.message || error,
    );
    return { newlyEarned: [] };
  }
}

export {
  accountAgeDays,
  collectQualifyingDayKeys,
  computeProgressSnapshot,
  evaluateAndSyncAchievements,
  evaluateDefinition,
  getAchievementsService,
  markAchievementsCelebratedService,
  setFeaturedAchievementsService,
  syncAchievementsAfterActivity,
  CRITERIA_VERSION,
};
