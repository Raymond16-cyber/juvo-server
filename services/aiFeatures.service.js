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

function classifyPlanCheck({
  ok,
  evidence,
  label,
  title,
  category,
  ruleId = null,
  source = "auto",
}) {
  const base = {
    evidence,
    label,
    title: title || label,
    category: category || "General",
    ruleId,
    source,
  };
  if (ok === true) return { ...base, status: "followed" };
  if (ok === false) return { ...base, status: "violated" };
  if (ok === "needs_confirmation") {
    return { ...base, status: "needs_confirmation" };
  }
  if (ok === "not_applicable") {
    return { ...base, status: "not_applicable" };
  }
  return { ...base, status: "unknown" };
}

function computeComplianceScore(counts) {
  const scored = (counts.followed || 0) + (counts.violated || 0);
  if (!scored) return null;
  return Math.round(((counts.followed || 0) / scored) * 100);
}

function buildPlanComplianceChecks({ plan, trades, journal }) {
  const checks = [];
  const notConfigured = [];
  const notRecorded = [];
  const closed = (trades || []).filter(
    (trade) => trade.status === "Closed" || trade.status === "Breakeven",
  );
  const addNotConfigured = (label, evidence, title, category) => {
    notConfigured.push({
      status: "not_configured",
      evidence,
      label,
      title: title || label,
      category: category || "General",
      source: "auto",
    });
  };
  const addNotRecorded = (label, evidence, title, category) => {
    notRecorded.push({
      status: "not_recorded",
      evidence,
      label,
      title: title || label,
      category: category || "General",
      source: "auto",
    });
  };

  const enabledRules = (plan?.rules || []).filter((rule) => rule.enabled !== false);
  const hasRuleMetric = (metric) =>
    enabledRules.some((rule) => (rule.metric || rule.key) === metric);

  const evaluateMetric = (metric, title, category, value, evaluator) => {
    if (value == null || (Array.isArray(value) && !value.length)) {
      if (!hasRuleMetric(metric)) {
        addNotConfigured(
          metric,
          `No ${title.toLowerCase()} is set on the linked plan.`,
          title,
          category,
        );
      }
      return;
    }
    const result = evaluator(value);
    checks.push(
      classifyPlanCheck({
        label: metric,
        title,
        category,
        ...result,
      }),
    );
  };

  evaluateMetric(
    "max_risk_per_trade",
    "Maximum risk per trade",
    "Risk",
    plan?.maxRiskPerTrade,
    (limit) => {
      const offenders = closed.filter(
        (trade) =>
          Number.isFinite(trade.riskPercentage) && trade.riskPercentage > limit,
      );
      const hasRisk = closed.some((t) => Number.isFinite(t.riskPercentage));
      return {
        ok: hasRisk ? offenders.length === 0 : null,
        evidence: offenders.length
          ? `${offenders.length} trade(s) exceeded ${limit}% risk.`
          : hasRisk
            ? `All sized trades stayed at or under ${limit}% risk.`
            : "Risk percentage was not logged on trades.",
      };
    },
  );

  evaluateMetric(
    "minimum_rr",
    "Minimum risk/reward ratio",
    "Strategy",
    plan?.minimumRR,
    (limit) => {
      const withRr = closed.filter((trade) => Number.isFinite(trade.plannedRR));
      const offenders = withRr.filter((trade) => trade.plannedRR < limit);
      return {
        ok: withRr.length ? offenders.length === 0 : null,
        evidence: withRr.length
          ? offenders.length
            ? `${offenders.length} trade(s) planned below ${limit}R.`
            : `Planned R multiples met the ${limit}R floor.`
          : "Planned RR was not logged.",
      };
    },
  );

  evaluateMetric(
    "max_daily_trades",
    "Maximum trades per day",
    "Risk",
    plan?.maxDailyTrades,
    (limit) => ({
      ok: (trades || []).length <= limit,
      evidence: `${(trades || []).length} trade(s) vs max ${limit}/day.`,
    }),
  );

  evaluateMetric(
    "allowed_sessions",
    "Allowed trading sessions",
    "Sessions",
    plan?.allowedSessions,
    (sessions) => {
      const withSession = closed.filter((trade) => trade.session);
      const offenders = withSession.filter(
        (trade) => !sessions.includes(trade.session),
      );
      return {
        ok: withSession.length ? offenders.length === 0 : null,
        evidence: withSession.length
          ? offenders.length
            ? `${offenders.length} trade(s) outside allowed sessions.`
            : "Trades stayed inside allowed sessions."
          : "Session tags were missing on trades.",
      };
    },
  );

  if (plan?.maxDailyLoss != null) {
    const pnls = closed
      .map((trade) => Number(trade.profitLoss))
      .filter((value) => Number.isFinite(value));
    if (!pnls.length) {
      checks.push(
        classifyPlanCheck({
          label: "max_daily_loss",
          title: "Maximum daily loss",
          category: "Risk",
          ok: null,
          evidence: "Trade P/L was not available to verify daily loss.",
        }),
      );
    } else {
      const dayPnl = pnls.reduce((sum, value) => sum + value, 0);
      checks.push(
        classifyPlanCheck({
          label: "max_daily_loss",
          title: "Maximum daily loss",
          category: "Risk",
          ok: "needs_confirmation",
          evidence: `Plan caps daily loss at ${plan.maxDailyLoss}%. Session P/L is ${dayPnl}. Confirm against account equity.`,
          source: "auto",
        }),
      );
    }
  }

  for (const rule of enabledRules) {
    const metric = rule.metric || rule.key;
    if (
      [
        "max_risk_per_trade",
        "minimum_rr",
        "max_daily_trades",
        "allowed_sessions",
        "max_daily_loss",
        "max_weekly_loss",
        "max_monthly_loss",
      ].includes(metric)
    ) {
      continue;
    }

    const prior = (journal?.planCompliance?.checks || []).find(
      (item) =>
        (rule._id && String(item.ruleId) === String(rule._id)) ||
        item.label === metric ||
        item.title === rule.title,
    );

    if (
      prior &&
      ["followed", "violated"].includes(prior.status) &&
      prior.source === "manual"
    ) {
      checks.push({
        label: metric || rule.title,
        title: rule.title,
        category: rule.category || "General",
        ruleId: rule._id || null,
        status: prior.status,
        evidence:
          prior.manualNote || prior.evidence || "Marked manually by the trader.",
        source: "manual",
        manualNote: prior.manualNote || "",
      });
      continue;
    }

    checks.push(
      classifyPlanCheck({
        label: metric || `rule_${String(rule._id || rule.title)}`,
        title: rule.title,
        category:
          rule.category ||
          (rule.kind === "commitment" ? "Commitment" : "Behaviour"),
        ruleId: rule._id || null,
        ok: "needs_confirmation",
        evidence:
          rule.kind === "commitment"
            ? "Personal commitment — mark whether you followed it."
            : "Behavioural or strategy rule — confirm from your session notes.",
        source: "manual",
      }),
    );
  }

  const discipline = journal?.discipline || {};
  const addDisciplineCheck = (
    label,
    value,
    followedEvidence,
    violatedEvidence,
    missingEvidence,
    invert = false,
    title,
    category = "Behaviour",
  ) => {
    if (typeof value !== "boolean") {
      addNotRecorded(label, missingEvidence, title || label, category);
      return;
    }
    checks.push(
      classifyPlanCheck({
        label,
        title: title || label,
        category,
        ok: invert ? !value : value,
        evidence: value ? followedEvidence : violatedEvidence,
        source: "manual",
      }),
    );
  };
  addDisciplineCheck(
    "followed_trading_plan",
    discipline.followedTradingPlan,
    "Trader marked the trading plan as followed.",
    "Trader marked the trading plan as not followed.",
    "Plan adherence was not recorded in the journal.",
    false,
    "Trading plan adherence",
    "General",
  );
  addDisciplineCheck(
    "followed_risk_management",
    discipline.followedRiskManagement,
    "Trader marked risk management as followed.",
    "Trader marked risk management as not followed.",
    "Risk-management adherence was not recorded in the journal.",
    false,
    "Risk-management adherence",
    "Risk",
  );
  addDisciplineCheck(
    "revenge_trading",
    discipline.revengeTraded,
    "No revenge trading was reported.",
    "Revenge trading was reported.",
    "Revenge-trading status was not recorded in the journal.",
    true,
    "No revenge trading",
    "Behaviour",
  );

  const followed = checks.filter((item) => item.status === "followed");
  const violated = checks.filter((item) => item.status === "violated");
  const unknown = checks.filter((item) => item.status === "unknown");
  const needsConfirmation = checks.filter(
    (item) => item.status === "needs_confirmation",
  );
  const notApplicable = checks.filter(
    (item) => item.status === "not_applicable",
  );
  const counts = {
    followed: followed.length,
    violated: violated.length,
    unknown: unknown.length,
    needs_confirmation: needsConfirmation.length,
    not_applicable: notApplicable.length,
    total:
      followed.length +
      violated.length +
      unknown.length +
      needsConfirmation.length +
      notApplicable.length,
    notConfigured: notConfigured.length,
    notRecorded: notRecorded.length,
  };

  return {
    checks,
    counts,
    score: computeComplianceScore(counts),
    followed,
    violated,
    unknown,
    needsConfirmation,
    notApplicable,
    notConfigured,
    notRecorded,
    methodology:
      "Score = followed / (followed + violated). Unknown, needs confirmation, not applicable, not configured, and not recorded checks are excluded from the percentage.",
  };
}

function buildCompliancePayload({ compliance, linkedPlan, interpretation, question }) {
  return {
    planId: linkedPlan?._id || null,
    planKey: linkedPlan?.planKey || null,
    planVersion: linkedPlan?.version || null,
    planName: linkedPlan?.name || null,
    evaluatedAt: new Date(),
    score: compliance.score,
    counts: compliance.counts,
    checks: (compliance.checks || []).map((item) => ({
      ruleId: item.ruleId || null,
      label: item.label,
      title: item.title || item.label,
      category: item.category || "General",
      status: item.status,
      evidence: item.evidence || "",
      source: item.source || "auto",
      manualNote: item.manualNote || "",
      updatedAt: new Date(),
      updatedBy: item.source === "manual" ? "user" : "system",
    })),
    followed: compliance.followed,
    violated: compliance.violated,
    unknown: compliance.unknown,
    needsConfirmation: compliance.needsConfirmation || [],
    notApplicable: compliance.notApplicable || [],
    notConfigured: compliance.notConfigured,
    notRecorded: compliance.notRecorded,
    interpretation: interpretation || "",
    question: question || "",
    methodology: compliance.methodology,
  };
}

async function persistJournalCompliance(journal, payload) {
  journal.planCompliance = {
    planId: payload.planId,
    planKey: payload.planKey,
    planVersion: payload.planVersion,
    evaluatedAt: payload.evaluatedAt,
    score: payload.score,
    counts: payload.counts,
    checks: payload.checks,
    interpretation: payload.interpretation,
    question: payload.question,
    methodology: payload.methodology,
  };
  if (payload.planId && !journal.tradingPlan) {
    journal.tradingPlan = payload.planId;
  }
  await journal.save();
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
      "symbol direction status session riskPercentage plannedRR achievedRR notes profitLoss",
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

  const journalDate = new Date(journal.journalDate);
  const planReference = journal.tradingPlan;
  let linkedPlan =
    planReference && typeof planReference === "object" && planReference._id
      ? planReference
      : null;
  if (!linkedPlan && planReference) {
    linkedPlan = await TradingPlan.findById(
      planReference._id || planReference,
    );
  }
  // Prefer the plan version that was effective on the journal date (historical integrity).
  if (!linkedPlan && journal.tradingAccount) {
    linkedPlan = await TradingPlan.findOne({
      userId,
      tradingAccount: journal.tradingAccount,
      validFrom: { $lte: journalDate },
      validUntil: { $gt: journalDate },
    }).sort({ version: -1, validFrom: -1 });
  }
  if (!linkedPlan && journal.tradingAccount) {
    linkedPlan = await TradingPlan.findOne({
      userId,
      tradingAccount: journal.tradingAccount,
      status: "Active",
    }).sort({ version: -1 });
  }

  const compliance = buildPlanComplianceChecks({
    plan: linkedPlan,
    trades,
    journal,
  });

  const hasApplicableChecks = compliance.counts.total > 0;
  if (!hasApplicableChecks) {
    const notConfiguredCount = compliance.counts.notConfigured;
    const notRecordedCount = compliance.counts.notRecorded;
    const interpretation =
      "No plan compliance could be assessed because no configured plan rules or journal adherence responses were available. These items are not treated as violations. Set the plan rules you want to track and record your adherence in the journal to get an assessment." +
      (notConfiguredCount || notRecordedCount
        ? ` ${notConfiguredCount} rule(s) are not configured and ${notRecordedCount} journal response(s) are not recorded.`
        : "");
    const data = buildCompliancePayload({
      compliance,
      linkedPlan,
      interpretation,
      question: "",
    });
    await persistJournalCompliance(journal, data);
    return {
      success: true,
      data,
      usage: quota.usage,
    };
  }
  const result = await completeWithGemini([
    { role: "system", content: JUVO_PLAN_COMPLIANCE_INSTRUCTIONS },
    {
      role: "user",
      content: JSON.stringify({
        counts: compliance.counts,
        followed: compliance.followed,
        violated: compliance.violated,
        unknown: compliance.unknown,
        needsConfirmation: compliance.needsConfirmation,
        notConfigured: compliance.notConfigured,
        notRecorded: compliance.notRecorded,
        planVersion: linkedPlan?.version || null,
      }),
    },
  ]);
  if (!result.success) return result;

  const parsed = parseJsonText(result.text) || {};
  const usage = await incrementUsage(
    userId,
    ENTITLEMENTS.PLAN_COMPLIANCE_CHECK,
  );

  const data = buildCompliancePayload({
    compliance,
    linkedPlan,
    interpretation: sanitizeModelIdentity(
      String(parsed.interpretation || result.text).trim(),
    ),
    question: sanitizeModelIdentity(String(parsed.question || "").trim()),
  });
  await persistJournalCompliance(journal, data);

  return {
    success: true,
    data,
    usage: { ...quota.usage, used: usage.used },
  };
}

async function updatePlanComplianceManual({
  userId,
  journalId,
  label,
  ruleId,
  status,
  manualNote = "",
}) {
  if (!mongoose.Types.ObjectId.isValid(journalId)) {
    return { success: false, statusCode: 400, message: "Invalid journal." };
  }
  if (!["followed", "violated", "not_applicable", "needs_confirmation"].includes(status)) {
    return {
      success: false,
      statusCode: 400,
      message: "Status must be followed, violated, not_applicable, or needs_confirmation.",
    };
  }

  const journal = await Journal.findOne({ _id: journalId, user: userId });
  if (!journal) {
    return { success: false, statusCode: 404, message: "Journal not found." };
  }

  const checks = Array.isArray(journal.planCompliance?.checks)
    ? [...journal.planCompliance.checks.map((item) => item.toObject?.() || { ...item })]
    : [];

  let index = checks.findIndex((item) => {
    if (ruleId && item.ruleId && String(item.ruleId) === String(ruleId)) return true;
    return label && item.label === label;
  });

  if (index < 0) {
    checks.push({
      ruleId: ruleId || null,
      label: label || "manual_check",
      title: label || "Manual check",
      category: "Behaviour",
      status,
      evidence: manualNote || "Marked manually by the trader.",
      source: "manual",
      manualNote: String(manualNote || "").slice(0, 500),
      updatedAt: new Date(),
      updatedBy: "user",
    });
    index = checks.length - 1;
  } else {
    checks[index] = {
      ...checks[index],
      status,
      source: "manual",
      manualNote: String(manualNote || "").slice(0, 500),
      evidence:
        manualNote ||
        checks[index].evidence ||
        "Marked manually by the trader.",
      updatedAt: new Date(),
      updatedBy: "user",
    };
  }

  const followed = checks.filter((item) => item.status === "followed");
  const violated = checks.filter((item) => item.status === "violated");
  const unknown = checks.filter((item) => item.status === "unknown");
  const needsConfirmation = checks.filter(
    (item) => item.status === "needs_confirmation",
  );
  const notApplicable = checks.filter(
    (item) => item.status === "not_applicable",
  );
  const counts = {
    ...(journal.planCompliance?.counts || {}),
    followed: followed.length,
    violated: violated.length,
    unknown: unknown.length,
    needs_confirmation: needsConfirmation.length,
    not_applicable: notApplicable.length,
    total: checks.length,
  };
  const score = computeComplianceScore(counts);

  journal.planCompliance = {
    ...(journal.planCompliance?.toObject?.() || journal.planCompliance || {}),
    counts,
    score,
    checks,
    evaluatedAt: new Date(),
  };
  await journal.save();

  return {
    success: true,
    data: {
      planId: journal.planCompliance.planId,
      planVersion: journal.planCompliance.planVersion,
      score,
      counts,
      checks,
      followed,
      violated,
      unknown,
      needsConfirmation,
      notApplicable,
      methodology: journal.planCompliance.methodology,
    },
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

  let behaviourContext = null;
  if (goal.behaviorChallenge) {
    const [user, trades, journals, plans] = await Promise.all([
      User.findById(userId)
        .select("profile.biggestChallenges profile.challengeProgress profile.timezone")
        .lean(),
      Trade.find({
        user: userId,
        "behaviourFlags.challenge": goal.behaviorChallenge,
      })
        .select("symbol status riskPercentage profitLoss profitLossCurrency openedAt closedAt behaviourFlags")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Journal.find({
        user: userId,
        "behaviourFlags.challenge": goal.behaviorChallenge,
      })
        .select("journalDate discipline psychology behaviourFlags")
        .sort({ journalDate: -1 })
        .limit(10)
        .lean(),
      TradingPlan.find({ userId, status: "Active" })
        .select(
          "name version planKey maxRiskPerTrade maxDailyTrades maxDailyLoss maxWeeklyLoss maxMonthlyLoss maxConsecutiveLosses minimumRR allowedSessions rules checklist strategyLabel entryTimeframe analysisTimeframe",
        )
        .sort({ updatedAt: -1 })
        .limit(5)
        .lean(),
    ]);
    behaviourContext = {
      selectedChallenges: user?.profile?.biggestChallenges || [],
      progress: user?.profile?.challengeProgress || [],
      activeTradingPlans: plans,
      observations: [
        ...trades.flatMap((trade) =>
          (trade.behaviourFlags || [])
            .filter((flag) => flag.challenge === goal.behaviorChallenge)
            .map((flag) => ({
              date: flag.createdAt || trade.openedAt || trade.closedAt,
              source: flag.source,
              status:
                flag.confirmed === true
                  ? "confirmed"
                  : flag.confirmed === false || flag.dismissedAt
                    ? "dismissed"
                    : "suggested",
              confidence: flag.confidence,
              evidence: flag.evidence || null,
              symbol: trade.symbol,
              tradeStatus: trade.status,
              riskPercentage: trade.riskPercentage,
              profitLoss: trade.profitLoss,
              profitLossCurrency: trade.profitLossCurrency,
            })),
        ),
        ...journals.flatMap((journal) =>
          (journal.behaviourFlags || [])
            .filter((flag) => flag.challenge === goal.behaviorChallenge)
            .map((flag) => ({
              date: flag.createdAt || journal.journalDate,
              source: flag.source,
              status:
                flag.confirmed === true
                  ? "confirmed"
                  : flag.confirmed === false || flag.dismissedAt
                    ? "dismissed"
                    : "suggested",
              confidence: flag.confidence,
              evidence: flag.evidence || null,
              discipline: journal.discipline,
              psychology: journal.psychology,
            })),
        ),
      ]
        .sort(
          (left, right) =>
            new Date(right.date || 0).getTime() -
            new Date(left.date || 0).getTime(),
        )
        .slice(0, 15),
    };
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
          behaviorChallenge: goal.behaviorChallenge || null,
        },
        behaviourContext,
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
  computeComplianceScore,
  explainMetric,
  generateGoalCoach,
  generateJournalInterviewer,
  generatePeriodReview,
  generatePlanCompliance,
  getAiCheckinState,
  interviewerSourcePayload,
  stableHash,
  updateAiCheckinPreferences,
  updatePlanComplianceManual,
};
