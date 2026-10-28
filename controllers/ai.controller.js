import {
  chatWithJuvoService,
  deleteConversationsService,
  getConversationService,
  listConversationsService,
} from "../services/ai.service.js";
import {
  explainMetric,
  generateGoalCoach,
  generateJournalInterviewer,
  generatePeriodReview,
  generatePlanCompliance,
  getAiCheckinState,
  updateAiCheckinPreferences,
} from "../services/aiFeatures.service.js";
import { buildUsageMapForUser } from "../services/aiUsage.service.js";
import {
  ENTITLEMENTS,
  buildAiFeaturesAccessMap,
  getFeatureAccess,
  getUserFeatureAccess,
  startJuvoAiTrial,
} from "../services/entitlement.service.js";
import User from "../models/User.js";
import {
  assertWithinQuota,
  getUsageSnapshot,
  incrementUsage,
} from "../services/aiUsage.service.js";

function getUserId(user) {
  return user?.id || user?._id;
}

function planContextFromAccess(access) {
  return {
    plan: access?.plan || "free",
    trialActive: access?.trial?.status === "active",
  };
}

async function listConversationsController(req, res, next) {
  try {
    const result = await listConversationsService(getUserId(req.user));
    return res.status(200).json({
      message: "Conversations retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function getConversationController(req, res, next) {
  try {
    const result = await getConversationService(
      req.params.conversationId,
      getUserId(req.user),
    );

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Conversation retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteConversationsController(req, res, next) {
  try {
    const result = await deleteConversationsService(
      req.body?.conversationIds,
      getUserId(req.user),
    );
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }
    return res.status(200).json({
      message: "Conversations deleted successfully.",
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    next(error);
  }
}

async function chatController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const { conversationId, message, journalIds } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const selectedIds = Array.isArray(journalIds) ? journalIds : [];
    if (selectedIds.length) {
      const askFeature = await getUserFeatureAccess(
        userId,
        ENTITLEMENTS.ASK_YOUR_JOURNAL,
      );
      if (!askFeature?.hasAccess) {
        return res.status(403).json({
          success: false,
          code: "ENTITLEMENT_REQUIRED",
          message: "Ask Your Journal requires Pro, Super, or an active trial.",
          access: askFeature,
        });
      }
      const quota = await assertWithinQuota(
        userId,
        ENTITLEMENTS.ASK_YOUR_JOURNAL,
        planContextFromAccess(askFeature),
      );
      if (!quota.success) {
        return res.status(quota.statusCode || 403).json(quota);
      }
    }

    const result = await chatWithJuvoService({
      userId,
      conversationId,
      message,
      journalIds: selectedIds,
    });

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    if (selectedIds.length) {
      const access = await getUserFeatureAccess(
        userId,
        ENTITLEMENTS.ASK_YOUR_JOURNAL,
      );
      await incrementUsage(userId, ENTITLEMENTS.ASK_YOUR_JOURNAL);
      result.data.usage = await getUsageSnapshot(
        userId,
        ENTITLEMENTS.ASK_YOUR_JOURNAL,
        planContextFromAccess(access),
      );
    }

    return res.status(200).json({
      message: "Juvo replied.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function buildExtendedAccess(userId) {
  const user = await User.findById(userId).select("subscription entitlements");
  if (!user) return null;

  const access = getFeatureAccess(user, ENTITLEMENTS.JUVO_AI);
  const features = buildAiFeaturesAccessMap(user);
  const usage = await buildUsageMapForUser(userId, {
    plan: access.plan,
    trialActive: access.trial?.status === "active",
  });

  return {
    ...access,
    features,
    usage,
  };
}

async function getAiAccessController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const access = await buildExtendedAccess(userId);
    return res.status(200).json({
      message: "Juvo AI access retrieved.",
      data: access,
    });
  } catch (error) {
    next(error);
  }
}

async function startAiTrialController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    await startJuvoAiTrial(userId);
    const access = await buildExtendedAccess(userId);
    return res.status(200).json({
      message:
        access?.source === "trial"
          ? "Your 3-day Juvo AI trial is active."
          : "Juvo AI access retrieved.",
      data: access,
    });
  } catch (error) {
    next(error);
  }
}

async function journalInterviewerController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const ctx = planContextFromAccess(req.featureAccess);
    const result = await generateJournalInterviewer({
      userId,
      journalId: req.body?.journalId,
      tradeId: req.body?.tradeId,
      noTradeDayId: req.body?.noTradeDayId,
      entrySnapshot: req.body?.entrySnapshot,
      forceRefresh: Boolean(req.body?.forceRefresh),
      ...ctx,
    });
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        code: result.code,
        message: result.message,
        usage: result.usage,
      });
    }
    return res.status(200).json({
      message: result.data.cached
        ? "Cached interview questions loaded."
        : "Interview questions ready.",
      data: result.data,
      usage: result.usage,
    });
  } catch (error) {
    next(error);
  }
}

async function planComplianceController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const ctx = planContextFromAccess(req.featureAccess);
    const result = await generatePlanCompliance({
      userId,
      journalId: req.body?.journalId,
      tradeId: req.body?.tradeId,
      ...ctx,
    });
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        code: result.code,
        message: result.message,
        usage: result.usage,
      });
    }
    return res.status(200).json({
      message: "Plan compliance check ready.",
      data: result.data,
      usage: result.usage,
    });
  } catch (error) {
    next(error);
  }
}

async function periodReviewController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const ctx = planContextFromAccess(req.featureAccess);
    const result = await generatePeriodReview({
      userId,
      period: req.body?.period,
      anchorDate: req.body?.anchorDate,
      forceRefresh: Boolean(req.body?.forceRefresh),
      ...ctx,
    });
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        code: result.code,
        message: result.message,
        usage: result.usage,
      });
    }
    return res.status(200).json({
      message: result.data.cached
        ? "Cached period review loaded."
        : "Period review ready.",
      data: result.data,
      usage: result.usage,
    });
  } catch (error) {
    next(error);
  }
}

async function explainMetricController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const ctx = planContextFromAccess(req.featureAccess);
    const result = await explainMetric({
      userId,
      metricKey: req.body?.metricKey,
      dateFrom: req.body?.dateFrom,
      dateTo: req.body?.dateTo,
      comparisonFrom: req.body?.comparisonFrom,
      comparisonTo: req.body?.comparisonTo,
      ...ctx,
    });
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        code: result.code,
        message: result.message,
        usage: result.usage,
      });
    }
    return res.status(200).json({
      message: "Metric explanation ready.",
      data: result.data,
      usage: result.usage,
    });
  } catch (error) {
    next(error);
  }
}

async function goalCoachController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const ctx = planContextFromAccess(req.featureAccess);
    const result = await generateGoalCoach({
      userId,
      goalId: req.body?.goalId,
      action: req.body?.action,
      ...ctx,
    });
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        code: result.code,
        message: result.message,
        usage: result.usage,
      });
    }
    return res.status(200).json({
      message: "Goal coach ready.",
      data: result.data,
      usage: result.usage,
    });
  } catch (error) {
    next(error);
  }
}

async function getCheckinController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const ctx = planContextFromAccess(req.featureAccess);
    const preferencesOnly =
      req.query?.preferencesOnly === "1" ||
      req.query?.preferencesOnly === "true";
    const result = await getAiCheckinState(userId, {
      ...ctx,
      preferencesOnly,
    });
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }
    return res.status(200).json({
      message: "Check-in state retrieved.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function putCheckinPreferencesController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const result = await updateAiCheckinPreferences(userId, req.body || {});
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }
    return res.status(200).json({
      message: "Check-in preferences updated.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

export {
  chatController,
  deleteConversationsController,
  explainMetricController,
  getAiAccessController,
  getCheckinController,
  getConversationController,
  goalCoachController,
  journalInterviewerController,
  listConversationsController,
  periodReviewController,
  planComplianceController,
  putCheckinPreferencesController,
  startAiTrialController,
};
