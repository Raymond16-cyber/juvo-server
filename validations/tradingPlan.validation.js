import mongoose from "mongoose";
import {
  TRADING_PLAN_RULE_CATEGORIES,
  TRADING_PLAN_RULE_KINDS,
} from "../models/tradingPlan.js";

const SESSIONS = ["Asian", "Sydney", "Tokyo", "London", "New York"];
const STATUSES = ["Active", "Completed", "Archived"];
const PLAN_METRICS = new Set([
  "max_risk_per_trade",
  "max_daily_trades",
  "max_daily_loss",
  "max_weekly_loss",
  "max_monthly_loss",
  "max_consecutive_losses",
  "minimum_rr",
  "allowed_sessions",
  "entry_timeframe",
  "analysis_timeframe",
  "strategy_label",
]);

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function optionalNumber(value, { min = null, max = null } = {}) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const number = Number(value);
  if (!Number.isFinite(number)) return { ok: false, value: null };
  if (min != null && number < min) return { ok: false, value: null };
  if (max != null && number > max) return { ok: false, value: null };
  return { ok: true, value: number };
}

function normalizeRule(raw = {}, errors, index) {
  const title = String(raw.title || "").trim();
  const description = String(raw.description || "").trim();
  const category = String(raw.category || "General").trim();
  const kind = String(raw.kind || (category === "Commitment" ? "commitment" : "rule")).trim();
  const metric = raw.metric == null || raw.metric === ""
    ? null
    : String(raw.metric).trim().slice(0, 60);
  const key = raw.key == null || raw.key === ""
    ? metric || `custom_${index + 1}`
    : String(raw.key).trim().slice(0, 80);
  const enabled = raw.enabled === undefined ? true : Boolean(raw.enabled);
  const source = ["manual", "ai_suggestion", "system"].includes(raw.source)
    ? raw.source
    : "manual";

  if (!title) {
    errors.push(`Rule ${index + 1} needs a title.`);
    return null;
  }
  if (!TRADING_PLAN_RULE_CATEGORIES.includes(category)) {
    errors.push(`Rule ${index + 1} has an invalid category.`);
    return null;
  }
  if (!TRADING_PLAN_RULE_KINDS.includes(kind)) {
    errors.push(`Rule ${index + 1} has an invalid kind.`);
    return null;
  }
  if (metric && !PLAN_METRICS.has(metric) && !metric.startsWith("custom_")) {
    // Allow free-form custom metrics while keeping known keys stable.
  }

  const rule = {
    title: title.slice(0, 160),
    description: description.slice(0, 1000),
    category,
    kind: category === "Commitment" ? "commitment" : kind,
    enabled,
    value: raw.value === undefined ? null : raw.value,
    metric,
    key,
    source,
    suggestionId:
      raw.suggestionId && isValidObjectId(raw.suggestionId)
        ? raw.suggestionId
        : null,
  };

  if (raw._id && isValidObjectId(raw._id)) {
    rule._id = raw._id;
  }
  if (raw.addedAt) rule.addedAt = new Date(raw.addedAt);
  if (raw.modifiedAt) rule.modifiedAt = new Date(raw.modifiedAt);

  return rule;
}

function normalizeSessions(value, errors) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push("Allowed sessions must be a list.");
    return [];
  }
  const sessions = [
    ...new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ];
  for (const session of sessions) {
    if (!SESSIONS.includes(session)) {
      errors.push(`Session "${session}" is not supported.`);
    }
  }
  return sessions;
}

function validateTradingPlanInput(payload = {}, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || payload.name !== undefined) {
    const name = String(payload.name || "").trim();
    if (!name) errors.push("Plan name is required.");
    else data.name = name.slice(0, 120);
  }

  if (!partial || payload.tradingAccount !== undefined) {
    const tradingAccount = String(payload.tradingAccount || "").trim();
    if (!tradingAccount || !isValidObjectId(tradingAccount)) {
      errors.push("Trading account is required.");
    } else {
      data.tradingAccount = tradingAccount;
    }
  }

  if (payload.strategy !== undefined) {
    if (payload.strategy === null || payload.strategy === "") {
      data.strategy = null;
    } else if (!isValidObjectId(payload.strategy)) {
      errors.push("Strategy is invalid.");
    } else {
      data.strategy = payload.strategy;
    }
  }

  if (payload.strategyLabel !== undefined) {
    data.strategyLabel = String(payload.strategyLabel || "").trim().slice(0, 120);
  }

  const numberFields = [
    ["maxRiskPerTrade", 0, 100],
    ["maxDailyTrades", 0, null],
    ["maxDailyLoss", 0, 100],
    ["maxWeeklyLoss", 0, 100],
    ["maxMonthlyLoss", 0, 100],
    ["maxConsecutiveLosses", 0, null],
    ["minimumRR", 0, null],
  ];
  for (const [field, min, max] of numberFields) {
    if (!partial && payload[field] === undefined) continue;
    if (partial && payload[field] === undefined) continue;
    const parsed = optionalNumber(payload[field], { min, max });
    if (!parsed.ok) {
      errors.push(`${field} is invalid.`);
    } else if (payload[field] !== undefined) {
      data[field] = parsed.value;
    }
  }

  if (payload.allowedSessions !== undefined) {
    data.allowedSessions = normalizeSessions(payload.allowedSessions, errors);
  }

  if (payload.entryTimeframe !== undefined) {
    data.entryTimeframe = String(payload.entryTimeframe || "").trim().slice(0, 20);
  }
  if (payload.analysisTimeframe !== undefined) {
    data.analysisTimeframe = String(payload.analysisTimeframe || "").trim().slice(0, 20);
  }

  if (payload.customHours !== undefined) {
    const hours = payload.customHours || {};
    data.customHours = {
      start: String(hours.start || "").trim().slice(0, 8),
      end: String(hours.end || "").trim().slice(0, 8),
      timezone: String(hours.timezone || "").trim().slice(0, 80),
    };
  }

  if (payload.notes !== undefined) {
    data.notes = String(payload.notes || "").trim().slice(0, 2000);
  }

  if (payload.status !== undefined) {
    const status = String(payload.status || "").trim();
    if (!STATUSES.includes(status)) errors.push("Plan status is invalid.");
    else data.status = status;
  }

  if (payload.validFrom !== undefined) {
    const validFrom = new Date(payload.validFrom);
    if (Number.isNaN(validFrom.getTime())) errors.push("validFrom is invalid.");
    else data.validFrom = validFrom;
  }

  if (payload.validUntil !== undefined) {
    const validUntil = new Date(payload.validUntil);
    if (Number.isNaN(validUntil.getTime())) errors.push("validUntil is invalid.");
    else data.validUntil = validUntil;
  }

  if (payload.changeSummary !== undefined) {
    data.changeSummary = String(payload.changeSummary || "").trim().slice(0, 500);
  }

  if (payload.rules !== undefined) {
    if (!Array.isArray(payload.rules)) {
      errors.push("Rules must be a list.");
    } else if (payload.rules.length > 80) {
      errors.push("A plan can include at most 80 rules.");
    } else {
      data.rules = payload.rules
        .map((rule, index) => normalizeRule(rule, errors, index))
        .filter(Boolean);
    }
  }

  if (payload.checklist !== undefined) {
    if (!Array.isArray(payload.checklist)) {
      errors.push("Checklist must be a list.");
    } else {
      data.checklist = payload.checklist
        .slice(0, 40)
        .map((item) => ({
          title: String(item?.title || "").trim().slice(0, 160),
          description: String(item?.description || "").trim().slice(0, 500),
          required: item?.required !== false,
        }))
        .filter((item) => item.title);
    }
  }

  if (
    data.validFrom &&
    data.validUntil &&
    data.validUntil.getTime() <= data.validFrom.getTime()
  ) {
    errors.push("validUntil must be after validFrom.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data,
  };
}

function validatePlanRuleInput(payload = {}) {
  const errors = [];
  const rule = normalizeRule(payload, errors, 0);
  return {
    isValid: errors.length === 0 && Boolean(rule),
    errors,
    data: rule,
  };
}

export {
  PLAN_METRICS,
  SESSIONS,
  validatePlanRuleInput,
  validateTradingPlanInput,
};
