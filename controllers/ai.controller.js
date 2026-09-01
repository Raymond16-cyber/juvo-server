import {
  chatWithJuvoService,
  getConversationService,
  listConversationsService,
} from "../services/ai.service.js";

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

export {
  chatController,
  getConversationController,
  listConversationsController,
};
