import {
  chatWithJuvoService,
  getConversationService,
  listConversationsService,
} from "../services/ai.service.js";

async function listConversationsController(req, res, next) {
  try {
    const result = await listConversationsService(req.user.id);
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
      req.user.id,
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
    const { conversationId, message } = req.body || {};
    const result = await chatWithJuvoService({
      userId: req.user.id,
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
