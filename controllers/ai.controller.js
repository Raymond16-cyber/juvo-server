import {
  chatWithJuvoService,
  getConversationService,
  listConversationsService,
} from "../services/ai.service.js";
import {
  ENTITLEMENTS,
  getUserFeatureAccess,
  startJuvoAiTrial,
} from "../services/entitlement.service.js";

function getUserId(user) {
  return user?.id || user?._id;
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
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Conversation retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function chatController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    const { conversationId, message } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await chatWithJuvoService({
      userId,
      conversationId,
      message,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Juvo replied.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function getAiAccessController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const access = await getUserFeatureAccess(userId, ENTITLEMENTS.JUVO_AI);
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

    const access = await startJuvoAiTrial(userId);
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

export {
  chatController,
  getAiAccessController,
  getConversationController,
  listConversationsController,
  startAiTrialController,
};
