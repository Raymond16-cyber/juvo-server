import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import User from "../models/User.js";

export const CHALLENGE_KEYS = [
  "fomo",
  "revenge_trading",
  "overtrading",
  "impatience",
  "poor_risk_management",
  "emotional_trading",
  "lack_of_discipline",
  "inconsistent_strategy",
];

export const CHALLENGE_TIPS = {
  fomo: "Wait for your checklist setup. Missing a move costs less than forcing one.",
  revenge_trading: "After a loss, take a cool-down before the next entry.",
  overtrading: "Cap daily trades. Quality setups beat volume.",
  impatience: "Let the setup come to you. Early entries erode R.",
  poor_risk_management: "Keep risk per trade within your plan (often ≤1–2%).",
  emotional_trading: "Name the feeling before you click. Journal first if needed.",
  lack_of_discipline: "Follow the written plan for the next three trades only.",
  inconsistent_strategy: "Pick one playbook for the session and stick to it.",
};

const OVERTRADE_THRESHOLDS = {
  scalping: 12,
  day_trading: 5,
  swing_trading: 3,
  position_trading: 2,
};

const REVENGE_WINDOW_MS = 30 * 60 * 1000;
const IMPATIENCE_WINDOW_MS = 10 * 60 * 1000;
const RISK_SOFT_CAP = 2;
const RISK_HARD_CAP = 3;
const SIZE_SPIKE_RATIO = 1.5;

function toId(value) {
  return value == null ? null : String(value);
}

function activeChallengeSet(user) {
  const selected = Array.isArray(user?.profile?.biggestChallenges)
    ? user.profile.biggestChallenges
    : [];
  const progress = Array.isArray(user?.profile?.challengeProgress)
    ? user.profile.challengeProgress
    : [];

  const paused = new Set(
    progress
      .filter((item) => item.status === "paused")
      .map((item) => item.challenge),
  );

  return new Set(
    selected.filter(
      (challenge) =>
        CHALLENGE_KEYS.includes(challenge) && !paused.has(challenge),
    ),
  );
}

function deriveProgressStatus(entry) {
  if (!entry || entry.status === "paused") return entry?.status || "active";
  if (entry.streakWithoutFlag >= 10 && entry.confirmedCount <= 1) {
    return "overcome";
  }
  if (entry.streakWithoutFlag >= 3 || entry.confirmedCount >= 1) {
    return "improving";
  }
  return "active";
}

export function seedChallengeProgress(user, challenges = null) {
  const selected = (
    Array.isArray(challenges)
      ? challenges
      : user?.profile?.biggestChallenges || []
  ).filter((challenge) => CHALLENGE_KEYS.includes(challenge));

  const existing = Array.isArray(user?.profile?.challengeProgress)
    ? [...user.profile.challengeProgress.map((item) =>
        typeof item.toObject === "function" ? item.toObject() : { ...item },
      )]
    : [];

  const byChallenge = new Map(
    existing.map((item) => [item.challenge, item]),
  );

  for (const challenge of selected) {
    const current = byChallenge.get(challenge);
    if (current) {
      if (current.status === "paused") current.status = "active";
      byChallenge.set(challenge, current);
    } else {
      byChallenge.set(challenge, {
        challenge,
        status: "active",
        flagCount: 0,
        confirmedCount: 0,
        lastFlaggedAt: null,
        streakWithoutFlag: 0,
      });
    }
  }

  for (const [challenge, entry] of byChallenge) {
    if (!selected.includes(challenge) && entry.status !== "paused") {
      entry.status = "paused";
    }
  }

  return Array.from(byChallenge.values());
}

export async function persistChallengeProgress(userId, challenges) {
  const user = await User.findById(userId);
  if (!user) return null;

  user.profile = user.profile || {};
  if (Array.isArray(challenges)) {
    user.profile.biggestChallenges = challenges.filter((challenge) =>
      CHALLENGE_KEYS.includes(challenge),
    );
  }

  user.profile.challengeProgress = seedChallengeProgress(
    user,
    user.profile.biggestChallenges,
  );
  user.markModified("profile");
  await user.save();
  return user;
}

function pushUniqueFlag(flags, suggestion) {
  const list = Array.isArray(flags) ? flags : [];
  const already = list.some(
    (flag) =>
      flag.challenge === suggestion.challenge &&
      flag.confirmed == null &&
      !flag.dismissedAt,
  );
  if (already) return list;
  list.push({
    challenge: suggestion.challenge,
    source: suggestion.source || "auto",
    confidence: suggestion.confidence,
    confirmed: null,
    dismissedAt: null,
    createdAt: new Date(),
  });
  return list;
}

export function detectBehaviourFlags({
  user,
  journal,
  trade,
  recentTrades = [],
  event = "trade_open",
} = {}) {
  const active = activeChallengeSet(user);
  if (!active.size) return [];

  const suggestions = [];
  const style = user?.profile?.tradingStyle || "day_trading";
  const dayTrades = recentTrades.filter(
    (item) => toId(item.journal) === toId(journal?._id || journal),
  );
  const sortedRecent = [...recentTrades].sort((a, b) => {
    const aTime = new Date(a.closedAt || a.openedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.closedAt || b.openedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  const tradeTime = new Date(
    trade?.openedAt || trade?.createdAt || Date.now(),
  ).getTime();

  if (event === "trade_open" || event === "trade_close") {
    if (active.has("revenge_trading") && trade) {
      const priorLoss = sortedRecent.find((item) => {
        if (toId(item._id) === toId(trade._id)) return false;
        if (!["Closed", "Breakeven"].includes(item.status)) return false;
        return Number(item.profitLoss || 0) < 0;
      });

      if (priorLoss) {
        const lossAt = new Date(
          priorLoss.closedAt || priorLoss.updatedAt || 0,
        ).getTime();
        const soonAfter =
          Number.isFinite(lossAt) &&
          tradeTime - lossAt >= 0 &&
          tradeTime - lossAt <= REVENGE_WINDOW_MS;
        const priorLot = Number(priorLoss.lotSize || 0);
        const nextLot = Number(trade.lotSize || 0);
        const sizeSpike =
          priorLot > 0 && nextLot >= priorLot * SIZE_SPIKE_RATIO;

        if (soonAfter || sizeSpike) {
          suggestions.push({
            challenge: "revenge_trading",
            confidence: soonAfter && sizeSpike ? 0.85 : 0.7,
            source: "auto",
          });
        }
      }
    }

    if (active.has("overtrading") && (journal || dayTrades.length)) {
      const count = Math.max(
        dayTrades.length,
        Array.isArray(journal?.trades) ? journal.trades.length : 0,
      );
      const threshold = OVERTRADE_THRESHOLDS[style] || OVERTRADE_THRESHOLDS.day_trading;
      if (count > threshold) {
        suggestions.push({
          challenge: "overtrading",
          confidence: Math.min(0.95, 0.55 + (count - threshold) * 0.08),
          source: "auto",
        });
      }
    }

    if (active.has("poor_risk_management") && trade) {
      const risk = trade.riskPercentage;
      if (risk == null || risk === "" || !Number.isFinite(Number(risk))) {
        suggestions.push({
          challenge: "poor_risk_management",
          confidence: 0.75,
          source: "auto",
        });
      } else {
        const riskNumber = Number(risk);
        if (riskNumber > RISK_HARD_CAP) {
          suggestions.push({
            challenge: "poor_risk_management",
            confidence: 0.9,
            source: "auto",
          });
        } else if (riskNumber > RISK_SOFT_CAP) {
          suggestions.push({
            challenge: "poor_risk_management",
            confidence: 0.65,
            source: "auto",
          });
        }
      }
    }

    if (active.has("impatience") && trade) {
      const prior = sortedRecent.find(
        (item) => toId(item._id) !== toId(trade._id),
      );
      if (prior) {
        const priorAt = new Date(
          prior.closedAt || prior.openedAt || prior.createdAt || 0,
        ).getTime();
        if (
          Number.isFinite(priorAt) &&
          tradeTime - priorAt >= 0 &&
          tradeTime - priorAt <= IMPATIENCE_WINDOW_MS
        ) {
          suggestions.push({
            challenge: "impatience",
            confidence: 0.45,
            source: "auto",
          });
        }
      }
    }

    if (active.has("fomo") && trade && dayTrades.length >= 3) {
      const recentWindow = dayTrades.filter((item) => {
        const opened = new Date(
          item.openedAt || item.createdAt || 0,
        ).getTime();
        return tradeTime - opened <= 60 * 60 * 1000;
      });
      if (recentWindow.length >= 3) {
        suggestions.push({
          challenge: "fomo",
          confidence: 0.4,
          source: "auto",
        });
      }
    }
  }

  if (event === "journal_complete" && journal?.discipline) {
    const discipline = journal.discipline;

    if (active.has("revenge_trading") && discipline.revengeTraded === true) {
      suggestions.push({
        challenge: "revenge_trading",
        confidence: 0.9,
        source: "manual",
      });
    }
    if (active.has("overtrading") && discipline.overTraded === true) {
      suggestions.push({
        challenge: "overtrading",
        confidence: 0.9,
        source: "manual",
      });
    }
    if (
      active.has("poor_risk_management") &&
      discipline.followedRiskManagement === false
    ) {
      suggestions.push({
        challenge: "poor_risk_management",
        confidence: 0.8,
        source: "manual",
      });
    }
    if (
      active.has("lack_of_discipline") &&
      (discipline.followedTradingPlan === false ||
        discipline.respectedStopLoss === false)
    ) {
      suggestions.push({
        challenge: "lack_of_discipline",
        confidence: 0.75,
        source: "manual",
      });
    }
    if (
      active.has("inconsistent_strategy") &&
      discipline.followedTradingPlan === false
    ) {
      suggestions.push({
        challenge: "inconsistent_strategy",
        confidence: 0.55,
        source: "manual",
      });
    }
    if (active.has("emotional_trading")) {
      const confidenceAfter = Number(
        journal.psychology?.confidenceAfter ??
          discipline.confidenceAfter ??
          NaN,
      );
      if (
        discipline.revengeTraded === true ||
        (Number.isFinite(confidenceAfter) && confidenceAfter <= 4)
      ) {
        suggestions.push({
          challenge: "emotional_trading",
          confidence: 0.5,
          source: "auto",
        });
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const suggestion of suggestions) {
    if (!active.has(suggestion.challenge) || seen.has(suggestion.challenge)) {
      continue;
    }
    seen.add(suggestion.challenge);
    deduped.push(suggestion);
  }
  return deduped;
}

async function bumpProgressForFlags(userId, challenges) {
  if (!challenges.length) return;
  const user = await User.findById(userId);
  if (!user) return;

  const progress = seedChallengeProgress(user);
  const now = new Date();
  for (const challenge of challenges) {
    const entry = progress.find((item) => item.challenge === challenge);
    if (!entry || entry.status === "paused") continue;
    entry.flagCount = Number(entry.flagCount || 0) + 1;
    entry.lastFlaggedAt = now;
    entry.streakWithoutFlag = 0;
    entry.status = deriveProgressStatus(entry);
  }

  user.profile.challengeProgress = progress;
  user.markModified("profile");
  await user.save();
}

export async function applyTradeBehaviourFlags({
  userId,
  journal,
  trade,
  event = "trade_open",
}) {
  const user = await User.findById(userId).lean();
  if (!user || !trade?._id) return trade;

  const recentTrades = await Trade.find({
    user: userId,
    createdAt: { $gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
  })
    .select(
      "journal status profitLoss lotSize riskPercentage openedAt closedAt createdAt",
    )
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();

  const suggestions = detectBehaviourFlags({
    user,
    journal,
    trade,
    recentTrades,
    event,
  });

  if (!suggestions.length) return trade;

  let flags = Array.isArray(trade.behaviourFlags)
    ? [...trade.behaviourFlags]
    : [];
  const added = [];
  for (const suggestion of suggestions) {
    const before = flags.length;
    flags = pushUniqueFlag(flags, suggestion);
    if (flags.length > before) added.push(suggestion.challenge);
  }

  if (!added.length) return trade;

  const updated = await Trade.findOneAndUpdate(
    { _id: trade._id, user: userId },
    { $set: { behaviourFlags: flags } },
    { new: true },
  );

  await bumpProgressForFlags(userId, added);
  return updated || trade;
}

export async function applyJournalBehaviourFlags({ userId, journal }) {
  const user = await User.findById(userId).lean();
  if (!user || !journal?._id) return journal;

  const suggestions = detectBehaviourFlags({
    user,
    journal,
    event: "journal_complete",
  });
  if (!suggestions.length) {
    await recordCleanChallengeStreaks(userId, journal);
    return journal;
  }

  let flags = Array.isArray(journal.behaviourFlags)
    ? [...(typeof journal.toObject === "function"
        ? journal.toObject().behaviourFlags
        : journal.behaviourFlags)]
    : [];
  const added = [];
  const autoConfirmed = [];

  for (const suggestion of suggestions) {
    const disciplineConfirmed =
      suggestion.source === "manual" &&
      ["revenge_trading", "overtrading", "poor_risk_management"].includes(
        suggestion.challenge,
      );

    const already = flags.some(
      (flag) =>
        flag.challenge === suggestion.challenge &&
        flag.confirmed == null &&
        !flag.dismissedAt,
    );
    if (already) continue;

    const entry = {
      challenge: suggestion.challenge,
      source: suggestion.source || "auto",
      confidence: suggestion.confidence,
      confirmed: disciplineConfirmed ? true : null,
      dismissedAt: null,
      createdAt: new Date(),
    };
    flags.push(entry);
    added.push(suggestion.challenge);
    if (disciplineConfirmed) autoConfirmed.push(suggestion.challenge);
  }

  if (!added.length) {
    await recordCleanChallengeStreaks(userId, journal);
    return journal;
  }

  const updated = await Journal.findOneAndUpdate(
    { _id: journal._id, user: userId },
    { $set: { behaviourFlags: flags } },
    { new: true },
  );
  await bumpProgressForFlags(userId, added);
  for (const challenge of autoConfirmed) {
    await updateProgressOnConfirm(userId, challenge);
  }
  await recordCleanChallengeStreaks(userId, updated || journal);
  return updated || journal;
}

export async function recordCleanChallengeStreaks(userId, journal) {
  const user = await User.findById(userId);
  if (!user) return null;

  const progress = seedChallengeProgress(user);
  const flagged = new Set();
  const journalDoc =
    journal && typeof journal.toObject === "function"
      ? journal.toObject()
      : journal || {};

  for (const flag of journalDoc.behaviourFlags || []) {
    if (flag.confirmed === true || (flag.confirmed == null && !flag.dismissedAt)) {
      flagged.add(flag.challenge);
    }
  }

  const tradeIds = (journalDoc.trades || [])
    .map((item) => item?._id || item)
    .filter(Boolean);
  if (tradeIds.length) {
    const trades = await Trade.find({
      _id: { $in: tradeIds },
      user: userId,
    })
      .select("behaviourFlags")
      .lean();
    for (const trade of trades) {
      for (const flag of trade.behaviourFlags || []) {
        if (
          flag.confirmed === true ||
          (flag.confirmed == null && !flag.dismissedAt)
        ) {
          flagged.add(flag.challenge);
        }
      }
    }
  }

  for (const entry of progress) {
    if (entry.status === "paused") continue;
    if (!flagged.has(entry.challenge)) {
      entry.streakWithoutFlag = Number(entry.streakWithoutFlag || 0) + 1;
      entry.status = deriveProgressStatus(entry);
    }
  }

  user.profile.challengeProgress = progress;
  user.markModified("profile");
  await user.save();
  return user;
}

async function findFlagDocument(userId, { tradeId, journalId, flagId }) {
  if (tradeId) {
    const trade = await Trade.findOne({ _id: tradeId, user: userId });
    if (!trade) return { error: "Trade not found.", statusCode: 404 };
    const flag = trade.behaviourFlags?.id?.(flagId) ||
      trade.behaviourFlags?.find((item) => toId(item._id) === toId(flagId));
    if (!flag) return { error: "Flag not found.", statusCode: 404 };
    return { parent: trade, flag, kind: "trade" };
  }

  if (journalId) {
    const journal = await Journal.findOne({ _id: journalId, user: userId });
    if (!journal) return { error: "Journal not found.", statusCode: 404 };
    const flag = journal.behaviourFlags?.id?.(flagId) ||
      journal.behaviourFlags?.find((item) => toId(item._id) === toId(flagId));
    if (!flag) return { error: "Flag not found.", statusCode: 404 };
    return { parent: journal, flag, kind: "journal" };
  }

  return { error: "tradeId or journalId is required.", statusCode: 400 };
}

async function updateProgressOnConfirm(userId, challenge) {
  const user = await User.findById(userId);
  if (!user) return;
  const progress = seedChallengeProgress(user);
  const entry = progress.find((item) => item.challenge === challenge);
  if (!entry || entry.status === "paused") {
    user.profile.challengeProgress = progress;
    user.markModified("profile");
    await user.save();
    return;
  }
  entry.confirmedCount = Number(entry.confirmedCount || 0) + 1;
  entry.streakWithoutFlag = 0;
  entry.status = deriveProgressStatus(entry);
  user.profile.challengeProgress = progress;
  user.markModified("profile");
  await user.save();
}

export async function confirmBehaviourFlag(userId, payload = {}) {
  const flagId = payload.flagId;
  if (!flagId) {
    return { success: false, statusCode: 400, message: "flagId is required." };
  }

  const found = await findFlagDocument(userId, payload);
  if (found.error) {
    return { success: false, statusCode: found.statusCode, message: found.error };
  }

  const { parent, flag } = found;
  if (flag.confirmed === true) {
    return { success: true, data: { parent, flag } };
  }
  if (flag.dismissedAt || flag.confirmed === false) {
    return {
      success: false,
      statusCode: 409,
      message: "This flag was already dismissed.",
    };
  }

  flag.confirmed = true;
  flag.dismissedAt = null;
  await parent.save();
  await updateProgressOnConfirm(userId, flag.challenge);

  return { success: true, data: { parent, flag } };
}

export async function dismissBehaviourFlag(userId, payload = {}) {
  const flagId = payload.flagId;
  if (!flagId) {
    return { success: false, statusCode: 400, message: "flagId is required." };
  }

  const found = await findFlagDocument(userId, payload);
  if (found.error) {
    return { success: false, statusCode: found.statusCode, message: found.error };
  }

  const { parent, flag } = found;
  if (flag.confirmed === false || flag.dismissedAt) {
    return { success: true, data: { parent, flag } };
  }
  if (flag.confirmed === true) {
    return {
      success: false,
      statusCode: 409,
      message: "This flag was already confirmed.",
    };
  }

  flag.confirmed = false;
  flag.dismissedAt = new Date();
  await parent.save();

  return { success: true, data: { parent, flag } };
}

function serializeFlag(flag, meta = {}) {
  return {
    id: toId(flag._id),
    challenge: flag.challenge,
    source: flag.source,
    confidence: flag.confidence,
    confirmed: flag.confirmed,
    dismissedAt: flag.dismissedAt || null,
    createdAt: flag.createdAt,
    tip: CHALLENGE_TIPS[flag.challenge] || null,
    ...meta,
  };
}

export async function getBehaviourOverviewService(userId) {
  let user = await User.findById(userId).lean();
  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  const selected = user.profile?.biggestChallenges || [];
  const existingProgress = user.profile?.challengeProgress || [];
  if (selected.length && !existingProgress.length) {
    user = (await persistChallengeProgress(userId, selected))?.toJSON?.() ||
      (await User.findById(userId).lean());
  }

  const progress = seedChallengeProgress(user).map((entry) => ({
    challenge: entry.challenge,
    status: entry.status,
    flagCount: entry.flagCount || 0,
    confirmedCount: entry.confirmedCount || 0,
    lastFlaggedAt: entry.lastFlaggedAt || null,
    streakWithoutFlag: entry.streakWithoutFlag || 0,
    tip: CHALLENGE_TIPS[entry.challenge] || null,
  }));

  const [trades, journals] = await Promise.all([
    Trade.find({
      user: userId,
      behaviourFlags: {
        $elemMatch: { confirmed: null, dismissedAt: null },
      },
    })
      .select("symbol direction behaviourFlags journal openedAt createdAt")
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    Journal.find({
      user: userId,
      behaviourFlags: {
        $elemMatch: { confirmed: null, dismissedAt: null },
      },
    })
      .select("journalDate behaviourFlags status")
      .sort({ journalDate: -1 })
      .limit(20)
      .lean(),
  ]);

  const pendingFlags = [];
  for (const trade of trades) {
    for (const flag of trade.behaviourFlags || []) {
      if (flag.confirmed != null || flag.dismissedAt) continue;
      pendingFlags.push(
        serializeFlag(flag, {
          tradeId: toId(trade._id),
          journalId: toId(trade.journal),
          symbol: trade.symbol,
          direction: trade.direction,
          scope: "trade",
        }),
      );
    }
  }
  for (const journal of journals) {
    for (const flag of journal.behaviourFlags || []) {
      if (flag.confirmed != null || flag.dismissedAt) continue;
      pendingFlags.push(
        serializeFlag(flag, {
          journalId: toId(journal._id),
          journalDate: journal.journalDate,
          scope: "journal",
        }),
      );
    }
  }

  pendingFlags.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );

  return {
    success: true,
    data: {
      challenges: user.profile?.biggestChallenges || [],
      progress,
      pendingFlags,
    },
  };
}

export function runBehaviourDetectionSafe(task) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(
        "Behaviour detection failed:",
        error?.message || error,
      );
    });
}
