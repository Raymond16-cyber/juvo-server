import { createHash } from "node:crypto";
import mongoose from "mongoose";
import AiCache from "../models/AiCache.js";
import Goal from "../models/Goals.js";
import Journal from "../models/Journal.js";
import NoTradeDay from "../models/NoTradeDay.js";
import Trade from "../models/Trades.js";
import TradingPlan from "../models/tradingPlan.js";
import User from "../models/User.js";
import {
  JUVO_CHECKIN_INSTRUCTIONS,
  JUVO_EXPLAIN_METRIC_INSTRUCTIONS,
  JUVO_GOAL_COACH_INSTRUCTIONS,
  JUVO_JOURNAL_INTERVIEWER_INSTRUCTIONS,
  JUVO_PERIOD_REVIEW_INSTRUCTIONS,
  JUVO_PLAN_COMPLIANCE_INSTRUCTIONS,
} from "../prompts/aiPrompts.js";
import { sanitizeModelIdentity } from "../utils/sanitizeModelIdentity.js";
import { getAnalyticsService } from "./analytics.service.js";
import {
  completeWithGemini,
  parseJsonText,
} from "./ai.service.js";
import {
  assertWithinQuota,
  incrementUsage,
} from "./aiUsage.service.js";
import { ENTITLEMENTS } from "./entitlement.service.js";

function stableHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function interviewerSourcePayload({
  journal,
  trade,
  noTradeDay,
  entrySnapshot,
}) {
  if (entrySnapshot && typeof entrySnapshot === "object") {
    return { kind: "snapshot", entrySnapshot };
  }
  if (noTradeDay) {
    return {
      kind: "no_trade_day",
      localDayKey: noTradeDay.localDayKey,
      reason: noTradeDay.reason || null,
      reflection: noTradeDay.reflection || "",
    };
  }
  if (journal) {
    return {
      kind: "journal",
      date: journal.journalDate,
      status: journal.status,
      psychology: journal.psychology || {},
      review: journal.review || {},
      discipline: journal.discipline || {},
      trade: trade
        ? {
            symbol: trade.symbol,
            direction: trade.direction,
            status: trade.status,
            notes: trade.notes || "",
            session: trade.session || null,
            plannedRR: trade.plannedRR,
            achievedRR: trade.achievedRR,
            riskPercentage: trade.riskPercentage,
          }
        : null,
      tradeCount: Array.isArray(journal.trades) ? journal.trades.length : 0,
    };
  }
  return null;
}

function normalizeQuestions(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => sanitizeModelIdentity(String(item || "").trim()))
    .filter(Boolean)
    .slice(0, 2);
}

async function generateJournalInterviewer({
  userId,
  journalId,
  tradeId,
  noTradeDayId,
  entrySnapshot,
  forceRefresh = false,
  plan,
  trialActive,
}) {
  const quota = await assertWithinQuota(
    userId,
    ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER,
    { plan, trialActive },
  );
  if (!quota.success) return quota;

  let journal = null;
  let trade = null;
  let noTradeDay = null;

  if (noTradeDayId) {
    if (!mongoose.Types.ObjectId.isValid(noTradeDayId)) {
      return { success: false, statusCode: 400, message: "Invalid no-trade day." };
    }
    noTradeDay = await NoTradeDay.findOne({ _id: noTradeDayId, user: userId });
    if (!noTradeDay) {
      return { success: false, statusCode: 404, message: "No-trade day not found." };
    }
  } else if (journalId) {
    if (!mongoose.Types.ObjectId.isValid(journalId)) {
      return { success: false, statusCode: 400, message: "Invalid journal." };
    }
    journal = await Journal.findOne({ _id: journalId, user: userId }).populate(
      "trades",
      "symbol direction status notes session plannedRR achievedRR riskPercentage",
    );
    if (!journal) {
      return { success: false, statusCode: 404, message: "Journal not found." };
    }
    if (tradeId) {
      trade =
        (journal.trades || []).find((item) => String(item._id) === String(tradeId)) ||
        null;
      if (!trade && mongoose.Types.ObjectId.isValid(tradeId)) {
        trade = await Trade.findOne({
          _id: tradeId,
          user: userId,
          journal: journal._id,
        });
      }
    }
  } else if (!entrySnapshot) {
    return {
      success: false,
      statusCode: 400,
      message: "Provide a journal, no-trade day, or entry snapshot.",
    };
  }

  const source = interviewerSourcePayload({
    journal: journal?.toObject?.() || journal,
    trade: trade?.toObject?.() || trade,
    noTradeDay: noTradeDay?.toObject?.() || noTradeDay,
    entrySnapshot,
  });
  if (!source) {
    return {
      success: false,
      statusCode: 400,
      message: "Nothing to interview yet.",
    };
  }

  const contentHash = stableHash(source);
  const existing = noTradeDay?.ai?.interviewer || journal?.ai?.interviewer;
  if (
    !forceRefresh &&
    existing?.contentHash === contentHash &&
    Array.isArray(existing?.questions) &&
    existing.questions.length
  ) {
    return {
      success: true,
      data: {
        questions: existing.questions,
        contentHash,
        generatedAt: existing.generatedAt,
        cached: true,
      },
      usage: quota.usage,
    };
  }

  const result = await completeWithGemini([
    { role: "system", content: JUVO_JOURNAL_INTERVIEWER_INSTRUCTIONS },
    { role: "user", content: JSON.stringify(source) },
  ]);
  if (!result.success) return result;

  const parsed = parseJsonText(result.text) || {};
  const questions = normalizeQuestions(parsed.questions);
  if (!questions.length) {
    return {
      success: false,
      statusCode: 502,
      message: "Juvo AI returned an empty interview.",
    };
  }

  const generatedAt = new Date();
  const cachePayload = { questions, contentHash, generatedAt };

  if (noTradeDay) {
    noTradeDay.ai = noTradeDay.ai || {};
    noTradeDay.ai.interviewer = cachePayload;
    await noTradeDay.save();
  } else if (journal) {
    journal.ai = journal.ai || {};
    journal.ai.interviewer = cachePayload;
    await journal.save();
  }

  const usage = await incrementUsage(
    userId,
    ENTITLEMENTS.SMART_JOURNAL_INTERVIEWER,
  );

  return {
    success: true,
    data: { ...cachePayload, cached: false },
    usage: { ...quota.usage, used: usage.used },
  };
}

function classifyPlanCheck({ ok, evidence, label }) {
  if (ok === true) return { status: "followed", evidence, label };
  if (ok === false) return { status: "violated", evidence, label };
  return { status: "unknown", evidence, label };
}

function buildPlanComplianceChecks({ plan, trades, journal }) {
  const checks = [];
  const closed = (trades || []).filter(
    (trade) => trade.status === "Closed" || trade.status === "Breakeven",
  );

  if (plan?.maxRiskPerTrade != null) {
    const offenders = closed.filter(
      (trade) =>
        Number.isFinite(trade.riskPercentage) &&
        trade.riskPercentage > plan.maxRiskPerTrade,
    );
    checks.push(
      classifyPlanCheck({
        label: "max_risk_per_trade",
        ok: closed.some((t) => Number.isFinite(t.riskPercentage))
          ? offenders.length === 0
          : null,
        evidence:
          offenders.length > 0
            ? `${offenders.length} trade(s) exceeded ${plan.maxRiskPerTrade}% risk.`
            : closed.some((t) => Number.isFinite(t.riskPercentage))
              ? `All sized trades stayed at or under ${plan.maxRiskPerTrade}% risk.`
              : "Risk percentage was not logged on trades.",
      }),
    );
  } else {
    checks.push(
      classifyPlanCheck({
        label: "max_risk_per_trade",
        ok: null,
        evidence: "No max risk per trade on the linked plan.",
      }),
    );
  }

  if (plan?.minimumRR != null) {
    const withRr = closed.filter((trade) => Number.isFinite(trade.plannedRR));
    const offenders = withRr.filter((trade) => trade.plannedRR < plan.minimumRR);
    checks.push(
      classifyPlanCheck({
        label: "minimum_rr",
        ok: withRr.length ? offenders.length === 0 : null,
        evidence: withRr.length
          ? offenders.length
            ? `${offenders.length} trade(s) planned below ${plan.minimumRR}R.`
            : `Planned R multiples met the ${plan.minimumRR}R floor.`
          : "Planned RR was not logged.",
      }),
    );
  }

  if (plan?.maxDailyTrades != null) {
    checks.push(
      classifyPlanCheck({
        label: "max_daily_trades",
        ok: trades.length <= plan.maxDailyTrades,
        evidence: `${trades.length} trade(s) vs max ${plan.maxDailyTrades}/day.`,
      }),
    );
  }

  if (plan?.allowedSessions?.length) {
    const withSession = closed.filter((trade) => trade.session);
    const offenders = withSession.filter(
      (trade) => !plan.allowedSessions.includes(trade.session),
    );
    checks.push(
      classifyPlanCheck({
        label: "allowed_sessions",
        ok: withSession.length ? offenders.length === 0 : null,
        evidence: withSession.length
          ? offenders.length
            ? `${offenders.length} trade(s) outside allowed sessions.`
            : "Trades stayed inside allowed sessions."
          : "Session tags were missing on trades.",
      }),
    );
  }

  const discipline = journal?.discipline || {};
  checks.push(
    classifyPlanCheck({
      label: "followed_trading_plan",
      ok:
        typeof discipline.followedTradingPlan === "boolean"
          ? discipline.followedTradingPlan
          : null,
      evidence:
        typeof discipline.followedTradingPlan === "boolean"
          ? discipline.followedTradingPlan
            ? "Trader marked the trading plan as followed."
            : "Trader marked the trading plan as not followed."
          : "Trader did not mark plan adherence.",
    }),
  );
  checks.push(
    classifyPlanCheck({
      label: "followed_risk_management",
      ok:
        typeof discipline.followedRiskManagement === "boolean"
          ? discipline.followedRiskManagement
          : null,
      evidence:
        typeof discipline.followedRiskManagement === "boolean"
          ? discipline.followedRiskManagement
            ? "Trader marked risk management as followed."
            : "Trader marked risk management as broken."
          : "Risk management flag was not set.",
    }),
  );
  checks.push(
    classifyPlanCheck({
      label: "revenge_trading",
      ok:
        typeof discipline.revengeTraded === "boolean"
          ? !discipline.revengeTraded
          : null,
      evidence:
        typeof discipline.revengeTraded === "boolean"
          ? discipline.revengeTraded
            ? "Revenge trading was flagged."
            : "No revenge-trading flag."
          : "Revenge-trading flag was not set.",
    }),
  );

  const followed = checks.filter((item) => item.status === "followed");
  const violated = checks.filter((item) => item.status === "violated");
  const unknown = checks.filter((item) => item.status === "unknown");

  return {
    checks,
    counts: {
      followed: followed.length,
      violated: violated.length,
      unknown: unknown.length,
      total: checks.length,
    },
    followed,
    violated,
    unknown,
  };
}

async function generatePlanCompliance({
  userId,
  journalId,
  tradeId,
  plan,
  trialActive,
}) {
  const quota = await assertWithinQuota(
    userId,
    ENTITLEMENTS.PLAN_COMPLIANCE_CHECK,
    { plan, trialActive },
  );
  if (!quota.success) return quota;

  if (!mongoose.Types.ObjectId.isValid(journalId)) {
    return { success: false, statusCode: 400, message: "Invalid journal." };
  }

  const journal = await Journal.findOne({ _id: journalId, user: userId })
    .populate(
      "trades",
      "symbol direction status session riskPercentage plannedRR achievedRR notes",
    )
    .populate("tradingPlan");

  if (!journal) {
    return { success: false, statusCode: 404, message: "Journal not found." };
  }

  let trades = journal.trades || [];
  if (tradeId) {
    trades = trades.filter((trade) => String(trade._id) === String(tradeId));
    if (!trades.length) {
      return { success: false, statusCode: 404, message: "Trade not found on journal." };
    }
  }

  let linkedPlan = journal.tradingPlan;
  if (!linkedPlan && journal.tradingPlan) {
    linkedPlan = await TradingPlan.findById(journal.tradingPlan);
  }
  if (!linkedPlan && journal.tradingAccount) {
    linkedPlan = await TradingPlan.findOne({
      userId,
      tradingAccount: journal.tradingAccount,
    }).sort({ validFrom: -1 });
  }

  const compliance = buildPlanComplianceChecks({
    plan: linkedPlan,
    trades,
    journal,
  });

  const result = await completeWithGemini([
    { role: "system", content: JUVO_PLAN_COMPLIANCE_INSTRUCTIONS },
    {
      role: "user",
      content: JSON.stringify({
        counts: compliance.counts,
        followed: compliance.followed,
        violated: compliance.violated,
        unknown: compliance.unknown,
      }),
    },
  ]);
  if (!result.success) return result;

  const parsed = parseJsonText(result.text) || {};
  const usage = await incrementUsage(
    userId,
    ENTITLEMENTS.PLAN_COMPLIANCE_CHECK,
  );

  return {
    success: true,
    data: {
      counts: compliance.counts,
      followed: compliance.followed,
      violated: compliance.violated,
      unknown: compliance.unknown,
      interpretation: sanitizeModelIdentity(
        String(parsed.interpretation || result.text).trim(),
      ),
      question: sanitizeModelIdentity(String(parsed.question || "").trim()),
    },
    usage: { ...quota.usage, used: usage.used },
  };
}

function startOfWeek(date, weekStartsOn = "monday") {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const startOffset = weekStartsOn === "sunday" ? 0 : 1;
  const diff = (day - startOffset + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function endOfDayUtc(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

function periodBounds(period, anchorDate, weekStartsOn = "monday") {
  const anchor = anchorDate ? new Date(anchorDate) : new Date();
  if (period === "month") {
    const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const to = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 23, 59, 59, 999),
    );
    return {
      from,
      to,
      label: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`,
    };
  }
  const from = startOfWeek(anchor, weekStartsOn);
  const to = endOfDayUtc(new Date(from.getTime() + 6 * 24 * 60 * 60 * 1000));
  return {
    from,
    to,
    label: from.toISOString().slice(0, 10),
  };
}

function filterEquityCurve(curve = [], from, to) {
  return curve.filter((point) => {
    const date = new Date(point.date);
    return date >= from && date <= to;
  });
}

async function generatePeriodReview({
  userId,
  period = "week",
  anchorDate,
  forceRefresh = false,
  plan,
  trialActive,
}) {
  const quota = await assertWithinQuota(userId, ENTITLEMENTS.AI_PERIOD_REVIEW, {
    plan,
    trialActive,
  });
  if (!quota.success) return quota;

  if (!["week", "month"].includes(period)) {
    return { success: false, statusCode: 400, message: "period must be week or month." };
  }

  const user = await User.findById(userId).select("preferences").lean();
  const bounds = periodBounds(
    period,
    anchorDate,
    user?.preferences?.weekStartsOn || "monday",
  );
  const analytics = await getAnalyticsService(userId);
  if (!analytics?.success) {
    return {
      success: false,
      statusCode: 502,
      message: "Unable to load analytics for this review.",
    };
  }

  const curve = filterEquityCurve(analytics.data.equityCurve, bounds.from, bounds.to);
  const periodPnl = curve.reduce((sum, point) => sum + Number(point.pnl || 0), 0);
  const periodTrades = curve.reduce((sum, point) => sum + Number(point.trades || 0), 0);
  const stats = {
    period,
    label: bounds.label,
    from: bounds.from.toISOString(),
    to: bounds.to.toISOString(),
    periodPnl,
    periodTrades,
    journalDays: curve.length,
    summary: analytics.data.summary,
  };
  const dataVersion = stableHash({
    periodPnl,
    periodTrades,
    journalDays: curve.length,
    summary: {
      netPnl: analytics.data.summary?.netPnl,
      winRate: analytics.data.summary?.winRate,
      avgDiscipline: analytics.data.summary?.avgDiscipline,
      revengeDays: analytics.data.summary?.revengeDays,
      overtradeDays: analytics.data.summary?.overtradeDays,
    },
  });
  const cacheKey = `${period}:${bounds.label}`;

  if (!forceRefresh) {
    const cached = await AiCache.findOne({
      user: userId,
      feature: ENTITLEMENTS.AI_PERIOD_REVIEW,
      cacheKey,
      contentHash: dataVersion,
    }).lean();
    if (cached?.payload) {
      return {
        success: true,
        data: { ...cached.payload, cached: true },
        usage: quota.usage,
      };
    }
  }

  const result = await completeWithGemini([
    { role: "system", content: JUVO_PERIOD_REVIEW_INSTRUCTIONS },
    { role: "user", content: JSON.stringify(stats) },
  ]);
  if (!result.success) return result;

  const parsed = parseJsonText(result.text) || {};
  const payload = {
    period,
    label: bounds.label,
    from: bounds.from.toISOString(),
    to: bounds.to.toISOString(),
    stats: {
      periodPnl,
      periodTrades,
      journalDays: curve.length,
      winRate: analytics.data.summary?.winRate,
      avgDiscipline: analytics.data.summary?.avgDiscipline,
    },
    headline: sanitizeModelIdentity(String(parsed.headline || "").trim()),
    narrative: sanitizeModelIdentity(
      String(parsed.narrative || result.text).trim(),
    ),
    wins: Array.isArray(parsed.wins)
      ? parsed.wins.map((item) => sanitizeModelIdentity(String(item)))
      : [],
    leaks: Array.isArray(parsed.leaks)
      ? parsed.leaks.map((item) => sanitizeModelIdentity(String(item)))
      : [],
    nextFocus: sanitizeModelIdentity(String(parsed.nextFocus || "").trim()),
    dataVersion,
  };

  await AiCache.findOneAndUpdate(
    {
      user: userId,
      feature: ENTITLEMENTS.AI_PERIOD_REVIEW,
      cacheKey,
    },
    {
      $set: {
        contentHash: dataVersion,
        payload,
        generatedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  const usage = await incrementUsage(userId, ENTITLEMENTS.AI_PERIOD_REVIEW);
  return {
    success: true,
    data: { ...payload, cached: false },
    usage: { ...quota.usage, used: usage.used },
  };
}

const METRIC_KEYS = new Set([
  "netPnl",
  "winRate",
  "profitFactor",
  "avgDiscipline",
  "avgRr",
  "avgRisk",
  "maxDrawdown",
  "revengeDays",
  "overtradeDays",
  "closedTrades",
]);

async function explainMetric({
  userId,
  metricKey,
  dateFrom,
  dateTo,
  comparisonFrom,
  comparisonTo,
  plan,
  trialActive,
}) {
  const quota = await assertWithinQuota(userId, ENTITLEMENTS.EXPLAIN_METRICS, {
    plan,
    trialActive,
  });
  if (!quota.success) return quota;

  if (!METRIC_KEYS.has(metricKey)) {
    return {
      success: false,
      statusCode: 400,
      message: "Unsupported metric key.",
    };
  }

  const analytics = await getAnalyticsService(userId);
  if (!analytics?.success) {
    return {
      success: false,
      statusCode: 502,
      message: "Unable to load analytics for this metric.",
    };
  }

  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;
  const curve = analytics.data.equityCurve || [];
  const windowCurve =
    from && to ? filterEquityCurve(curve, from, to) : curve;
  const windowPnl = windowCurve.reduce(
    (sum, point) => sum + Number(point.pnl || 0),
    0,
  );
  const summary = analytics.data.summary || {};
  const primaryValue =
    metricKey === "netPnl" && from && to ? windowPnl : summary[metricKey];

  let comparison = null;
  if (comparisonFrom && comparisonTo) {
    const compareCurve = filterEquityCurve(
      curve,
      new Date(comparisonFrom),
      new Date(comparisonTo),
    );
    comparison = {
      from: comparisonFrom,
      to: comparisonTo,
      netPnl: compareCurve.reduce(
        (sum, point) => sum + Number(point.pnl || 0),
        0,
      ),
      trades: compareCurve.reduce(
        (sum, point) => sum + Number(point.trades || 0),
        0,
      ),
    };
  }

  const payload = {
    metricKey,
    value: primaryValue,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    summary: {
      netPnl: summary.netPnl,
      winRate: summary.winRate,
      profitFactor: summary.profitFactor,
      avgDiscipline: summary.avgDiscipline,
      avgRr: summary.avgRr,
      avgRisk: summary.avgRisk,
      maxDrawdown: summary.maxDrawdown,
      revengeDays: summary.revengeDays,
      overtradeDays: summary.overtradeDays,
      closedTrades: summary.closedTrades,
    },
    window: {
      pnl: windowPnl,
      trades: windowCurve.reduce(
        (sum, point) => sum + Number(point.trades || 0),
        0,
      ),
      days: windowCurve.length,
    },
    comparison,
  };

  const result = await completeWithGemini([
    { role: "system", content: JUVO_EXPLAIN_METRIC_INSTRUCTIONS },
    { role: "user", content: JSON.stringify(payload) },
  ]);
  if (!result.success) return result;

  const parsed = parseJsonText(result.text) || {};
  const usage = await incrementUsage(userId, ENTITLEMENTS.EXPLAIN_METRICS);

  return {
    success: true,
    data: {
      metricKey,
      value: primaryValue,
      title: sanitizeModelIdentity(String(parsed.title || metricKey).trim()),
      explanation: sanitizeModelIdentity(
        String(parsed.explanation || result.text).trim(),
      ),
      caveat: sanitizeModelIdentity(String(parsed.caveat || "").trim()),
    },
    usage: { ...quota.usage, used: usage.used },
  };
}

async function generateGoalCoach({
  userId,
  goalId,
  action = "plan",
  plan,
  trialActive,
}) {
  const quota = await assertWithinQuota(userId, ENTITLEMENTS.GOAL_COACH, {
    plan,
    trialActive,
  });
  if (!quota.success) return quota;

  if (!["plan", "progress", "adjust"].includes(action)) {
    return {
      success: false,
      statusCode: 400,
      message: "action must be plan, progress, or adjust.",
    };
  }
  if (!mongoose.Types.ObjectId.isValid(goalId)) {
    return { success: false, statusCode: 400, message: "Invalid goal." };
  }

  const goal = await Goal.findOne({ _id: goalId, user: userId }).lean();
  if (!goal) {
    return { success: false, statusCode: 404, message: "Goal not found." };
  }

  const result = await completeWithGemini([
    { role: "system", content: JUVO_GOAL_COACH_INSTRUCTIONS },
    {
      role: "user",
      content: JSON.stringify({
        action,
        goal: {
          title: goal.title,
          description: goal.description,
          category: goal.category,
          targetType: goal.targetType,
          targetValue: goal.targetValue,
          currentValue: goal.currentValue,
          unit: goal.unit,
          priority: goal.priority,
          status: goal.status,
          startsAt: goal.startsAt,
          endsAt: goal.endsAt,
          notes: goal.notes,
        },
      }),
    },
  ]);
  if (!result.success) return result;

  const parsed = parseJsonText(result.text) || {};
  const usage = await incrementUsage(userId, ENTITLEMENTS.GOAL_COACH);

  return {
    success: true,
    data: {
      goalId: String(goal._id),
      action,
      summary: sanitizeModelIdentity(
        String(parsed.summary || result.text).trim(),
      ),
      steps: Array.isArray(parsed.steps)
        ? parsed.steps.map((step) => sanitizeModelIdentity(String(step)))
        : [],
      question: sanitizeModelIdentity(String(parsed.question || "").trim()),
    },
    usage: { ...quota.usage, used: usage.used },
  };
}

async function getAiCheckinState(
  userId,
  { plan, trialActive, preferencesOnly = false } = {},
) {
  const accessQuota = await assertWithinQuota(
    userId,
    ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS,
    { plan, trialActive },
  );
  // Still return preferences even when quota is exhausted; just no question.
  const user = await User.findById(userId)
    .select("preferences.aiCheckins")
    .lean();
  const prefs = user?.preferences?.aiCheckins || {
    enabled: false,
    lastSentAt: null,
    cooldownHours: 24,
  };

  const enabled = Boolean(prefs.enabled);
  const cooldownHours = Number(prefs.cooldownHours) || 24;
  const lastSentAt = prefs.lastSentAt ? new Date(prefs.lastSentAt) : null;
  const due =
    !preferencesOnly &&
    enabled &&
    accessQuota.success &&
    (!lastSentAt ||
      Date.now() - lastSentAt.getTime() >= cooldownHours * 60 * 60 * 1000);

  if (!due) {
    return {
      success: true,
      data: {
        enabled,
        due: false,
        question: null,
        lastSentAt: lastSentAt ? lastSentAt.toISOString() : null,
        cooldownHours,
        usage: accessQuota.usage || null,
      },
    };
  }

  const recent = await Journal.find({ user: userId })
    .select("journalDate psychology review discipline status")
    .sort({ journalDate: -1 })
    .limit(3)
    .lean();

  const result = await completeWithGemini([
    { role: "system", content: JUVO_CHECKIN_INSTRUCTIONS },
    {
      role: "user",
      content: JSON.stringify({
        recentJournals: recent.map((journal) => ({
          date: journal.journalDate,
          status: journal.status,
          beforeTrading: journal.psychology?.beforeTrading || "",
          lessonLearned: journal.review?.lessonLearned || "",
          revengeTraded: journal.discipline?.revengeTraded,
        })),
      }),
    },
  ]);

  if (!result.success) {
    return {
      success: true,
      data: {
        enabled,
        due: true,
        question: null,
        lastSentAt: lastSentAt ? lastSentAt.toISOString() : null,
        cooldownHours,
        usage: accessQuota.usage || null,
      },
    };
  }

  const parsed = parseJsonText(result.text) || {};
  const question = sanitizeModelIdentity(
    String(parsed.question || result.text).trim(),
  );

  const now = new Date();
  await User.updateOne(
    { _id: userId },
    { $set: { "preferences.aiCheckins.lastSentAt": now } },
  );
  const usage = await incrementUsage(
    userId,
    ENTITLEMENTS.CONTEXTUAL_AI_CHECKINS,
  );

  return {
    success: true,
    data: {
      enabled,
      due: true,
      question,
      lastSentAt: now.toISOString(),
      cooldownHours,
      usage: { ...accessQuota.usage, used: usage.used },
    },
  };
}

async function updateAiCheckinPreferences(userId, body = {}) {
  const updates = {};
  if (typeof body.enabled === "boolean") {
    updates["preferences.aiCheckins.enabled"] = body.enabled;
  }
  if (body.cooldownHours != null) {
    const hours = Number(body.cooldownHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      return {
        success: false,
        statusCode: 400,
        message: "cooldownHours must be between 1 and 168.",
      };
    }
    updates["preferences.aiCheckins.cooldownHours"] = Math.round(hours);
  }

  if (!Object.keys(updates).length) {
    return {
      success: false,
      statusCode: 400,
      message: "No check-in preference updates provided.",
    };
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updates },
    { new: true },
  )
    .select("preferences.aiCheckins")
    .lean();

  return {
    success: true,
    data: user?.preferences?.aiCheckins || {
      enabled: false,
      lastSentAt: null,
      cooldownHours: 24,
    },
  };
}

export {
  METRIC_KEYS,
  buildPlanComplianceChecks,
  explainMetric,
  generateGoalCoach,
  generateJournalInterviewer,
  generatePeriodReview,
  generatePlanCompliance,
  getAiCheckinState,
  interviewerSourcePayload,
  stableHash,
  updateAiCheckinPreferences,
};
