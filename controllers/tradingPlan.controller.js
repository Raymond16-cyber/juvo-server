import {
  addPlanRuleService,
  createTradingPlanService,
  getTradingPlanService,
  listPlanSuggestionsService,
  listPlanVersionsService,
  listTradingPlansService,
  removePlanRuleService,
  resolvePlanSuggestionService,
  updatePlanRuleService,
  updateTradingPlanService,
} from "../services/tradingPlan.service.js";

function getUserId(user) {
  return user?.id || user?._id;
}

async function listTradingPlansController(req, res, next) {
  try {
    const result = await listTradingPlansService(getUserId(req.user), {
      tradingAccount: req.query.tradingAccount,
      status: req.query.status,
    });
    return res.status(200).json({
      message: "Trading plans retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function getTradingPlanController(req, res, next) {
  try {
    const result = await getTradingPlanService(
      req.params.planId,
      getUserId(req.user),
    );
    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }
    return res.status(200).json({
      message: "Trading plan retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function listPlanVersionsController(req, res, next) {
  try {
    const result = await listPlanVersionsService(
      req.params.planId,
      getUserId(req.user),
    );
    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }
    return res.status(200).json({
      message: "Trading plan versions retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function createTradingPlanController(req, res, next) {
  try {
    const result = await createTradingPlanService(
      req.body?.data || req.body,
      getUserId(req.user),
    );
    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }
    return res.status(201).json({
      message: "Trading plan created successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateTradingPlanController(req, res, next) {
  try {
    const result = await updateTradingPlanService(
      req.params.planId,
      req.body?.data || req.body,
      getUserId(req.user),
    );
    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }
    return res.status(200).json({
      message: result.versioned
        ? "Trading plan updated. A new version was created."
        : "Trading plan updated successfully.",
      data: result.data,
      versioned: Boolean(result.versioned),
    });
  } catch (error) {
    next(error);
  }
}

async function addPlanRuleController(req, res, next) {
  try {
    const result = await addPlanRuleService(
      req.params.planId,
      req.body?.data || req.body,
      getUserId(req.user),
    );
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message, data: result.data });
    }
    return res.status(200).json({
      message: "Rule added to trading plan.",
      data: result.data,
      versioned: Boolean(result.versioned),
    });
  } catch (error) {
    next(error);
  }
}

async function updatePlanRuleController(req, res, next) {
  try {
    const result = await updatePlanRuleService(
      req.params.planId,
      req.params.ruleId,
      req.body?.data || req.body,
      getUserId(req.user),
    );
    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }
    return res.status(200).json({
      message: "Rule updated.",
      data: result.data,
      versioned: Boolean(result.versioned),
    });
  } catch (error) {
    next(error);
  }
}

async function removePlanRuleController(req, res, next) {
  try {
    const result = await removePlanRuleService(
      req.params.planId,
      req.params.ruleId,
      getUserId(req.user),
    );
    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }
    return res.status(200).json({
      message: "Rule removed.",
      data: result.data,
      versioned: Boolean(result.versioned),
    });
  } catch (error) {
    next(error);
  }
}

async function listPlanSuggestionsController(req, res, next) {
  try {
    const result = await listPlanSuggestionsService(getUserId(req.user), {
      status: req.query.status,
    });
    return res.status(200).json({
      message: "Plan suggestions retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function resolvePlanSuggestionController(req, res, next) {
  try {
    const body = req.body?.data || req.body || {};
    const result = await resolvePlanSuggestionService(
      req.params.suggestionId,
      getUserId(req.user),
      {
        action: body.action,
        tradingAccountId: body.tradingAccount || body.tradingAccountId,
      },
    );
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message, data: result.data });
    }
    return res.status(200).json({
      message:
        body.action === "approve"
          ? "Suggestion added to your trading plan."
          : "Suggestion dismissed.",
      data: result.data,
      plan: result.plan || null,
    });
  } catch (error) {
    next(error);
  }
}

export {
  addPlanRuleController,
  createTradingPlanController,
  getTradingPlanController,
  listPlanSuggestionsController,
  listPlanVersionsController,
  listTradingPlansController,
  removePlanRuleController,
  resolvePlanSuggestionController,
  updatePlanRuleController,
  updateTradingPlanController,
};
