import mongoose from "mongoose";
import PlanSuggestion from "../models/PlanSuggestion.js";
import TradingPlan from "../models/tradingPlan.js";
import TradingAccount from "../models/tradingAccounts.js";
import {
  PLAN_METRICS,
  validatePlanRuleInput,
  validateTradingPlanInput,
} from "../validations/tradingPlan.validation.js";

const FAR_FUTURE = new Date("9999-12-31T23:59:59.999Z");

const METRIC_TO_FIELD = {
  max_risk_per_trade: "maxRiskPerTrade",
  max_daily_trades: "maxDailyTrades",
  max_daily_loss: "maxDailyLoss",
  max_weekly_loss: "maxWeeklyLoss",
  max_monthly_loss: "maxMonthlyLoss",
  max_consecutive_losses: "maxConsecutiveLosses",
  minimum_rr: "minimumRR",
  allowed_sessions: "allowedSessions",
  entry_timeframe: "entryTimeframe",
  analysis_timeframe: "analysisTimeframe",
  strategy_label: "strategyLabel",
};

function clonePlain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
}

function ensureRuleTimestamps(rules = [], { preserveIds = false } = {}) {
  const now = new Date();
  return (rules || []).map((rule) => {
    const next = { ...rule };
    if (!preserveIds) delete next._id;
    next.addedAt = rule.addedAt ? new Date(rule.addedAt) : now;
    next.modifiedAt = rule.modifiedAt ? new Date(rule.modifiedAt) : now;
    return next;
  });
}

function syncMetricFieldsFromRules(planData) {
  const next = { ...planData };
  for (const rule of next.rules || []) {
    if (!rule?.enabled || !rule.metric || !METRIC_TO_FIELD[rule.metric]) continue;
    const field = METRIC_TO_FIELD[rule.metric];
    if (rule.value !== undefined && rule.value !== null && rule.value !== "") {
      next[field] = rule.value;
    }
  }
  return next;
}

function buildSystemRulesFromFields(plan) {
  const rules = [];
  const push = (metric, title, category, value, description = "") => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value) && !value.length) return;
    rules.push({
      key: metric,
      metric,
      title,
      description,
      category,
      kind: "rule",
      enabled: true,
      value,
      source: "system",
      addedAt: new Date(),
      modifiedAt: new Date(),
    });
  };

  push(
    "max_risk_per_trade",
    `Risk per trade: ${plan.maxRiskPerTrade}%`,
    "Risk",
    plan.maxRiskPerTrade,
    "Maximum risk allowed on a single trade.",
  );
  push(
    "max_daily_trades",
    `Maximum trades per day: ${plan.maxDailyTrades}`,
    "Risk",
    plan.maxDailyTrades,
  );
  push(
    "max_daily_loss",
    `Maximum daily loss: ${plan.maxDailyLoss}%`,
    "Risk",
    plan.maxDailyLoss,
  );
  push(
    "max_weekly_loss",
    `Maximum weekly loss: ${plan.maxWeeklyLoss}%`,
    "Risk",
    plan.maxWeeklyLoss,
  );
  push(
    "max_monthly_loss",
    `Maximum monthly loss: ${plan.maxMonthlyLoss}%`,
    "Risk",
    plan.maxMonthlyLoss,
  );
  push(
    "max_consecutive_losses",
    `Maximum consecutive losses: ${plan.maxConsecutiveLosses}`,
    "Behaviour",
    plan.maxConsecutiveLosses,
  );
  push(
    "minimum_rr",
    `Minimum risk-to-reward: ${plan.minimumRR}R`,
    "Strategy",
    plan.minimumRR,
  );
  push(
    "allowed_sessions",
    `Allowed sessions: ${(plan.allowedSessions || []).join(", ")}`,
    "Sessions",
    plan.allowedSessions,
  );
  if (plan.strategyLabel) {
    push(
      "strategy_label",
      `Trading strategy: ${plan.strategyLabel}`,
      "Strategy",
      plan.strategyLabel,
    );
  }
  if (plan.entryTimeframe) {
    push(
      "entry_timeframe",
      `Entry timeframe: ${plan.entryTimeframe}`,
      "Strategy",
      plan.entryTimeframe,
    );
  }
  if (plan.analysisTimeframe) {
    push(
      "analysis_timeframe",
      `Analysis timeframe: ${plan.analysisTimeframe}`,
      "Strategy",
      plan.analysisTimeframe,
    );
  }
  return rules;
}

function mergeSystemAndCustomRules(planData) {
  const custom = (planData.rules || []).filter(
    (rule) => rule.source !== "system" && !PLAN_METRICS.has(rule.metric || rule.key),
  );
  const system = buildSystemRulesFromFields(planData);
  const metricOverrides = (planData.rules || []).filter(
    (rule) =>
      rule.source !== "system" &&
      PLAN_METRICS.has(rule.metric || rule.key),
  );
  const byMetric = new Map();
  for (const rule of system) byMetric.set(rule.metric, rule);
  for (const rule of metricOverrides) {
    byMetric.set(rule.metric || rule.key, {
      ...byMetric.get(rule.metric || rule.key),
      ...rule,
      key: rule.metric || rule.key,
      metric: rule.metric || rule.key,
    });
  }
  return [...byMetric.values(), ...custom];
}

async function assertAccountOwned(tradingAccountId, userId) {
  const account = await TradingAccount.findOne({
    _id: tradingAccountId,
    userId,
  }).lean();
  if (!account) {
    return {
      success: false,
      statusCode: 404,
      message: "Trading account not found.",
    };
  }
  return { success: true, account };
}

async function listTradingPlansService(userId, { tradingAccount, status } = {}) {
  const filter = { userId };
  if (tradingAccount && mongoose.Types.ObjectId.isValid(tradingAccount)) {
    filter.tradingAccount = tradingAccount;
  }
  if (status && ["Active", "Completed", "Archived"].includes(status)) {
    filter.status = status;
  } else if (!status) {
    filter.status = "Active";
  }

  const plans = await TradingPlan.find(filter)
    .populate("tradingAccount", "accountName broker currency accountCurrency")
    .populate("strategy", "name description")
    .sort({ updatedAt: -1 })
    .lean();

  return { success: true, data: plans };
}

async function getTradingPlanService(planId, userId) {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    return { success: false, statusCode: 400, message: "Invalid trading plan." };
  }
  const plan = await TradingPlan.findOne({ _id: planId, userId })
    .populate("tradingAccount", "accountName broker currency accountCurrency")
    .populate("strategy", "name description")
    .lean();
  if (!plan) {
    return { success: false, statusCode: 404, message: "Trading plan not found." };
  }
  return { success: true, data: plan };
}

async function listPlanVersionsService(planKeyOrId, userId) {
  let planKey = planKeyOrId;
  if (mongoose.Types.ObjectId.isValid(planKeyOrId)) {
    const seed = await TradingPlan.findOne({
      $or: [{ _id: planKeyOrId }, { planKey: planKeyOrId }],
      userId,
    })
      .select("planKey")
      .lean();
    if (!seed) {
      return { success: false, statusCode: 404, message: "Trading plan not found." };
    }
    planKey = seed.planKey;
  }

  const versions = await TradingPlan.find({ userId, planKey })
    .populate("tradingAccount", "accountName broker currency accountCurrency")
    .sort({ version: -1 })
    .lean();

  return { success: true, data: versions };
}

async function getActivePlanForAccount(userId, tradingAccountId, atDate = new Date()) {
  const when = atDate instanceof Date ? atDate : new Date(atDate);
  return TradingPlan.findOne({
    userId,
    tradingAccount: tradingAccountId,
    status: "Active",
    validFrom: { $lte: when },
    validUntil: { $gt: when },
  })
    .sort({ version: -1 })
    .lean();
}

async function createTradingPlanService(payload, userId) {
  const result = validateTradingPlanInput(payload);
  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const accountCheck = await assertAccountOwned(result.data.tradingAccount, userId);
  if (!accountCheck.success) return accountCheck;

  const existingActive = await TradingPlan.findOne({
    userId,
    tradingAccount: result.data.tradingAccount,
    status: "Active",
  }).lean();
  if (existingActive) {
    return {
      success: false,
      statusCode: 409,
      message:
        "An active trading plan already exists for this account. Update it to create a new version.",
    };
  }

  const now = new Date();
  const planKey = new mongoose.Types.ObjectId();
  let planData = {
    ...result.data,
    userId,
    planKey,
    version: 1,
    validFrom: result.data.validFrom || now,
    validUntil: result.data.validUntil || FAR_FUTURE,
    status: "Active",
    rules: result.data.rules || [],
  };
  planData = syncMetricFieldsFromRules(planData);
  planData.rules = mergeSystemAndCustomRules(planData);

  const plan = await TradingPlan.create(planData);
  const populated = await TradingPlan.findById(plan._id)
    .populate("tradingAccount", "accountName broker currency accountCurrency")
    .populate("strategy", "name description");

  return { success: true, data: populated };
}

function materialFieldsChanged(existing, updates) {
  const keys = [
    "name",
    "strategy",
    "strategyLabel",
    "maxRiskPerTrade",
    "maxDailyTrades",
    "maxDailyLoss",
    "maxWeeklyLoss",
    "maxMonthlyLoss",
    "maxConsecutiveLosses",
    "minimumRR",
    "allowedSessions",
    "entryTimeframe",
    "analysisTimeframe",
    "customHours",
    "notes",
    "rules",
    "checklist",
  ];
  for (const key of keys) {
    if (updates[key] === undefined) continue;
    const before = JSON.stringify(existing[key] ?? null);
    const after = JSON.stringify(updates[key] ?? null);
    if (before !== after) return true;
  }
  return false;
}

async function createPlanVersionFrom(existing, updates, userId, changeSummary = "") {
  const now = new Date();
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await TradingPlan.updateOne(
      { _id: existing._id, userId },
      {
        $set: {
          status: "Archived",
          validUntil: now,
        },
      },
      { session },
    );

    let nextData = {
      name: updates.name ?? existing.name,
      strategy:
        updates.strategy !== undefined ? updates.strategy : existing.strategy,
      strategyLabel:
        updates.strategyLabel !== undefined
          ? updates.strategyLabel
          : existing.strategyLabel,
      maxRiskPerTrade:
        updates.maxRiskPerTrade !== undefined
          ? updates.maxRiskPerTrade
          : existing.maxRiskPerTrade,
      maxDailyTrades:
        updates.maxDailyTrades !== undefined
          ? updates.maxDailyTrades
          : existing.maxDailyTrades,
      maxDailyLoss:
        updates.maxDailyLoss !== undefined
          ? updates.maxDailyLoss
          : existing.maxDailyLoss,
      maxWeeklyLoss:
        updates.maxWeeklyLoss !== undefined
          ? updates.maxWeeklyLoss
          : existing.maxWeeklyLoss,
      maxMonthlyLoss:
        updates.maxMonthlyLoss !== undefined
          ? updates.maxMonthlyLoss
          : existing.maxMonthlyLoss,
      maxConsecutiveLosses:
        updates.maxConsecutiveLosses !== undefined
          ? updates.maxConsecutiveLosses
          : existing.maxConsecutiveLosses,
      minimumRR:
        updates.minimumRR !== undefined ? updates.minimumRR : existing.minimumRR,
      allowedSessions:
        updates.allowedSessions !== undefined
          ? updates.allowedSessions
          : existing.allowedSessions,
      entryTimeframe:
        updates.entryTimeframe !== undefined
          ? updates.entryTimeframe
          : existing.entryTimeframe,
      analysisTimeframe:
        updates.analysisTimeframe !== undefined
          ? updates.analysisTimeframe
          : existing.analysisTimeframe,
      customHours:
        updates.customHours !== undefined
          ? updates.customHours
          : existing.customHours,
      notes: updates.notes !== undefined ? updates.notes : existing.notes,
      checklist:
        updates.checklist !== undefined ? updates.checklist : existing.checklist,
      rules:
        updates.rules !== undefined
          ? ensureRuleTimestamps(updates.rules, { preserveIds: false })
          : ensureRuleTimestamps(existing.rules || [], { preserveIds: false }),
      userId,
      tradingAccount: existing.tradingAccount,
      planKey: existing.planKey,
      version: Number(existing.version || 1) + 1,
      supersedes: existing._id,
      validFrom: now,
      validUntil: FAR_FUTURE,
      status: "Active",
      changeSummary: changeSummary || updates.changeSummary || "",
    };

    nextData = syncMetricFieldsFromRules(nextData);
    nextData.rules = mergeSystemAndCustomRules(nextData);

    const [created] = await TradingPlan.create([nextData], { session });
    await session.commitTransaction();

    const populated = await TradingPlan.findById(created._id)
      .populate("tradingAccount", "accountName broker currency accountCurrency")
      .populate("strategy", "name description");

    return { success: true, data: populated, versioned: true };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function updateTradingPlanService(planId, payload, userId, options = {}) {
  const { forceVersion = true } = options;
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    return { success: false, statusCode: 400, message: "Invalid trading plan." };
  }

  const result = validateTradingPlanInput(payload, { partial: true });
  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const existing = await TradingPlan.findOne({ _id: planId, userId });
  if (!existing) {
    return { success: false, statusCode: 404, message: "Trading plan not found." };
  }
  if (existing.status !== "Active") {
    return {
      success: false,
      statusCode: 409,
      message: "Only the active plan version can be edited.",
    };
  }

  if (result.data.tradingAccount) {
    const accountCheck = await assertAccountOwned(
      result.data.tradingAccount,
      userId,
    );
    if (!accountCheck.success) return accountCheck;
    if (
      String(result.data.tradingAccount) !== String(existing.tradingAccount)
    ) {
      return {
        success: false,
        statusCode: 400,
        message: "Move the plan by creating a new plan on the target account.",
      };
    }
  }

  // Status-only archive without versioning.
  if (
    result.data.status &&
    result.data.status !== "Active" &&
    Object.keys(result.data).length === 1
  ) {
    existing.status = result.data.status;
    existing.validUntil = new Date();
    await existing.save();
    return { success: true, data: existing, versioned: false };
  }

  const updates = { ...result.data };
  delete updates.tradingAccount;
  delete updates.status;

  if (!materialFieldsChanged(clonePlain(existing), updates) && !forceVersion) {
    Object.assign(existing, updates);
    await existing.save();
    return { success: true, data: existing, versioned: false };
  }

  if (!materialFieldsChanged(clonePlain(existing), updates)) {
    return { success: true, data: existing, versioned: false };
  }

  return createPlanVersionFrom(
    clonePlain(existing),
    updates,
    userId,
    updates.changeSummary || "",
  );
}

async function addPlanRuleService(planId, payload, userId) {
  const validated = validatePlanRuleInput(payload);
  if (!validated.isValid) {
    return {
      success: false,
      statusCode: 400,
      message: validated.errors.join(" "),
    };
  }

  const existing = await TradingPlan.findOne({ _id: planId, userId }).lean();
  if (!existing) {
    return { success: false, statusCode: 404, message: "Trading plan not found." };
  }
  if (existing.status !== "Active") {
    return {
      success: false,
      statusCode: 409,
      message: "Only the active plan version can be edited.",
    };
  }

  const duplicate = (existing.rules || []).find((rule) => {
    if (!rule.enabled) return false;
    if (validated.data.metric && rule.metric === validated.data.metric) return true;
    return (
      String(rule.title || "").toLowerCase() ===
      String(validated.data.title || "").toLowerCase()
    );
  });
  if (duplicate) {
    return {
      success: false,
      statusCode: 409,
      message:
        "A similar rule already exists. Update that rule instead of adding a duplicate.",
      data: { existingRuleId: duplicate._id },
    };
  }

  const now = new Date();
  const nextRules = [
    ...(existing.rules || []).map((rule) => clonePlain(rule)),
    {
      ...validated.data,
      addedAt: now,
      modifiedAt: now,
    },
  ];

  const fieldUpdates = {};
  if (validated.data.metric && METRIC_TO_FIELD[validated.data.metric]) {
    fieldUpdates[METRIC_TO_FIELD[validated.data.metric]] = validated.data.value;
  }

  return updateTradingPlanService(
    planId,
    {
      ...fieldUpdates,
      rules: nextRules,
      changeSummary: `Added rule: ${validated.data.title}`,
    },
    userId,
  );
}

async function updatePlanRuleService(planId, ruleId, payload, userId) {
  if (!mongoose.Types.ObjectId.isValid(ruleId)) {
    return { success: false, statusCode: 400, message: "Invalid rule." };
  }
  const existing = await TradingPlan.findOne({ _id: planId, userId }).lean();
  if (!existing) {
    return { success: false, statusCode: 404, message: "Trading plan not found." };
  }

  const rules = (existing.rules || []).map((rule) => clonePlain(rule));
  const index = rules.findIndex((rule) => String(rule._id) === String(ruleId));
  if (index < 0) {
    return { success: false, statusCode: 404, message: "Rule not found." };
  }

  const merged = {
    ...rules[index],
    ...payload,
    title: payload.title !== undefined ? payload.title : rules[index].title,
    description:
      payload.description !== undefined
        ? payload.description
        : rules[index].description,
    category:
      payload.category !== undefined ? payload.category : rules[index].category,
    kind: payload.kind !== undefined ? payload.kind : rules[index].kind,
    enabled:
      payload.enabled !== undefined ? Boolean(payload.enabled) : rules[index].enabled,
    value: payload.value !== undefined ? payload.value : rules[index].value,
    metric: payload.metric !== undefined ? payload.metric : rules[index].metric,
    modifiedAt: new Date(),
  };

  const validated = validatePlanRuleInput(merged);
  if (!validated.isValid) {
    return {
      success: false,
      statusCode: 400,
      message: validated.errors.join(" "),
    };
  }

  rules[index] = {
    ...validated.data,
    _id: rules[index]._id,
    addedAt: rules[index].addedAt,
    modifiedAt: new Date(),
    source: rules[index].source || "manual",
  };

  const fieldUpdates = {};
  if (rules[index].metric && METRIC_TO_FIELD[rules[index].metric]) {
    fieldUpdates[METRIC_TO_FIELD[rules[index].metric]] = rules[index].enabled
      ? rules[index].value
      : null;
  }

  return updateTradingPlanService(
    planId,
    {
      ...fieldUpdates,
      rules,
      changeSummary: `Updated rule: ${rules[index].title}`,
    },
    userId,
  );
}

async function removePlanRuleService(planId, ruleId, userId) {
  if (!mongoose.Types.ObjectId.isValid(ruleId)) {
    return { success: false, statusCode: 400, message: "Invalid rule." };
  }
  const existing = await TradingPlan.findOne({ _id: planId, userId }).lean();
  if (!existing) {
    return { success: false, statusCode: 404, message: "Trading plan not found." };
  }

  const target = (existing.rules || []).find(
    (rule) => String(rule._id) === String(ruleId),
  );
  if (!target) {
    return { success: false, statusCode: 404, message: "Rule not found." };
  }

  const rules = (existing.rules || [])
    .filter((rule) => String(rule._id) !== String(ruleId))
    .map((rule) => clonePlain(rule));

  const fieldUpdates = {};
  if (target.metric && METRIC_TO_FIELD[target.metric]) {
    fieldUpdates[METRIC_TO_FIELD[target.metric]] = null;
  }

  return updateTradingPlanService(
    planId,
    {
      ...fieldUpdates,
      rules,
      changeSummary: `Removed rule: ${target.title}`,
    },
    userId,
  );
}

function suggestionFingerprint({ type, category, title, proposedRule, targetExistingRuleId }) {
  const basis = [
    type,
    category,
    String(title || "").toLowerCase().trim(),
    String(proposedRule?.title || "").toLowerCase().trim(),
    String(proposedRule?.metric || ""),
    String(targetExistingRuleId || ""),
  ].join("|");
  return basis.slice(0, 128);
}

function normalizeSuggestionPayload(raw = {}) {
  const type = String(raw.type || "new_rule").trim();
  const category = String(raw.category || "Behaviour").trim();
  const title = String(raw.title || raw.proposedRule?.title || "").trim();
  const description = String(
    raw.description || raw.proposedRule?.description || "",
  ).trim();
  const proposedRule = {
    title: String(raw.proposedRule?.title || title).trim().slice(0, 160),
    description: String(raw.proposedRule?.description || description)
      .trim()
      .slice(0, 1000),
    category: raw.proposedRule?.category || category,
    kind:
      raw.proposedRule?.kind ||
      (category === "Commitment" || type === "new_commitment"
        ? "commitment"
        : "rule"),
    metric: raw.proposedRule?.metric || null,
    value:
      raw.proposedRule?.value !== undefined ? raw.proposedRule.value : null,
    enabled: raw.proposedRule?.enabled !== false,
    planFieldUpdates: raw.proposedRule?.planFieldUpdates || null,
  };

  return {
    type: [
      "new_rule",
      "new_commitment",
      "modify_rule",
      "deactivate_rule",
    ].includes(type)
      ? type
      : "new_rule",
    category: [
      "Risk",
      "Strategy",
      "Sessions",
      "Behaviour",
      "Commitment",
      "General",
    ].includes(category)
      ? category
      : "Behaviour",
    title: title.slice(0, 160),
    description: description.slice(0, 1000),
    proposedRule,
    reason: String(raw.reason || "").trim().slice(0, 1000),
    supportingContext: String(raw.supportingContext || "").trim().slice(0, 1000),
    targetPlanId:
      raw.targetPlanId && mongoose.Types.ObjectId.isValid(raw.targetPlanId)
        ? raw.targetPlanId
        : null,
    targetExistingRuleId:
      raw.targetExistingRuleId &&
      mongoose.Types.ObjectId.isValid(raw.targetExistingRuleId)
        ? raw.targetExistingRuleId
        : null,
  };
}

async function createPlanSuggestionService(userId, payload, context = {}) {
  const normalized = normalizeSuggestionPayload(payload);
  if (!normalized.title) {
    return {
      success: false,
      statusCode: 400,
      message: "Suggestion title is required.",
    };
  }

  const fingerprint = suggestionFingerprint(normalized);
  const existingPending = await PlanSuggestion.findOne({
    user: userId,
    fingerprint,
    status: "pending",
  }).lean();
  if (existingPending) {
    return { success: true, data: existingPending, duplicate: true };
  }

  // Soft duplicate: same title already enabled on active plan.
  const activePlans = await TradingPlan.find({ userId, status: "Active" })
    .select("rules")
    .lean();
  for (const plan of activePlans) {
    const match = (plan.rules || []).find(
      (rule) =>
        rule.enabled &&
        String(rule.title || "").toLowerCase() ===
          normalized.title.toLowerCase(),
    );
    if (match && normalized.type === "new_rule") {
      normalized.type = "modify_rule";
      normalized.targetExistingRuleId = match._id;
      normalized.targetPlanId = plan._id;
    }
  }

  const suggestion = await PlanSuggestion.create({
    user: userId,
    conversation: context.conversationId || null,
    messageCreatedAt: context.messageCreatedAt || new Date(),
    ...normalized,
    fingerprint: suggestionFingerprint(normalized),
    status: "pending",
  });

  return { success: true, data: suggestion, duplicate: false };
}

async function listPlanSuggestionsService(userId, { status } = {}) {
  const filter = { user: userId };
  if (status) filter.status = status;
  const suggestions = await PlanSuggestion.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return { success: true, data: suggestions };
}

async function resolvePlanSuggestionService(
  suggestionId,
  userId,
  { action, tradingAccountId } = {},
) {
  if (!mongoose.Types.ObjectId.isValid(suggestionId)) {
    return { success: false, statusCode: 400, message: "Invalid suggestion." };
  }
  if (!["approve", "decline"].includes(action)) {
    return {
      success: false,
      statusCode: 400,
      message: "Action must be approve or decline.",
    };
  }

  const suggestion = await PlanSuggestion.findOne({
    _id: suggestionId,
    user: userId,
  });
  if (!suggestion) {
    return { success: false, statusCode: 404, message: "Suggestion not found." };
  }
  if (suggestion.status !== "pending") {
    return {
      success: false,
      statusCode: 409,
      message: "This suggestion was already resolved.",
      data: suggestion,
    };
  }

  if (action === "decline") {
    suggestion.status = "declined";
    suggestion.resolvedAt = new Date();
    await suggestion.save();
    return { success: true, data: suggestion };
  }

  let plan = null;
  if (suggestion.targetPlanId) {
    plan = await TradingPlan.findOne({
      _id: suggestion.targetPlanId,
      userId,
      status: "Active",
    });
  }
  if (!plan && tradingAccountId) {
    plan = await TradingPlan.findOne({
      userId,
      tradingAccount: tradingAccountId,
      status: "Active",
    });
  }
  if (!plan) {
    plan = await TradingPlan.findOne({ userId, status: "Active" }).sort({
      updatedAt: -1,
    });
  }

  if (!plan && suggestion.type !== "new_rule" && suggestion.type !== "new_commitment") {
    return {
      success: false,
      statusCode: 404,
      message: "No active trading plan found to update.",
    };
  }

  if (!plan) {
    if (!tradingAccountId) {
      return {
        success: false,
        statusCode: 400,
        message:
          "Create a trading plan first, or provide a trading account to create one from this suggestion.",
      };
    }
    const created = await createTradingPlanService(
      {
        name: "My Trading Plan",
        tradingAccount: tradingAccountId,
        rules: [
          {
            title: suggestion.proposedRule?.title || suggestion.title,
            description:
              suggestion.proposedRule?.description || suggestion.description,
            category:
              suggestion.proposedRule?.category || suggestion.category,
            kind:
              suggestion.type === "new_commitment" ? "commitment" : "rule",
            metric: suggestion.proposedRule?.metric || null,
            value: suggestion.proposedRule?.value ?? null,
            source: "ai_suggestion",
            suggestionId: suggestion._id,
          },
        ],
        ...(suggestion.proposedRule?.planFieldUpdates || {}),
      },
      userId,
    );
    if (!created.success) return created;
    suggestion.status = "approved";
    suggestion.resolvedAt = new Date();
    suggestion.resultingPlanId = created.data._id;
    suggestion.resultingRuleId = created.data.rules?.slice(-1)?.[0]?._id || null;
    await suggestion.save();
    return {
      success: true,
      data: suggestion,
      plan: created.data,
    };
  }

  let updateResult;
  if (suggestion.type === "deactivate_rule" && suggestion.targetExistingRuleId) {
    updateResult = await updatePlanRuleService(
      plan._id,
      suggestion.targetExistingRuleId,
      { enabled: false },
      userId,
    );
  } else if (
    suggestion.type === "modify_rule" &&
    suggestion.targetExistingRuleId
  ) {
    updateResult = await updatePlanRuleService(
      plan._id,
      suggestion.targetExistingRuleId,
      {
        title: suggestion.proposedRule?.title || suggestion.title,
        description:
          suggestion.proposedRule?.description || suggestion.description,
        category: suggestion.proposedRule?.category || suggestion.category,
        kind: suggestion.proposedRule?.kind,
        value: suggestion.proposedRule?.value,
        metric: suggestion.proposedRule?.metric,
        enabled: true,
      },
      userId,
    );
    if (
      updateResult.success &&
      suggestion.proposedRule?.planFieldUpdates &&
      typeof suggestion.proposedRule.planFieldUpdates === "object"
    ) {
      updateResult = await updateTradingPlanService(
        updateResult.data._id,
        {
          ...suggestion.proposedRule.planFieldUpdates,
          changeSummary: `Applied field updates from suggestion: ${suggestion.title}`,
        },
        userId,
      );
    }
  } else {
    updateResult = await addPlanRuleService(
      plan._id,
      {
        title: suggestion.proposedRule?.title || suggestion.title,
        description:
          suggestion.proposedRule?.description || suggestion.description,
        category: suggestion.proposedRule?.category || suggestion.category,
        kind:
          suggestion.type === "new_commitment"
            ? "commitment"
            : suggestion.proposedRule?.kind || "rule",
        metric: suggestion.proposedRule?.metric || null,
        value: suggestion.proposedRule?.value ?? null,
        source: "ai_suggestion",
        suggestionId: suggestion._id,
      },
      userId,
    );
    if (
      updateResult.success &&
      suggestion.proposedRule?.planFieldUpdates &&
      typeof suggestion.proposedRule.planFieldUpdates === "object"
    ) {
      updateResult = await updateTradingPlanService(
        updateResult.data._id,
        {
          ...suggestion.proposedRule.planFieldUpdates,
          changeSummary: `Applied field updates from suggestion: ${suggestion.title}`,
        },
        userId,
      );
    }
  }

  if (!updateResult.success) return updateResult;

  suggestion.status = "approved";
  suggestion.resolvedAt = new Date();
  suggestion.resultingPlanId = updateResult.data._id;
  const matchedRule = (updateResult.data.rules || []).find(
    (rule) =>
      String(rule.title || "").toLowerCase() ===
      String(suggestion.proposedRule?.title || suggestion.title)
        .toLowerCase(),
  );
  suggestion.resultingRuleId = matchedRule?._id || null;
  await suggestion.save();

  return {
    success: true,
    data: suggestion,
    plan: updateResult.data,
  };
}

export {
  METRIC_TO_FIELD,
  addPlanRuleService,
  createPlanSuggestionService,
  createTradingPlanService,
  getActivePlanForAccount,
  getTradingPlanService,
  listPlanSuggestionsService,
  listPlanVersionsService,
  listTradingPlansService,
  normalizeSuggestionPayload,
  removePlanRuleService,
  resolvePlanSuggestionService,
  suggestionFingerprint,
  updatePlanRuleService,
  updateTradingPlanService,
};
