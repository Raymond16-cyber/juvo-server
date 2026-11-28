import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import User from "../models/User.js";
import Goal from "../models/Goals.js";
import TradingPlan from "../models/tradingPlan.js";

export const CHALLENGE_KEYS = [
  "fomo",
  "revenge_trading",
  "overtrading",
  "impatience",
  "poor_risk_management",
  "emotional_trading",
  "lack_of_discipline",
  "inconsistent_strategy",
  "overconfidence",
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
  overconfidence: "Keep risk consistent after wins; let your plan set the size.",
};

const CHALLENGE_OBJECTIVES = {
  fomo: "Review five FOMO observations and record what your setup required.",
  revenge_trading:
    "Review five post-loss observations before deciding how to respond.",
  overtrading: "Review five trade-frequency observations against your plan.",
  impatience: "Review five entry-timing observations against your checklist.",
  poor_risk_management: "Review five risk observations against your limits.",
  emotional_trading:
    "Review five emotion-related observations and record your response.",
  lack_of_discipline:
    "Review five plan-adherence observations and record your next action.",
  inconsistent_strategy:
    "Review five strategy-adherence observations against your playbook.",
  overconfidence:
    "Review five post-win risk observations and compare them with your plan.",
};

const CHALLENGE_TITLES = {
  fomo: "FOMO",
  revenge_trading: "Revenge trading",
  overtrading: "Overtrading",
  impatience: "Impatience",
  poor_risk_management: "Risk management",
  emotional_trading: "Emotional trading",
  lack_of_discipline: "Trading discipline",
  inconsistent_strategy: "Strategy consistency",
  overconfidence: "Euphoria / overconfidence",
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
  return entry?.status === "paused" ? "paused" : "active";
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
      current.status = "active";
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
    user.profile.biggestChallenges = [
      ...new Set(
        challenges.filter((challenge) => CHALLENGE_KEYS.includes(challenge)),
      ),
    ];
  }

  user.profile.challengeProgress = seedChallengeProgress(
    user,
    user.profile.biggestChallenges,
  );
  user.markModified("profile");
  await user.save();
  await syncChallengeGoals(userId, user.profile.biggestChallenges);
  return user;
}

export async function syncChallengeGoals(userId, challenges = []) {
  const selected = [
    ...new Set(
      challenges.filter((challenge) => CHALLENGE_KEYS.includes(challenge)),
    ),
  ];
  const now = new Date();
  const endsAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  if (selected.length) {
    await Goal.updateMany(
      {
        user: userId,
        autoManaged: true,
        behaviorChallenge: { $in: selected },
        status: "Archived",
        behaviorPausedAt: null,
      },
      { $set: { status: "Active" } },
    );
    await Promise.all(
      selected.map((challenge) =>
        Goal.updateOne(
          { user: userId, behaviorChallenge: challenge },
          {
            $setOnInsert: {
              user: userId,
              behaviorChallenge: challenge,
              autoManaged: true,
              title: `Review ${CHALLENGE_TITLES[challenge]} observations`,
              description: `${CHALLENGE_OBJECTIVES[challenge]} Progress counts behaviour observations you review and confirm or dismiss. It does not measure whether the behaviour has improved.`,
              category:
                challenge === "poor_risk_management"
                  ? "Risk Management"
                  : "Psychology",
              targetType: "Count",
              targetValue: 5,
              currentValue: 0,
              unit: "reviewed observations",
              priority: "Medium",
              status: "Active",
              startsAt: now,
              endsAt,
            },
          },
          { upsert: true },
        ).catch((error) => {
          if (error.code !== 11000) throw error;
          return null;
        }),
      ),
    );
  }

  await Goal.updateMany(
    {
      user: userId,
      autoManaged: true,
      ...(selected.length ? { behaviorChallenge: { $nin: selected } } : {}),
      status: { $in: ["Active", "Completed"] },
    },
    { $set: { status: "Archived", behaviorPausedAt: null } },
  );
}

function pushUniqueFlag(flags, suggestion) {
  const list = Array.isArray(flags) ? flags : [];
  const already = list.some(
    (flag) => flag.challenge === suggestion.challenge,
  );
  if (already) return list;
  list.push({
    challenge: suggestion.challenge,
    source: suggestion.source || "auto",
    confidence: suggestion.confidence,
    evidence: suggestion.evidence,
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
  plan = null,
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
          const minutesAfterLoss = soonAfter
            ? Number(((tradeTime - lossAt) / 60000).toFixed(1))
            : null;
          const positionSizeRatio =
            priorLot > 0 && nextLot > 0
              ? Number((nextLot / priorLot).toFixed(2))
              : null;
          suggestions.push({
            challenge: "revenge_trading",
            confidence: soonAfter && sizeSpike ? 0.85 : 0.7,
            source: "auto",
            evidence: {
              kind: "trade_sequence",
              description: soonAfter
                ? `A trade was opened ${minutesAfterLoss} minutes after a recorded loss.`
                : "Position size was at least 50% larger than the prior losing trade.",
              observedAt: new Date(tradeTime),
              metrics: { minutesAfterLoss, positionSizeRatio },
            },
          });
        }
      }
    }

    if (active.has("overtrading") && (journal || dayTrades.length)) {
      const count = Math.max(
        dayTrades.length,
        Array.isArray(journal?.trades) ? journal.trades.length : 0,
      );
      const threshold =
        plan?.maxDailyTrades != null
          ? Number(plan.maxDailyTrades)
          : OVERTRADE_THRESHOLDS[style] ||
            OVERTRADE_THRESHOLDS.day_trading;
      if (count > threshold) {
        suggestions.push({
          challenge: "overtrading",
          confidence: Math.min(0.95, 0.55 + (count - threshold) * 0.08),
          source: "auto",
          evidence: {
            kind: "trade_frequency",
            description: `${count} trades were recorded for this journal; the ${style.replaceAll("_", " ")} reference threshold is ${threshold}.`,
            observedAt: new Date(tradeTime),
            metrics: { tradeCount: count, referenceThreshold: threshold },
          },
        });
      }
    }

    if (active.has("poor_risk_management") && trade) {
      const riskNumber = Number(trade.riskPercentage);
      const riskLimit =
        plan?.maxRiskPerTrade != null
          ? Number(plan.maxRiskPerTrade)
          : RISK_SOFT_CAP;
      if (Number.isFinite(riskNumber) && riskNumber > riskLimit) {
        suggestions.push({
          challenge: "poor_risk_management",
          confidence:
            riskNumber > Math.max(riskLimit * 1.5, RISK_HARD_CAP)
              ? 0.9
              : 0.65,
          source: "auto",
          evidence: {
            kind: "trade_risk",
            description: `Recorded risk was ${riskNumber}% of account balance${plan?.maxRiskPerTrade != null ? `, above the active plan limit of ${riskLimit}%` : ""}.`,
            observedAt: new Date(tradeTime),
            metrics: {
              riskPercentage: riskNumber,
              planRiskLimit: plan?.maxRiskPerTrade ?? null,
            },
          },
        });
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
            evidence: {
              kind: "trade_timing",
              description: `Another trade was opened ${Number(((tradeTime - priorAt) / 60000).toFixed(1))} minutes after the previous recorded trade.`,
              observedAt: new Date(tradeTime),
              metrics: {
                minutesSincePreviousTrade: Number(
                  ((tradeTime - priorAt) / 60000).toFixed(1),
                ),
              },
            },
          });
        }
      }
    }

    if (active.has("overconfidence") && trade) {
      const previousClosed = sortedRecent.filter(
        (item) =>
          toId(item._id) !== toId(trade._id) &&
          ["Closed", "Breakeven"].includes(item.status),
      );
      let consecutiveWins = 0;
      for (const previous of previousClosed) {
        if (Number(previous.profitLoss || 0) <= 0) break;
        consecutiveWins += 1;
      }

      const previousRisks = previousClosed
        .map((item) => Number(item.riskPercentage))
        .filter((risk) => Number.isFinite(risk) && risk > 0)
        .sort((a, b) => a - b);
      const medianRisk = previousRisks.length
        ? previousRisks[Math.floor(previousRisks.length / 2)]
        : null;
      const currentRisk = Number(trade.riskPercentage);

      if (
        consecutiveWins >= 2 &&
        medianRisk !== null &&
        Number.isFinite(currentRisk) &&
        currentRisk > medianRisk * SIZE_SPIKE_RATIO
      ) {
        suggestions.push({
          challenge: "overconfidence",
          confidence: 0.75,
          source: "auto",
          evidence: {
            kind: "post_win_risk_change",
            description: `Risk increased to ${currentRisk}% after ${consecutiveWins} consecutive wins; recent median recorded risk was ${medianRisk}%.`,
            observedAt: new Date(tradeTime),
            metrics: {
              consecutiveWins,
              currentRiskPercentage: currentRisk,
              recentMedianRiskPercentage: medianRisk,
            },
          },
        });
      }
    }
  }

  if (event === "journal_complete" && journal) {
    const discipline = journal.discipline || {};

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
    if (active.has("fomo")) {
      const journalText = [
        journal.psychology?.beforeTrading,
        journal.psychology?.afterTrading,
        journal.review?.biggestMistake,
        journal.review?.overallThoughts,
      ]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase();
      const reportedFomo =
        /\bfomo\b|fear of missing out|afraid of missing (?:the )?move|feared missing (?:the )?move/.test(
          journalText,
        );
      if (reportedFomo) {
        suggestions.push({
          challenge: "fomo",
          confidence: 0.9,
          source: "manual",
          evidence: {
            kind: "journal_self_report",
            description:
              "The journal text explicitly mentions FOMO or fear of missing a market move.",
            observedAt: journal.journalDate || new Date(),
          },
        });
      }
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
          evidence: {
            kind: "journal_reflection",
            description:
              discipline.revengeTraded === true
                ? "The journal records revenge trading."
                : `Post-session confidence was recorded as ${confidenceAfter}/10.`,
            observedAt: journal.journalDate || new Date(),
            metrics: {
              revengeTraded: discipline.revengeTraded === true,
              confidenceAfter: Number.isFinite(confidenceAfter)
                ? confidenceAfter
                : null,
            },
          },
        });
      }
    }
    if (active.has("overconfidence")) {
      const journalText = [
        journal.psychology?.beforeTrading,
        journal.psychology?.afterTrading,
        journal.review?.biggestMistake,
        journal.review?.overallThoughts,
      ]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (/\boverconfiden(?:t|ce)\b|\beuphor(?:ia|ic)\b/.test(journalText)) {
        suggestions.push({
          challenge: "overconfidence",
          confidence: 0.9,
          source: "manual",
          evidence: {
            kind: "journal_self_report",
            description:
              "The journal text explicitly mentions euphoria or overconfidence.",
            observedAt: journal.journalDate || new Date(),
          },
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

  const active = activeChallengeSet(user);
  const [recentTrades, plan] = await Promise.all([
    Trade.find({
      user: userId,
      createdAt: { $gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    })
      .select(
        "journal status profitLoss lotSize riskPercentage openedAt closedAt createdAt",
      )
      .sort({ createdAt: -1 })
      .limit(40)
      .lean(),
    trade.tradingAccount &&
    (active.has("overtrading") ||
      active.has("poor_risk_management") ||
      active.has("overconfidence"))
      ? TradingPlan.findOne({
          userId,
          tradingAccount: trade.tradingAccount,
          status: "Active",
        })
          .select("maxDailyTrades maxRiskPerTrade")
          .lean()
      : null,
  ]);

  const suggestions = detectBehaviourFlags({
    user,
    journal,
    trade,
    recentTrades,
    plan,
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
      (flag) => flag.challenge === suggestion.challenge,
    );
    if (already) continue;

    const entry = {
      challenge: suggestion.challenge,
      source: suggestion.source || "auto",
      confidence: suggestion.confidence,
      confirmed: disciplineConfirmed ? true : null,
      dismissedAt: null,
      evidence: suggestion.evidence,
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
    evidence: flag.evidence || null,
    ...meta,
  };
}

function observationTime(flag, fallback) {
  const parsed = new Date(flag?.createdAt || fallback || 0);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function reportEvidence(row) {
  const flag = row.flag;
  const isConfirmed = flag.confirmed === true;
  const isDismissed = flag.confirmed === false || Boolean(flag.dismissedAt);
  return {
    date: row.at?.toISOString() || null,
    source:
      flag.source === "manual"
        ? "user_reported"
        : isConfirmed
          ? "confirmed_inference"
          : "inference",
    status: isConfirmed ? "confirmed" : isDismissed ? "dismissed" : "suggested",
    confidence:
      Number.isFinite(Number(flag.confidence)) ? Number(flag.confidence) : null,
    description:
      flag.evidence?.description ||
      (flag.source === "manual"
        ? "A journal reflection recorded this behaviour."
        : isConfirmed
          ? "A system-detected pattern was confirmed."
          : "A system-detected pattern is awaiting your review."),
    symbol: row.symbol || null,
    direction: row.direction || null,
    associatedOutcome:
      row.trade &&
      ["Closed", "Breakeven"].includes(row.trade.status) &&
      row.trade.profitLossCurrency
        ? {
            amount: Number(row.trade.profitLoss || 0),
            currency: row.trade.profitLossCurrency,
          }
        : null,
  };
}

export function buildBehaviourReports({
  challenges,
  tradeRows,
  journalRows,
  now = new Date(),
}) {
  const currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const previousStart = new Date(
    now.getTime() - 60 * 24 * 60 * 60 * 1000,
  );
  const rows = [];

  for (const trade of tradeRows) {
    for (const flag of trade.behaviourFlags || []) {
      const at = observationTime(flag, trade.openedAt || trade.createdAt);
      if (!at || at < previousStart) continue;
      rows.push({ flag, at, trade, symbol: trade.symbol, direction: trade.direction });
    }
  }
  for (const journal of journalRows) {
    for (const flag of journal.behaviourFlags || []) {
      const at = observationTime(flag, journal.journalDate);
      if (!at || at < previousStart) continue;
      rows.push({ flag, at, journalDate: journal.journalDate });
    }
  }

  const completedReflections = journalRows.filter(
    (journal) =>
      journal.status === "Completed" &&
      typeof journal.discipline?.followedTradingPlan === "boolean" &&
      typeof journal.discipline?.followedRiskManagement === "boolean",
  );
  const currentReflections = completedReflections.filter(
    (journal) => new Date(journal.journalDate) >= currentStart,
  );
  const previousReflections = completedReflections.filter((journal) => {
    const date = new Date(journal.journalDate);
    return date >= previousStart && date < currentStart;
  });
  const adherenceCount = (journals) =>
    journals.filter(
      (journal) =>
        journal.discipline.followedTradingPlan === true &&
        journal.discipline.followedRiskManagement === true,
    ).length;
  const currentAdherence = adherenceCount(currentReflections);
  const previousAdherence = adherenceCount(previousReflections);

  return {
    period: {
      days: 30,
      from: currentStart.toISOString(),
      to: now.toISOString(),
      comparisonFrom: previousStart.toISOString(),
      comparisonTo: currentStart.toISOString(),
    },
    dataAvailability: {
      trades: tradeRows.length,
      journals: journalRows.length,
      sufficientForComparison: tradeRows.length >= 5 || journalRows.length >= 3,
      message:
        tradeRows.length || journalRows.length
          ? null
          : "There is not enough trading or journal history yet to report behavioural patterns.",
    },
    documentedAdherence: {
      source: "completed_journal_self_report",
      currentPeriod: currentAdherence,
      comparisonPeriod: previousAdherence,
      reviewedSessions: currentReflections.length,
      trend:
        currentAdherence > previousAdherence
          ? "more_documented"
          : currentAdherence < previousAdherence
            ? "fewer_documented"
            : "unchanged",
      interpretation:
        "Counts completed journals where you reported following both your trading plan and risk management. This is self-reported process evidence, not an independent verification or performance score.",
    },
    observations: challenges.map((challenge) => {
      const challengeRows = rows
        .filter((row) => row.flag.challenge === challenge)
        .sort((a, b) => b.at - a.at);
      const current = challengeRows.filter((row) => row.at >= currentStart);
      const previous = challengeRows.filter(
        (row) => row.at >= previousStart && row.at < currentStart,
      );
      const confirmed = current.filter((row) => row.flag.confirmed === true);
      const pending = current.filter(
        (row) =>
          row.flag.confirmed == null &&
          !row.flag.dismissedAt,
      );
      const reviewed = current.filter(
        (row) => row.flag.confirmed != null || row.flag.dismissedAt,
      );
      const confidenceValues = current
        .map((row) => Number(row.flag.confidence))
        .filter((value) => Number.isFinite(value));
      const averageConfidence = confidenceValues.length
        ? Number(
            (
              confidenceValues.reduce((sum, value) => sum + value, 0) /
              confidenceValues.length
            ).toFixed(2),
          )
        : null;
      const count = (selection) =>
        selection.filter((row) => row.flag.confirmed === true).length;
      const currentCount = count(current);
      const previousCount = count(previous);

      return {
        challenge,
        attention:
          confirmed.length > 0
            ? "confirmed_observation"
            : pending.length > 0
              ? "review_suggested"
              : "no_confirmed_observation",
        occurrences: currentCount,
        suggestedOccurrences: pending.length,
        reviewedObservations: reviewed.length,
        confidence: averageConfidence,
        trend:
          currentCount > previousCount
            ? "more_recorded"
            : currentCount < previousCount
              ? "fewer_recorded"
              : "unchanged",
        comparisonOccurrences: previousCount,
        evidence: challengeRows.slice(0, 5).map(reportEvidence),
        recommendation: CHALLENGE_TIPS[challenge] || null,
        interpretation:
          "Counts describe recorded observations, not a diagnosis or proof of improvement. Fewer reports can also mean less data.",
      };
    }),
  };
}

export async function getReviewedObservationCounts(userId, challenges) {
  if (!challenges.length) return new Map();
  const match = {
    user: userId,
    "behaviourFlags.challenge": { $in: challenges },
  };
  const [tradeCounts, journalCounts] = await Promise.all([
    Trade.aggregate([
      { $match: match },
      { $unwind: "$behaviourFlags" },
      {
        $match: {
          "behaviourFlags.challenge": { $in: challenges },
          $or: [
            { "behaviourFlags.confirmed": { $ne: null } },
            { "behaviourFlags.dismissedAt": { $ne: null } },
          ],
        },
      },
      { $group: { _id: "$behaviourFlags.challenge", count: { $sum: 1 } } },
    ]),
    Journal.aggregate([
      { $match: match },
      { $unwind: "$behaviourFlags" },
      {
        $match: {
          "behaviourFlags.challenge": { $in: challenges },
          $or: [
            { "behaviourFlags.confirmed": { $ne: null } },
            { "behaviourFlags.dismissedAt": { $ne: null } },
          ],
        },
      },
      { $group: { _id: "$behaviourFlags.challenge", count: { $sum: 1 } } },
    ]),
  ]);
  const counts = new Map();
  for (const item of [...tradeCounts, ...journalCounts]) {
    counts.set(item._id, (counts.get(item._id) || 0) + item.count);
  }
  return counts;
}

export async function getBehaviourOverviewService(userId) {
  let user = await User.findById(userId).lean();
  if (!user) {
    return { success: false, statusCode: 404, message: "User not found." };
  }

  const selected = user.profile?.biggestChallenges || [];
  await syncChallengeGoals(userId, selected);
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

  const now = new Date();
  const reportStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const [trades, journals, reportTrades, reportJournals, goals] = await Promise.all([
    Trade.find({
      user: userId,
      behaviourFlags: {
        $elemMatch: { confirmed: null, dismissedAt: null },
      },
    })
      .select("symbol direction behaviourFlags journal openedAt closedAt createdAt status profitLoss profitLossCurrency")
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
    Trade.find({
      user: userId,
      $or: [
        { openedAt: { $gte: reportStart } },
        { closedAt: { $gte: reportStart } },
        { createdAt: { $gte: reportStart } },
      ],
    })
      .select("symbol direction status profitLoss profitLossCurrency openedAt closedAt createdAt behaviourFlags")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
    Journal.find({ user: userId, journalDate: { $gte: reportStart } })
      .select("journalDate behaviourFlags status discipline")
      .sort({ journalDate: -1 })
      .limit(120)
      .lean(),
    Goal.find({
      user: userId,
      autoManaged: true,
      behaviorChallenge: { $in: selected },
    })
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

  const reviewedCounts = await getReviewedObservationCounts(userId, selected);
  const behavioralGoals = goals.map((goal) => ({
    ...goal,
    currentValue: Math.min(
      Number(goal.targetValue || 0),
      reviewedCounts.get(goal.behaviorChallenge) || 0,
    ),
    progressSource: "reviewed_observations",
  }));
  const reports = buildBehaviourReports({
    challenges: selected,
    tradeRows: reportTrades,
    journalRows: reportJournals,
    now,
  });

  return {
    success: true,
    data: {
      challenges: user.profile?.biggestChallenges || [],
      progress,
      pendingFlags,
      reports,
      goals: behavioralGoals,
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
